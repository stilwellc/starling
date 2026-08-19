/**
 * run-board.ts — the pipeline orchestrator (PROPOSAL §6.1).
 *
 *   sync book + hunt list → plan (hunt paid first, then cards-cap/floors)
 *   → poll (hunt first, every run) → identify → enrich → cert-verify → gate
 *   → score → rank → publish (deals + hunt section) → receipts
 *
 * STARLING_MODE=fixture (default when no eBay keys) runs the whole thing offline
 * against fixtures/. Live mode adds the eBay client and PSA verification.
 *
 * The run timestamp is read ONCE here and injected everywhere downstream, so no
 * other module reads the wall clock (keeps the pipeline deterministic per run).
 */
import type {
  Deal,
  Candidate,
  Vertical,
  PerVerticalStat,
  EbayListing,
  HuntDeal,
  HuntPricedDeal,
} from './types';
import { LAUNCH_VERTICALS } from './types';
import { MATCHERS, matcherFor } from './match/registry';
import { syncBook } from './sync-book';
import { planRun, planHunt, reserveHuntBudget, type YieldMap } from './scheduler';
import { loadHuntList, compileHuntQueries, toHuntTarget } from './hunt';
import { poll, pollHunt } from './poll';
import { enrich, verifyPsaCert, applyCertVerdict, type CertVerdict } from './enrich';
import { gate, huntGate } from './gate';
import { scoreRisk } from './score/risk';
import { rankOf } from './score/rank';
import { publishBoard } from './publish';
import {
  loadReceipts,
  recordSurfaced,
  resolveReceipts,
  commitReceipts,
} from './receipts';
import { dealId, evidenceUrl } from './lib/id';
import { EbayClient } from './lib/ebay-client';

function isLive(): boolean {
  return process.env.STARLING_MODE === 'live' && !!process.env.EBAY_CLIENT_ID;
}

async function main() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const mode: 'fixture' | 'live' = isLive() ? 'live' : 'fixture';
  // The book source is DECOUPLED from the eBay source: lectr's private value
  // book isn't emitted yet, so STARLING_BOOK=fixture lets us poll REAL eBay
  // against the sample keys (real card/autograph identities) to prove the
  // Browse API path before the lectr book exists. In fixture mode the book is
  // always the fixture; in live mode it defaults live unless overridden.
  const bookMode: 'fixture' | 'live' =
    mode === 'live' && process.env.STARLING_BOOK !== 'fixture' ? 'live' : 'fixture';
  console.log(`[run-board] ebay=${mode} · book=${bookMode} at ${nowIso}`);

  const client =
    mode === 'live'
      ? new EbayClient({
          clientId: process.env.EBAY_CLIENT_ID!,
          clientSecret: process.env.EBAY_CLIENT_SECRET!,
          epnCampaignId: process.env.EPN_CAMPAIGN_ID,
          marketplaceId: 'EBAY_US',
          buyerZip: process.env.STARLING_BUYER_ZIP ?? '10001',
        })
      : undefined;

  // 1 — sync the value book. Graceful: in live mode try lectr's real book from
  // private R2; if it's unreadable (no token/permission, 404, stale-fail), fall
  // back to the sample book rather than failing the run. So Starling auto-upgrades
  // to real valuations the moment the book + a readable token exist — no config flip.
  let synced;
  if (bookMode === 'live') {
    try {
      synced = await syncBook('live', now);
    } catch (e) {
      console.warn(
        `[run-board] real book unavailable (${(e as Error).message.split('—')[0].trim()}) — using sample book`,
      );
      synced = await syncBook('fixture', now);
    }
  } else {
    synced = await syncBook('fixture', now);
  }
  console.log(
    `[run-board] book: ${synced.book.rows.length} rows (${synced.source}${synced.stale ? ', STALE' : ''})`,
  );

  // 1b — the hunt list (§4.4), loaded with the book every run. A malformed
  // file THROWS out of loadHuntList and fails the run loudly — a silently-
  // dropped grail is the worst bug this system can have.
  const huntEntries = loadHuntList();
  const huntCompiled = compileHuntQueries(
    huntEntries,
    { byKey: synced.byKey, rows: synced.book.rows },
    matcherFor,
  );

  // 2 — plan: the hunt is PAID FIRST (10% reserved off the top), THEN the book
  // split (cards capped 40%, others floored 15%) runs on what remains.
  const { huntBudget, bookBudget } = reserveHuntBudget();
  const huntPlan = planHunt(huntCompiled);
  console.log(
    `[run-board] hunt: ${huntEntries.length} targets → ${huntPlan.queries.length} queries ` +
      `(${huntBudget}/day reserved, paid first)`,
  );
  const yields: YieldMap = {}; // first run: no trailing yield; even elastic split
  const plans = planRun(MATCHERS, synced.byVertical, yields, now, 1, bookBudget);
  for (const p of plans) {
    console.log(`[run-board] plan ${p.vertical}: ${p.queries.length} queries / ${p.callBudget} calls`);
  }

  // 3 — poll (Tier-1): hunt queries FIRST, every run — never the rotating wheel
  const huntPolled = await pollHunt(huntPlan, { mode, client, now });
  const polled = await poll(plans, { mode, client, now });

  // 4..7 — identify → enrich → cert-verify → gate → score, per vertical
  const certCache = new Map<string, CertVerdict>();
  const deals: Deal[] = [];
  const perVertical: Partial<Record<Vertical, PerVerticalStat>> = {};

  // 4a — the hunt lane first, through the SAME identify → enrich → gate → score
  // path. A hit that pins to a book row is a full priced deal (per-entry
  // maxAllIn/minDepth applied; the 0.90 scam cap never moves). A hit with no
  // book row still surfaces — a human explicitly asked — as "hunted — no book
  // value": facts only, no med/depth/rank ever manufactured.
  const huntDeals: HuntDeal[] = [];
  const huntClaimed = new Set<string>(); // itemIds the hunt surfaced — a grail is never double-listed
  for (const hp of huntPolled) {
    const entry = hp.entry;
    const enrichedHunt = await enrich(hp.listings, { mode, client, now, cap: 10 });
    for (const l of enrichedHunt) {
      if (huntClaimed.has(l.itemId)) continue; // overlapping targets: first entry (yaml order) wins

      // identify via the entry's matcher(s); abstention is still correct here —
      // an unpinned hit just has no identity, it is not fuzzy-matched.
      let key: string | null = null;
      let identifiedVertical: Vertical | null = null;
      for (const v of hp.identifyVerticals) {
        const m = matcherFor[v];
        if (!m) continue;
        const k = m.identify(l);
        if (k) {
          key = k;
          identifiedVertical = v;
          break;
        }
      }
      const row = key ? synced.byKey.get(key) : undefined;

      const g = huntGate(l, entry, row);
      if (!g.pass) continue;

      if (row && key && identifiedVertical) {
        // priced hunt hit — the book still prices; the list only prioritized.
        let risk = matcherFor[identifiedVertical]!.riskInputs(l);
        if (risk.certNumber && (identifiedVertical === 'sports-cards' || identifiedVertical === 'pokemon')) {
          const verdict = await verifyPsaCert(risk.certNumber, process.env.PSA_API_TOKEN, certCache);
          risk = applyCertVerdict(risk, verdict);
        }
        const riskResult = scoreRisk(l, risk, identifiedVertical);
        const rank = rankOf(g.depth!, row.conf, riskResult.grade, l.itemCreationDate, new Date(now));
        huntDeals.push({
          huntId: entry.id,
          huntLabel: entry.label,
          id: dealId(l.itemId),
          itemId: l.itemId,
          legacyItemId: l.legacyItemId,
          vertical: identifiedVertical,
          key,
          title: l.title,
          imageUrl: l.imageUrl,
          allIn: g.allIn,
          itemPrice: l.price,
          shipping: l.shippingCost,
          med: row.med,
          lo: row.lo,
          hi: row.hi,
          n: row.n,
          lastSale: row.lastSale,
          trend: row.trend,
          conf: row.conf,
          depth: g.depth!,
          risk: riskResult,
          rank,
          listedAt: l.itemCreationDate,
          affiliateUrl: l.itemAffiliateWebUrl,
          webUrl: l.itemWebUrl,
          marketplace: l.marketplaceId,
          evidenceUrl: evidenceUrl(identifiedVertical, key),
          surfacedAt: nowIso,
        });
      } else {
        // "hunted — no book value": listing facts only.
        huntDeals.push({
          huntId: entry.id,
          huntLabel: entry.label,
          noBook: true,
          id: dealId(l.itemId),
          itemId: l.itemId,
          legacyItemId: l.legacyItemId,
          vertical: entry.vertical,
          key: key ?? undefined,
          title: l.title,
          imageUrl: l.imageUrl,
          allIn: g.allIn,
          itemPrice: l.price,
          shipping: l.shippingCost,
          seller: {
            username: l.seller.username,
            feedbackPercentage: l.seller.feedbackPercentage,
            feedbackScore: l.seller.feedbackScore,
          },
          listedAt: l.itemCreationDate,
          affiliateUrl: l.itemAffiliateWebUrl,
          webUrl: l.itemWebUrl,
          marketplace: l.marketplaceId,
          surfacedAt: nowIso,
        });
      }
      huntClaimed.add(l.itemId);
    }
  }

  for (const pv of polled) {
    const matcher = matcherFor[pv.vertical];
    const stat: PerVerticalStat = { polled: pv.listings.length, matched: 0, surfaced: 0 };
    perVertical[pv.vertical] = stat;
    if (!matcher) continue;

    // provisional identify → shortlist listings that pin a key
    const pinned: { listing: EbayListing; key: string }[] = [];
    for (const l of pv.listings) {
      const k = matcher.identify(l);
      if (k) pinned.push({ listing: l, key: k });
    }

    // enrich the shortlist (live only), then re-identify on real aspects.
    // Cap Tier-2 getItem calls per vertical so a big pin set can't blow quota.
    const enriched = await enrich(
      pinned.map((p) => p.listing),
      { mode, client, now, cap: 40 },
    );
    const enrichedById = new Map(enriched.map((l) => [l.itemId, l]));

    for (const { listing } of pinned) {
      if (huntClaimed.has(listing.itemId)) continue; // already surfaced in the hunt section
      const l = enrichedById.get(listing.itemId) ?? listing;
      const key = matcher.identify(l);
      if (!key) continue;
      const row = synced.byKey.get(key);
      if (!row) continue; // no book row → no number → no deal
      stat.matched++;

      let risk = matcher.riskInputs(l);
      // opportunistic PSA cert verification (cards/pokemon)
      if (risk.certNumber && (pv.vertical === 'sports-cards' || pv.vertical === 'pokemon')) {
        const verdict = await verifyPsaCert(risk.certNumber, process.env.PSA_API_TOKEN, certCache);
        risk = applyCertVerdict(risk, verdict);
      }

      const g = gate(l, row);
      if (!g.pass) continue;

      const candidate: Candidate = { listing: l, key, vertical: pv.vertical, row, risk };
      const riskResult = scoreRisk(l, risk, pv.vertical);
      const rank = rankOf(g.depth, row.conf, riskResult.grade, l.itemCreationDate, new Date(now));

      deals.push({
        id: dealId(l.itemId),
        itemId: l.itemId,
        legacyItemId: l.legacyItemId,
        vertical: pv.vertical,
        key,
        title: l.title,
        imageUrl: l.imageUrl,
        allIn: g.allIn,
        itemPrice: l.price,
        shipping: l.shippingCost,
        med: row.med,
        lo: row.lo,
        hi: row.hi,
        n: row.n,
        lastSale: row.lastSale,
        trend: row.trend,
        conf: row.conf,
        depth: g.depth,
        risk: riskResult,
        rank,
        listedAt: l.itemCreationDate,
        affiliateUrl: l.itemAffiliateWebUrl,
        webUrl: l.itemWebUrl,
        marketplace: l.marketplaceId,
        evidenceUrl: evidenceUrl(pv.vertical, key),
        surfacedAt: nowIso,
      });
      candidate; // (kept for parity with the documented Candidate stage)
      stat.surfaced++;
    }
  }

  // 8 — publish the board (hunt section always present so /hunt can render
  // every target's watching/live state, even when nothing hit this run)
  const board = publishBoard(
    deals,
    perVertical,
    { builtAt: nowIso, bookBuiltAt: synced.book.builtAt },
    { targets: huntEntries.map(toHuntTarget), deals: huntDeals },
  );

  // 9 — receipts: record newly surfaced, resolve the ones that left BIN.
  // Priced hunt hits are full deals — their calls go on the tape like any
  // other. noBook hits carry no call (no med/depth), so nothing to grade.
  const pricedHuntDeals = huntDeals.filter((d): d is HuntPricedDeal => !d.noBook);
  let receipts = loadReceipts();
  receipts = recordSurfaced(receipts, [...board.deals, ...pricedHuntDeals], nowIso);
  // Cap re-checks per run: the live-receipt set grows every tick, and each
  // recheck is a real API call — uncapped, this line alone would eventually
  // eat the daily quota. 60/run × 8 runs/day resolves plenty.
  receipts = await resolveReceipts(receipts, { mode, client, now, nowIso, cap: 60 });
  commitReceipts(receipts);

  // summary
  const byV = LAUNCH_VERTICALS.map((v) => `${v}:${perVertical[v]?.surfaced ?? 0}`).join('  ');
  const noBookCount = huntDeals.length - pricedHuntDeals.length;
  console.log(`[run-board] published ${board.deals.length} deals  [${byV}]`);
  console.log(
    `[run-board] hunt: ${huntDeals.length} hits ` +
      `(${pricedHuntDeals.length} priced, ${noBookCount} no-book) across ${huntEntries.length} targets`,
  );
  console.log(`[run-board] receipts: ${receipts.length} tracked`);
}

main().catch((e) => {
  console.error('[run-board] FAILED:', e);
  process.exit(1);
});
