/**
 * run-board.ts — the pipeline orchestrator (PROPOSAL §6.1).
 *
 *   sync book → plan (budget: cards capped, others floored) → poll → identify
 *   → enrich → cert-verify → gate → score → rank → publish → receipts
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
} from './types';
import { LAUNCH_VERTICALS } from './types';
import { MATCHERS, matcherFor } from './match/registry';
import { syncBook } from './sync-book';
import { planRun, type YieldMap } from './scheduler';
import { poll } from './poll';
import { enrich, verifyPsaCert, applyCertVerdict, type CertVerdict } from './enrich';
import { gate } from './gate';
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

  // 1 — sync the value book (the only lectr dependency; source per bookMode)
  const synced = await syncBook(bookMode, now);
  console.log(
    `[run-board] book: ${synced.book.rows.length} rows (${synced.source}${synced.stale ? ', STALE' : ''})`,
  );

  // 2 — plan: budget allocation (cards capped 40%, others floored 15%)
  const yields: YieldMap = {}; // first run: no trailing yield; even elastic split
  const plans = planRun(MATCHERS, synced.byVertical, yields);
  for (const p of plans) {
    console.log(`[run-board] plan ${p.vertical}: ${p.queries.length} queries / ${p.callBudget} calls`);
  }

  // 3 — poll (Tier-1)
  const polled = await poll(plans, { mode, client, now });

  // 4..7 — identify → enrich → cert-verify → gate → score, per vertical
  const certCache = new Map<string, CertVerdict>();
  const deals: Deal[] = [];
  const perVertical: Partial<Record<Vertical, PerVerticalStat>> = {};

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

    // enrich the shortlist (live only), then re-identify on real aspects
    const enriched = await enrich(
      pinned.map((p) => p.listing),
      { mode, client, now },
    );
    const enrichedById = new Map(enriched.map((l) => [l.itemId, l]));

    for (const { listing } of pinned) {
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

  // 8 — publish the board
  const board = publishBoard(deals, perVertical, {
    builtAt: nowIso,
    bookBuiltAt: synced.book.builtAt,
  });

  // 9 — receipts: record newly surfaced, resolve the ones that left BIN
  let receipts = loadReceipts();
  receipts = recordSurfaced(receipts, board.deals, nowIso);
  receipts = await resolveReceipts(receipts, { mode, client, now, nowIso });
  commitReceipts(receipts);

  // summary
  const byV = LAUNCH_VERTICALS.map((v) => `${v}:${perVertical[v]?.surfaced ?? 0}`).join('  ');
  console.log(`[run-board] published ${board.deals.length} deals  [${byV}]`);
  console.log(`[run-board] receipts: ${receipts.length} tracked`);
}

main().catch((e) => {
  console.error('[run-board] FAILED:', e);
  process.exit(1);
});
