/**
 * run-board.ts — the pipeline orchestrator (PROPOSAL §6.1, rebuilt Aug 2026).
 *
 *   sync book (+context tier) + hunt list
 *   → hunt lane (paid first, every run): poll → identify → enrich → gate → score
 *   → SWEEP (the wide net): category slices, cursored newly-listed pages
 *   → BULK IDENTIFY: every swept listing through its slice's matchers against
 *     an in-memory map of the WHOLE book — zero API calls
 *   → Tier-2 getItems batches (own quota bucket) for candidates needing aspects
 *   → gate (reasons KEPT — the funnel is on the record) → score → context leads
 *   → CARRY-FORWARD (carry.ts): last tick's board deals not re-swept this run,
 *     re-verified alive in getItems batches, merged + re-ranked — the board is
 *     a LIVE SET, not a per-tick snapshot
 *   → publish (deals + hunt + leads + stats) → receipts (getItems batches)
 *
 * Why the rebuild (the funnel audit, from real run logs): 9,358 book keys → 15
 * published deals. Per-key queries at 45/run left 98% of the book idle and
 * ~60% of quota unspent; watches (1,278 keys) and design (144) had no matcher
 * and were never polled; pokemon matched 58 and published 0 with the reasons
 * discarded. The sweep inverts the funnel: discovery is category-wide, identity
 * is free, and every drop is counted in board.stats.
 *
 * STARLING_MODE=fixture (default when no eBay keys) runs the whole thing offline
 * against fixtures/. Live mode adds the eBay client and PSA verification.
 *
 * The run timestamp is read ONCE here and injected everywhere downstream, so no
 * other module reads the wall clock (keeps the pipeline deterministic per run).
 */
import type {
  AuctionCall,
  Deal,
  Vertical,
  PerVerticalStat,
  EbayListing,
  HuntDeal,
  HuntNoBookDeal,
  HuntPricedDeal,
  BoardStats,
} from './types';
import { LAUNCH_VERTICALS } from './types';
import { matcherFor } from './match/registry';
import { syncBook } from './sync-book';
import { reserveHuntBudget, planHunt, allocateSweepBudget, goldmineBudget } from './scheduler';
import { loadHuntList, compileHuntQueries, toHuntTarget, huntRelevant, NOBOOK_CAP_PER_TARGET } from './hunt';
import { pollHunt } from './poll';
import { SWEEP_SLICES, sweep, loadSweepState, commitSweepState, type SweepSlice } from './sweep';
import { compileGoldmine, goldmineWindow } from './goldmine';
import { enrich, verifyPsaCert, applyCertVerdict, type CertVerdict } from './enrich';
import { gate, huntGate, closingGate, REASON_KEY, LADDER_MIN_DEPTH, GOLDMINE_CLOSING_WINDOW_MS } from './gate';
import { buildLadderIndex, ladderRow } from './ladder';
import { indexContext, contextFor, toDealContext } from './context';
import { scoreRisk } from './score/risk';
import { rankOf, evidenceWeightOf } from './score/rank';
import { publishBoard } from './publish';
import { loadBoardState, commitBoardState, carryForward } from './carry';
import {
  loadReceipts,
  recordSurfaced,
  recordClosingSurfaced,
  resolveEndedNow,
  resolveReceipts,
  commitReceipts,
} from './receipts';
import { watchBrandOf } from './match/watches';
import { dealId, evidenceUrl } from './lib/id';
import { EbayClient } from './lib/ebay-client';

function isLive(): boolean {
  return process.env.STARLING_MODE === 'live' && !!process.env.EBAY_CLIENT_ID;
}

/** getItems calls (≤20 listings each) the sweep's enrichment pass may spend per
 *  run. 50 × 8 runs = 400/day + the receipts loop — comfortably inside the
 *  getItems bucket's own 5,000/day. */
const SWEEP_ENRICH_CALLS = 50;
/** getItems calls per hunt entry's enrichment (2 calls = 40 listings). */
const HUNT_ENRICH_CALLS = 2;
/** getItems calls the CLOSING lane may spend firming up pinned auctions
 *  (12 × 20 = 240 listings/run) — same separate bucket as the sweep's. */
const AUCTION_ENRICH_CALLS = 12;
/** board.leads cap — a taste list, not a firehose. */
const LEADS_CAP = 20;

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
  // The context tier is ADDITIVE — books without it just yield an empty index.
  const contextIndex = indexContext(synced.book.context);
  // The grade ladder is ADDITIVE too: null until lectr's book carries it, and
  // then card keys missing only their grade can price via ladderRow().
  const ladderIndex = buildLadderIndex(synced.book);
  console.log(
    `[run-board] book: ${synced.book.rows.length} rows + ${contextIndex.size} context rollups ` +
      `(${synced.source}${synced.stale ? ', STALE' : ''}` +
      `${ladderIndex ? ', grade ladder' : ''})`,
  );
  // Per-vertical row counts in every run log — the auditable trail that the
  // book actually carries what lectr says it emitted (e.g. the deep-archive
  // autograph unlock is verifiable here, not just on the emit side).
  {
    const byVertical = new Map<string, number>();
    for (const r of synced.book.rows) byVertical.set(r.v, (byVertical.get(r.v) ?? 0) + 1);
    console.log(
      `[run-board] book verticals: ${[...byVertical.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v}=${n}`)
        .join(' · ')}`,
    );
  }

  // 1b — the hunt list (§4.4), loaded with the book every run. A malformed
  // file THROWS out of loadHuntList and fails the run loudly — a silently-
  // dropped grail is the worst bug this system can have.
  const huntEntries = loadHuntList();
  const huntCompiled = compileHuntQueries(
    huntEntries,
    { byKey: synced.byKey, rows: synced.book.rows },
    matcherFor,
  );

  // 2 — plan: the hunt is PAID FIRST (10% reserved off the top), THEN the sweep
  // split (cards-lane slices capped at 40% combined) runs on what remains.
  const { huntBudget } = reserveHuntBudget();
  const huntPlan = planHunt(huntCompiled);
  console.log(
    `[run-board] hunt: ${huntEntries.length} targets → ${huntPlan.queries.length} queries ` +
      `(${huntBudget}/day reserved, paid first)`,
  );
  const sweepBudgets = allocateSweepBudget(SWEEP_SLICES);

  // The run's funnel numbers — published in board.stats (schema v2). Gate
  // reasons are AGGREGATED, never discarded: the audit's core observability fix.
  const stats: BoardStats = {
    calls: { search: 0, getItems: 0 },
    listingsEvaluated: 0,
    bySlice: {},
    gateReasons: {},
    identified: {},
  };
  const bumpReason = (lens: string, key: string) => {
    const h = (stats.gateReasons[lens] ??= {});
    h[key] = (h[key] ?? 0) + 1;
  };

  // 3 — the hunt lane FIRST, every run, through identify → enrich → gate →
  // score. A hit that pins to a book row is a full priced deal (per-entry
  // maxAllIn/minDepth applied; the 0.90 scam cap never moves). A hit with no
  // book row still surfaces — a human explicitly asked — as "hunted — no book
  // value": facts only, now with the context tier's nearby evidence attached
  // when lectr carries a covering rollup.
  const huntPolled = await pollHunt(huntPlan, { mode, client, now });
  const certCache = new Map<string, CertVerdict>();
  const huntDeals: HuntDeal[] = [];
  const huntClaimed = new Set<string>(); // itemIds the hunt surfaced — a grail is never double-listed
  for (const hp of huntPolled) {
    const entry = hp.entry;
    const enrichedHunt = await enrich(hp.listings, { mode, client, now, maxCalls: HUNT_ENRICH_CALLS });
    // Per-entry funnel counters — the funnel-audit rule: a zero-hit hunt must
    // be diagnosable from the log alone (returned → guard → gate → kept).
    const hFun = { returned: enrichedHunt.length, guardCut: 0, gateCut: 0, kept: 0 };
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

      // un-pinned hits from raw-terms targets must clear the relevance guard
      // (q-token presence + vertical hint) — the zip-jacket lesson from the
      // first live run. Pinned (priced) hits skip it: identity IS relevance.
      // guard-cut does NOT claim (Aug 21 2026, the BSTJ lesson): overlapping
      // targets share search results — eBay pads rare queries with the same
      // best-match set, so entry #1's year-guard was claiming listings that
      // entry #4 would have KEPT. Only a kept hit claims; re-running a cheap
      // regex per entry is nothing.
      if (!row && !huntRelevant(entry, l.title || '')) { hFun.guardCut++; continue; }
      const g = huntGate(l, entry, row);
      if (!g.pass) {
        hFun.gateCut++;
        if (g.reason) bumpReason(entry.vertical, REASON_KEY[g.reason] ?? g.reason);
        continue;
      }
      hFun.kept++;

      if (row && key && identifiedVertical) {
        // priced hunt hit — the book still prices; the list only prioritized.
        let risk = matcherFor[identifiedVertical]!.riskInputs(l);
        if (risk.certNumber && (identifiedVertical === 'sports-cards' || identifiedVertical === 'pokemon')) {
          const verdict = await verifyPsaCert(risk.certNumber, process.env.PSA_API_TOKEN, certCache);
          risk = applyCertVerdict(risk, verdict);
        }
        const riskResult = scoreRisk(l, risk, identifiedVertical);
        const rank = rankOf(row.med - g.allIn, g.depth!, row.conf, riskResult.grade, evidenceWeightOf(row.lastSale, row.n12, new Date(now)), l.itemCreationDate, new Date(now));
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
          ...(row.n12 !== undefined ? { n12: row.n12 } : {}),
          lastSale: row.lastSale,
          trend: row.trend,
          conf: row.conf,
          depth: g.depth!,
          edgeUsd: row.med - g.allIn,
          risk: riskResult,
          rank,
          listedAt: l.itemCreationDate,
          affiliateUrl: l.itemAffiliateWebUrl,
          webUrl: l.itemWebUrl,
          marketplace: l.marketplaceId,
          evidenceUrl: evidenceUrl(identifiedVertical, key),
          surfacedAt: nowIso,
          ...(row.conf === 'thin' ? { thin: true as const } : {}),
        });
      } else {
        // "hunted — no book value": listing facts only — plus the context
        // tier's honest rollup when one covers the hit (never a valuation).
        const ctx = contextFor(l, contextIndex, entry);
        huntDeals.push({
          huntId: entry.id,
          huntLabel: entry.label,
          noBook: true,
          ...(l.buyingOptions?.includes('AUCTION') ? { auction: true as const } : {}),
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
          ...(ctx ? { context: toDealContext(ctx) } : {}),
        });
      }
      huntClaimed.add(l.itemId);
    }
    if (hFun.returned > 0 || huntPolled.length <= 20) {
      console.log(
        `[hunt] ${entry.id}: ${hFun.returned} returned · ${hFun.guardCut} guard-cut · ${hFun.gateCut} gate-cut · ${hFun.kept} kept`,
      );
    }
  }

  // 4 — SWEEP: the wide net. Cursored newly-listed pages per slice; the
  // seen-ledger and cursors persist in .starling-state (live mode only —
  // fixtures replay deterministically).
  const sweepState = loadSweepState();
  const swept = await sweep(SWEEP_SLICES, { mode, client, now, budgets: sweepBudgets, state: sweepState });
  if (mode === 'live') commitSweepState(sweepState, now);
  for (const s of swept) {
    stats.bySlice[s.slice.id] = { calls: s.calls, listings: s.listings.length };
    console.log(
      `[sweep] ${s.slice.id}: ${s.calls} calls · ${s.listings.length} listings` +
        (s.newest ? ` · newest ${s.newest}` : '') +
        (s.oldest ? ` · oldest ${s.oldest}` : '') +
        (s.degraded ? ' · DEGRADED (1697 fallback, slice filters dropped)' : ''),
    );
  }

  // 5 — BULK IDENTIFY: every swept listing through its slice's matchers,
  // against the in-memory book map — zero API calls. Cross-slice + hunt dedupe
  // by itemId (cards-slabs and cards-raw overlap by construction). The auction
  // lane splits off here: same identify→book-row path, its own gate (closing
  // calls are watch signals, not price calls) — and BIN dedupe must never
  // swallow it (an item is only ever in one lane; the postures don't overlap).
  const sweptListings: { l: EbayListing; slice: SweepSlice }[] = [];
  const auctionListings: { l: EbayListing; slice: SweepSlice }[] = [];
  {
    const claimed = new Set<string>(huntClaimed);
    for (const s of swept) {
      for (const l of s.listings) {
        if (claimed.has(l.itemId)) continue;
        claimed.add(l.itemId);
        (s.slice.lane === 'auction' ? auctionListings : sweptListings).push({ l, slice: s.slice });
      }
    }
  }
  stats.listingsEvaluated = sweptListings.length + auctionListings.length;

  const identifyOf = (l: EbayListing, slice: SweepSlice): { key: string; vertical: Vertical } | null => {
    for (const v of slice.identifyVerticals) {
      const m = matcherFor[v];
      if (!m) continue;
      const k = m.identify(l);
      if (k) return { key: k, vertical: v };
    }
    return null;
  };

  // pass 1 (title-only in live mode) chooses the Tier-2 shortlist: listings
  // already pinned to a BOOK ROW (aspects firm up cert #/ref before the deal
  // ships) plus watch-slice listings where a brand hit but no reference — the
  // "Reference Number" item-specific often pins what the title can't.
  const shortlist: EbayListing[] = [];
  for (const { l, slice } of sweptListings) {
    const id1 = identifyOf(l, slice);
    if (id1 && synced.byKey.has(id1.key)) shortlist.push(l);
    else if (!id1 && slice.identifyVerticals.includes('watches') && watchBrandOf(l)) shortlist.push(l);
  }
  const enrichedSweep = await enrich(shortlist, { mode, client, now, maxCalls: SWEEP_ENRICH_CALLS });
  const enrichedById = new Map(enrichedSweep.map((l) => [l.itemId, l]));

  // 6 — final identify → gate (reasons kept) → score, per swept listing
  const deals: Deal[] = [];
  const perVertical: Partial<Record<Vertical, PerVerticalStat>> = {};
  const statFor = (v: Vertical): PerVerticalStat => (perVertical[v] ??= { polled: 0, matched: 0, surfaced: 0 });
  for (const v of LAUNCH_VERTICALS) statFor(v);
  /** un-priced swept listings (no key, or key with no row) — the context pool */
  const contextPool: { l: EbayListing; slice: SweepSlice }[] = [];
  /** pokemon near-misses, so a zero-publish run is diagnosable from the log */
  const pokemonNearMisses: { title: string; allIn: number; med: number; depth: number }[] = [];

  for (const { l: raw, slice } of sweptListings) {
    const primary = slice.identifyVerticals[0];
    if (primary) statFor(primary).polled++;

    const l = enrichedById.get(raw.itemId) ?? raw;
    const hit = identifyOf(l, slice);
    if (!hit) {
      contextPool.push({ l, slice });
      continue;
    }
    stats.identified[hit.vertical] = (stats.identified[hit.vertical] ?? 0) + 1;
    let row = synced.byKey.get(hit.key);
    // No exact row? A card key missing ONLY its grade can still price via the
    // book's grade ladder (ladder.ts) — derived numbers, raised floor, and the
    // deal says so (basis:'ladder' + the source key).
    let ladderSourceKey: string | undefined;
    if (!row) {
      const lh = ladderRow(hit.key, hit.vertical, synced.book, ladderIndex);
      if (lh) {
        row = lh.row;
        ladderSourceKey = lh.sourceKey;
      }
    }
    if (!row) {
      // identity pinned, no book row — counted (the audit's "noBookRow" leak),
      // then handed to the context tier: it may still be a lead.
      bumpReason(hit.vertical, 'noBookRow');
      contextPool.push({ l, slice });
      continue;
    }
    const stat = statFor(hit.vertical);
    stat.matched++;

    let risk = matcherFor[hit.vertical]!.riskInputs(l);
    // opportunistic PSA cert verification (cards/pokemon)
    if (risk.certNumber && (hit.vertical === 'sports-cards' || hit.vertical === 'pokemon')) {
      const verdict = await verifyPsaCert(risk.certNumber, process.env.PSA_API_TOKEN, certCache);
      risk = applyCertVerdict(risk, verdict);
    }

    // Ladder-derived rows clear a raised floor (0.35; gate lifts thin rows to
    // 0.40 on its own) — a derived median is a weaker claim than a settled one.
    const g = gate(l, row, { now, ...(ladderSourceKey ? { minDepth: LADDER_MIN_DEPTH } : {}) });
    if (!g.pass) {
      if (g.reason) bumpReason(hit.vertical, REASON_KEY[g.reason] ?? g.reason);
      if (hit.vertical === 'pokemon') {
        pokemonNearMisses.push({ title: l.title, allIn: g.allIn, med: row.med, depth: g.depth });
      }
      continue;
    }

    const riskResult = scoreRisk(l, risk, hit.vertical);
    const rank = rankOf(row.med - g.allIn, g.depth, row.conf, riskResult.grade, evidenceWeightOf(row.lastSale, row.n12, new Date(now)), l.itemCreationDate, new Date(now));
    deals.push({
      id: dealId(l.itemId),
      itemId: l.itemId,
      legacyItemId: l.legacyItemId,
      vertical: hit.vertical,
      key: hit.key,
      title: l.title,
      imageUrl: l.imageUrl,
      allIn: g.allIn,
      itemPrice: l.price,
      shipping: l.shippingCost,
      med: row.med,
      lo: row.lo,
      hi: row.hi,
      n: row.n,
      ...(row.n12 !== undefined ? { n12: row.n12 } : {}),
      lastSale: row.lastSale,
      trend: row.trend,
      conf: row.conf,
      depth: g.depth,
      edgeUsd: row.med - g.allIn,
      risk: riskResult,
      rank,
      listedAt: l.itemCreationDate,
      affiliateUrl: l.itemAffiliateWebUrl,
      webUrl: l.itemWebUrl,
      marketplace: l.marketplaceId,
      // ladder deals deep-link to the SOURCE key — that's where the comps live
      evidenceUrl: evidenceUrl(hit.vertical, ladderSourceKey ?? hit.key),
      surfacedAt: nowIso,
      ...(row.conf === 'thin' ? { thin: true as const } : {}),
      ...(ladderSourceKey ? { basis: 'ladder' as const, basisKey: ladderSourceKey } : {}),
    });
    stat.surfaced++;
  }

  // The pokemon diagnosis, on the record: with sweeps, the old query price-band
  // shallow-flood is gone (gate does the filtering). If pokemon STILL zeroes
  // out, the basis question must be answerable from this log line alone.
  if ((perVertical.pokemon?.surfaced ?? 0) === 0 && pokemonNearMisses.length > 0) {
    console.warn(`[run-board] pokemon matched ${perVertical.pokemon?.matched ?? 0}, published 0 — near-misses:`);
    for (const nm of pokemonNearMisses.slice(0, 5)) {
      console.warn(
        `  · "${nm.title}" allIn=$${nm.allIn} med=$${nm.med} depth=${(nm.depth * 100).toFixed(1)}%`,
      );
    }
  }

  // 6a½ — THE GOLDMINE LANE (goldmine.ts, Aug 21 2026): targeted searches for
  // the book's highest-stakes LIVING rows — med × evidence-weight ordered,
  // deterministic rotation, budget carved off the BIN sweep in the scheduler.
  // "The goldmine IS the lectr DB": instead of hoping the category firehose
  // stumbles into a priceable identity, spend a quarter of discovery asking
  // eBay for the identities the book prices best. Hits ride the exact same
  // gate → risk → rank path as sweep hits.
  const gmQueries = compileGoldmine(synced.book.rows, matcherFor, now);
  const gmBudget = mode === 'live' ? goldmineBudget(SWEEP_SLICES) : 0;
  const gmWindow = goldmineWindow(gmQueries, now, gmBudget);
  const gmStats = { keys: gmWindow.length, listings: 0, surfaced: 0, closing: 0 };
  /** goldmine AUCTION finds — merged into the closing lane in 6b (Collin,
   *  Aug 21 2026: "most of the value items seem to be auction lots"; the
   *  category ending-soon sweep almost never pins a book row — 1,344→0 —
   *  but a by-key search arrives with identity pre-solved). */
  const goldmineClosing: AuctionCall[] = [];
  if (mode === 'live' && client && gmWindow.length > 0) {
    const dealItemIds = new Set<string>([...deals.map((d) => d.itemId), ...Array.from(huntClaimed)]);
    for (const { row, query } of gmWindow) {
      let page: EbayListing[] = [];
      try {
        // posture 'all': ONE call returns BIN + auction listings for the key
        page = await client.search(query, now, 50, 'all');
      } catch (e) {
        console.warn(`[goldmine] search failed for "${query.key}": ${(e as Error).message.slice(0, 120)}`);
        continue;
      }
      gmStats.listings += page.length;
      for (const l of page) {
        if (dealItemIds.has(l.itemId)) continue;
        const m = matcherFor[row.v];
        if (!m) continue;
        const k = m.identify(l);
        if (!k) continue; // identity IS relevance — unpinnable hits don't price
        // price against the PINNED key's row: usually the hunted key itself,
        // but any same-vertical book row counts (the query did the sweep's job)
        const prow = k === row.k ? row : synced.byKey.get(k);
        if (!prow) {
          bumpReason(row.v, 'noBookRow');
          continue;
        }
        // AUCTION hits route to the closing lane — wider 72h window because
        // the identity is book-certain; the section already says "bid will
        // move; watch signal, not a price".
        if (l.buyingOptions?.includes('AUCTION') && l.itemEndDate) {
          const cg = closingGate(l, prow, now, { windowMs: GOLDMINE_CLOSING_WINDOW_MS });
          if (!cg.pass) {
            if (cg.reason) bumpReason(row.v, REASON_KEY[cg.reason] ?? cg.reason);
            continue;
          }
          let arisk = m.riskInputs(l);
          if (arisk.certNumber && (row.v === 'sports-cards' || row.v === 'pokemon')) {
            const verdict = await verifyPsaCert(arisk.certNumber, process.env.PSA_API_TOKEN, certCache);
            arisk = applyCertVerdict(arisk, verdict);
          }
          dealItemIds.add(l.itemId);
          goldmineClosing.push({
            id: dealId(l.itemId),
            itemId: l.itemId,
            legacyItemId: l.legacyItemId,
            vertical: row.v,
            key: k,
            title: l.title,
            imageUrl: l.imageUrl,
            currentBid: l.price,
            bidCount: l.bidCount,
            endsAt: l.itemEndDate,
            shipping: l.shippingCost,
            allInBid: cg.allInBid,
            edgeUsd: prow.med - cg.allInBid,
            med: prow.med,
            lo: prow.lo,
            hi: prow.hi,
            n: prow.n,
            ...(prow.n12 !== undefined ? { n12: prow.n12 } : {}),
            lastSale: prow.lastSale,
            trend: prow.trend,
            conf: prow.conf,
            bidVsBook: cg.bidVsBook,
            risk: scoreRisk(l, arisk, row.v),
            listedAt: l.itemCreationDate,
            affiliateUrl: l.itemAffiliateWebUrl,
            webUrl: l.itemWebUrl,
            marketplace: l.marketplaceId,
            evidenceUrl: evidenceUrl(row.v, k),
            surfacedAt: nowIso,
          });
          gmStats.closing++;
          continue;
        }
        const g = gate(l, prow, { now });
        if (!g.pass) {
          if (g.reason) bumpReason(row.v, REASON_KEY[g.reason] ?? g.reason);
          continue;
        }
        let risk = m.riskInputs(l);
        if (risk.certNumber && (row.v === 'sports-cards' || row.v === 'pokemon')) {
          const verdict = await verifyPsaCert(risk.certNumber, process.env.PSA_API_TOKEN, certCache);
          risk = applyCertVerdict(risk, verdict);
        }
        const riskResult = scoreRisk(l, risk, row.v);
        const rank = rankOf(prow.med - g.allIn, g.depth, prow.conf, riskResult.grade, evidenceWeightOf(prow.lastSale, prow.n12, new Date(now)), l.itemCreationDate, new Date(now));
        dealItemIds.add(l.itemId);
        deals.push({
          id: dealId(l.itemId),
          itemId: l.itemId,
          legacyItemId: l.legacyItemId,
          vertical: row.v,
          key: k,
          title: l.title,
          imageUrl: l.imageUrl,
          allIn: g.allIn,
          itemPrice: l.price,
          shipping: l.shippingCost,
          med: prow.med,
          lo: prow.lo,
          hi: prow.hi,
          n: prow.n,
          ...(prow.n12 !== undefined ? { n12: prow.n12 } : {}),
          lastSale: prow.lastSale,
          trend: prow.trend,
          conf: prow.conf,
          depth: g.depth,
          edgeUsd: prow.med - g.allIn,
          risk: riskResult,
          rank,
          listedAt: l.itemCreationDate,
          affiliateUrl: l.itemAffiliateWebUrl,
          webUrl: l.itemWebUrl,
          marketplace: l.marketplaceId,
          evidenceUrl: evidenceUrl(row.v, k),
          surfacedAt: nowIso,
          ...(prow.conf === 'thin' ? { thin: true as const } : {}),
        });
        gmStats.surfaced++;
        statFor(row.v).surfaced++;
      }
    }
  }
  stats.goldmine = gmStats;
  console.log(
    `[run-board] goldmine: ${gmWindow.length}/${gmQueries.length} keys queried · ` +
      `${gmStats.listings} listings · ${gmStats.surfaced} BIN surfaced · ${gmStats.closing} auction watches` +
      (mode === 'live' ? '' : ' (fixture: lane idle)'),
  );

  // 6b — CLOSING CALLS: the auction lane. Same identify→book-row path as the
  // board, then the closing gate (gate.ts): ends within 4h, bidVsBook ≥ 0.40,
  // conf high|medium only, seller floor ≥ 50 — and NO scam cap, because a $1
  // opening bid is auction mechanics, not a fake-listing tell. The output is a
  // WATCH SIGNAL, published as its own board section, never mixed into deals.
  const closing: AuctionCall[] = [];
  {
    // goldmine auction finds lead the lane — dedupe by itemId as the category
    // sweep's own calls land below
    for (const c of goldmineClosing) closing.push(c);
    // pass 1 (title-only in live mode): only auctions already pinned to a book
    // row earn a getItems slot — aspects firm up cert #/ref before the call.
    const shortlist: EbayListing[] = [];
    for (const { l, slice } of auctionListings) {
      const id1 = identifyOf(l, slice);
      if (id1 && synced.byKey.has(id1.key)) shortlist.push(l);
    }
    const enrichedAuctions = await enrich(shortlist, { mode, client, now, maxCalls: AUCTION_ENRICH_CALLS });
    const auctionById = new Map(enrichedAuctions.map((l) => [l.itemId, l]));

    for (const { l: raw, slice } of auctionListings) {
      const l = auctionById.get(raw.itemId) ?? raw;
      const hit = identifyOf(l, slice);
      if (!hit) continue; // no identity, no signal — the closing lane has no context tier
      stats.identified[hit.vertical] = (stats.identified[hit.vertical] ?? 0) + 1;
      const row = synced.byKey.get(hit.key);
      if (!row) {
        bumpReason(hit.vertical, 'noBookRow');
        continue;
      }
      const cg = closingGate(l, row, now);
      if (!cg.pass) {
        if (cg.reason) bumpReason(hit.vertical, REASON_KEY[cg.reason] ?? cg.reason);
        continue;
      }

      let risk = matcherFor[hit.vertical]!.riskInputs(l);
      if (risk.certNumber && (hit.vertical === 'sports-cards' || hit.vertical === 'pokemon')) {
        const verdict = await verifyPsaCert(risk.certNumber, process.env.PSA_API_TOKEN, certCache);
        risk = applyCertVerdict(risk, verdict);
      }
      if (closing.some((x) => x.itemId === l.itemId)) continue;
      closing.push({
        id: dealId(l.itemId),
        itemId: l.itemId,
        legacyItemId: l.legacyItemId,
        vertical: hit.vertical,
        key: hit.key,
        title: l.title,
        imageUrl: l.imageUrl,
        currentBid: l.price,
        bidCount: l.bidCount,
        endsAt: l.itemEndDate!, // closingGate proved it parses and sits in-window
        shipping: l.shippingCost,
        allInBid: cg.allInBid,
        edgeUsd: row.med - cg.allInBid,
        med: row.med,
        lo: row.lo,
        hi: row.hi,
        n: row.n,
        ...(row.n12 !== undefined ? { n12: row.n12 } : {}),
        lastSale: row.lastSale,
        trend: row.trend,
        conf: row.conf,
        bidVsBook: cg.bidVsBook,
        risk: scoreRisk(l, risk, hit.vertical),
        listedAt: l.itemCreationDate,
        affiliateUrl: l.itemAffiliateWebUrl,
        webUrl: l.itemWebUrl,
        marketplace: l.marketplaceId,
        evidenceUrl: evidenceUrl(hit.vertical, hit.key),
        surfacedAt: nowIso,
      });
    }
  }

  // 6c — BOARD CARRY-FORWARD (carry.ts): the fix for the tick-snapshot gap
  // (bootstrap published 77 deals, the next incremental tick published 1).
  // Last tick's board deals that this tick's sweep did NOT re-catch get
  // re-verified alive in getItems batches: price unchanged-or-lower keeps
  // (refreshed), a raise re-gates against the frozen book call, absence drops
  // to receipts resolution. Survivors merge into `deals` (fresh wins on
  // itemId); publish.ts re-ranks the union and caps it at BOARD_CAP. The hunt
  // lane's noBook hits carry the same way (fact checks only) and still face
  // the per-target cap below. Closing calls are NOT carried — they expire
  // with the hammer, per-tick by design.
  const carried = await carryForward(
    loadBoardState(mode),
    {
      deals,
      huntDeals,
      huntClaimed,
      liveHuntIds: new Set(huntEntries.map((e) => e.id)),
      huntEntryById: new Map(huntEntries.map((e) => [e.id, e])),
      closing,
    },
    { mode, client, now },
  );
  deals.push(...carried.deals);
  huntDeals.push(...carried.huntNoBook);
  for (const c of carried.closing) {
    if (!closing.some((x) => x.itemId === c.itemId)) closing.push(c);
  }

  // 7 — CONTEXT LEADS: swept listings with NO book key but a covering context
  // rollup, at all-in ≤ 0.5× the rollup med. Facts + context, capped, labeled —
  // never a priced call (no depth, no rank, no gate override).
  const leadPool: { deal: HuntNoBookDeal; ratio: number }[] = [];
  for (const { l, slice } of contextPool) {
    const ctx = contextFor(l, contextIndex);
    if (!ctx) continue;
    const g = huntGate(l, {}); // fact checks only: a real price, no condition flag
    if (!g.pass) continue;
    if (!(g.allIn <= 0.5 * ctx.med)) continue;
    leadPool.push({
      ratio: g.allIn / ctx.med,
      deal: {
        huntId: `sweep:${slice.id}`,
        huntLabel: 'context lead — not a priced call',
        noBook: true,
        id: dealId(l.itemId),
        itemId: l.itemId,
        legacyItemId: l.legacyItemId,
        vertical: slice.lens,
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
        context: toDealContext(ctx),
      },
    });
  }
  // deepest-vs-rollup first; id as the deterministic tie
  leadPool.sort((a, b) => a.ratio - b.ratio || (a.deal.id < b.deal.id ? -1 : a.deal.id > b.deal.id ? 1 : 0));
  const leads = leadPool.slice(0, LEADS_CAP).map((x) => x.deal);

  // Per-target noBook cap (newest first): the lane is a watch list, not a
  // firehose — the uncapped first live run published 375 rows of payload.
  {
    const kept: typeof huntDeals = [];
    const perTarget = new Map<string, number>();
    const noBookSorted = huntDeals
      .filter((d) => d.noBook)
      .sort((a, b) => String(b.listedAt || '').localeCompare(String(a.listedAt || '')));
    for (const d of huntDeals.filter((x) => !x.noBook)) kept.push(d);
    let dropped = 0;
    for (const d of noBookSorted) {
      const c = perTarget.get(d.huntId) || 0;
      if (c >= NOBOOK_CAP_PER_TARGET) { dropped++; continue; }
      perTarget.set(d.huntId, c + 1);
      kept.push(d);
    }
    if (dropped) console.log(`[run-board] hunt: capped noBook to ${NOBOOK_CAP_PER_TARGET}/target (${dropped} dropped, newest kept)`);
    huntDeals.length = 0;
    huntDeals.push(...kept);
  }

  // 8 — publish the board (hunt section always present so /hunt can render
  // every target's watching/live state; leads + stats are schema-v2 additive)
  if (client) stats.calls = { search: client.calls.search, getItems: client.calls.getItems };
  const board = publishBoard(
    deals,
    perVertical,
    { builtAt: nowIso, bookBuiltAt: synced.book.builtAt },
    { targets: huntEntries.map(toHuntTarget), deals: huntDeals },
    { leads, stats, closing },
  );

  // 8b — persist the published live set for the next tick's carry-forward
  // (live only — fixture carry state is canned in fixtures/ebay/carry.json,
  // same determinism posture as sweep-state). What publish capped/sorted is
  // exactly what next run must re-verify, so the board artifact is the source.
  if (mode === 'live') {
    commitBoardState({
      deals: board.deals,
      huntNoBook: (board.hunt?.deals ?? []).filter(
        (d): d is HuntNoBookDeal => d.noBook === true,
      ),
      closing: board.closing ?? [],
    });
  }

  // 9 — receipts: record newly surfaced, resolve the ones that left BIN in
  // getItems batches (the getItems bucket, never the search quota). Priced
  // hunt hits are full deals — their calls go on the tape like any other.
  // Closing calls are tracked too (lane:'closing', frozen at the bid we saw);
  // the same absence-from-getItems loop resolves them when the hammer falls.
  // noBook hits and leads carry no call (no med/depth), so nothing to grade.
  const pricedHuntDeals = huntDeals.filter((d): d is HuntPricedDeal => !d.noBook);
  let receipts = loadReceipts();
  receipts = recordSurfaced(receipts, [...board.deals, ...pricedHuntDeals], nowIso);
  receipts = recordClosingSurfaced(receipts, board.closing ?? [], nowIso);
  // carried deals the re-verification batch proved GONE resolve immediately —
  // same getItems-absence signal as the loop below, already in hand this tick
  receipts = resolveEndedNow(receipts, carried.endedItemIds, nowIso);
  receipts = await resolveReceipts(receipts, { mode, client, now, nowIso, cap: 60 });
  commitReceipts(receipts);

  // summary — the funnel, one screen
  const byV = LAUNCH_VERTICALS.map((v) => `${v}:${perVertical[v]?.surfaced ?? 0}`).join('  ');
  const noBookCount = huntDeals.length - pricedHuntDeals.length;
  console.log(
    `[run-board] sweep: ${stats.listingsEvaluated} listings evaluated · ` +
      `identified ${JSON.stringify(stats.identified)} · calls ${JSON.stringify(stats.calls)}`,
  );
  console.log(`[run-board] gate reasons: ${JSON.stringify(stats.gateReasons)}`);
  const featuredCount = board.deals.filter((d) => d.tier === 'featured').length;
  console.log(
    `[run-board] published ${board.deals.length} deals ` +
      `(${featuredCount} featured · ${board.deals.length - featuredCount} worth a look)  ` +
      `[${byV}]  + ${leads.length} context leads`,
  );
  console.log(
    `[run-board] closing: ${auctionListings.length} ending-soon auctions evaluated → ` +
      `${board.closing?.length ?? 0} closing calls published (watch signals, not price calls)`,
  );
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
