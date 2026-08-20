# Fixtures — the offline correctness harness

Starling builds and verifies end-to-end **without** eBay production access. eBay
keyset + EPN approval is the external long pole (PROPOSAL §14); the whole system
runs against these recorded fixtures until it lands, driven by
`STARLING_MODE=fixture` (see `scripts/run-board.ts`).

## Files

- **`value-book.sample.json`** — a stand-in for lectr's `value-book.json.gz`.
  Schema = `ValueBook` in `scripts/types.ts`. Owned by the foundation; matchers
  read it, never edit it. The real book is fetched from
  `https://lectr.bid/data/ray/value-book.json.gz` in live mode (`sync-book.ts`).

- **`ebay/<vertical>.json`** — recorded eBay listings for one vertical. Each file
  is a JSON array of **`EbayRawItem`** objects (the `getItem` shape, i.e. WITH
  `localizedAspects`). Shape defined in `scripts/lib/ebay-types.ts`. Consumed by
  `npm run test:matchers` (the per-matcher assertion harness).

- **`ebay/sweep.json`** — the SWEEP ENGINE's recordings (the Aug 2026 rebuild):
  a JSON object mapping **sweep slice id** (see `SWEEP_SLICES` in
  `scripts/sweep.ts`) → an array of `EbayRawItem`, the listings that slice's
  category pages "returned". This file is what drives `npm run
  pipeline:fixtures` through sweep → bulk identify → gate(stats) → context →
  publish. Keep at least: a watches slice with a reference hit that prices
  against the book, a pokemon slice with a deal that PASSES the gate (plus a
  gated near-miss so the reason histogram is non-empty), and a context-only
  slice (fossils) with a lead priced ≤ 0.5× its context rollup's med. The
  sample book's `context` array must carry the rollups those leads hit
  (a `charles-schulz` signer row, a `megalodon-tooth` class row, a
  player-object row).

  The Aug 2026 additions keep three more cases alive here:
  - a **cards-slabs** listing that pins to the book's `conf:"thin"` row at
    depth ≥ 0.40 (the "thin book" badge path), and one that pins to a key the
    book only covers at a NEIGHBORING grade, priced via `gradeLadder`
    (`basis:"ladder"` at depth ≥ 0.35);
  - a `*-closing` AUCTION slice (`watches-closing`) with one call that clears
    `closingGate` (bidVsBook ≥ 0.40, ends in-window) and one too-shallow bid
    that lands in the reason histogram. Auction fixtures use
    `currentBidPrice`/`bidCount` (no `price`) and a **relative end date** —
    `"itemEndDate": "+102m"` = 102 minutes after the injected run `now`
    (`fixture-source.ts` resolves it) — because a pinned ISO end would age out
    of the hard 4h window a day after being recorded.

- **`ebay/carry.json`** — the CARRY-FORWARD lane's recordings (`scripts/
  carry.ts`): a SECOND RUN in a can. `prior` is the previous tick's published
  board — `Deal` / `HuntNoBookDeal` shapes verbatim, itemIds disjoint from
  `sweep.json`/`hunt.json` so every entry is a true not-re-swept candidate —
  and `items` is the getItems re-verification "response": itemId → the
  `EbayRawItem` as it reads NOW (current price), or `null`/missing for a
  listing eBay no longer serves. Keep every carry path alive: alive-unchanged
  (carried), repriced-down (refreshed), ended (dropped → receipts resolution),
  repriced-up past the depth floor (re-gate FAIL), repriced-up still clearing
  (re-gate PASS), plus one noBook hunt hit alive and one ended. In fixture
  mode this file replaces `.starling-state/board-state.json` entirely — the
  state dir stays untouched (the determinism contract, same as sweep-state).

- **`ebay/hunt.json`** — the hunt lane's recordings (PROPOSAL §4.4): a JSON
  object mapping **hunt entry id** (from `hunt/priority.yaml`) → an array of
  `EbayRawItem`, the listings that entry's compiled queries "returned". Keyed by
  entry id, not vertical, because a hunt target IS the query. An id absent here
  is a target with nothing live (the `/hunt` page's "watching" state). Keep at
  least: one entry whose hits pin to a book row (priced + depth), one raw-terms
  entry whose hits have no book row (the "hunted — no book value" path), one
  scam-cap case and one condition-flag case — so `npm run pipeline:fixtures`
  exercises the whole hunt path.

## The fixture contract (each matcher owns its vertical's file)

In fixture mode the pipeline treats each `EbayRawItem` as both the search result
and the enriched item (aspects already present), so a single file exercises the
full poll → identify → gate → score → publish path.

Every vertical fixture file MUST include, at minimum:

1. **≥3 listings that a correct `identify()` pins to a real key** in
   `value-book.sample.json` — at varying depths so the board shows a spread
   (one deep ~40% under, one shallow ~26%, one just below the surface).
2. **≥1 abstain case** — a listing your `identify()` must return `null` for
   (missing the axis that sets identity: no numeric ref, no edition token, raw
   with no grade, etc.). Wrong matches are the failure mode; abstention is correct.
3. **≥1 condition-flag case** — title carries a qualifier `hasConditionFlag`
   catches (e.g. "cracked slab", "as-is"); must be gated out.
4. **≥1 scam case** — priced so `depth > 0.90`; must be suppressed with the rule.
5. Realistic `localizedAspects` (the eBay item-specifics your matcher parses
   first) AND a realistic `title` (the fallback path). Include a listing that
   identifies from title alone (sparse aspects) to prove the fallback.

Prices are USD. `shippingOptions[0].shippingCost.value` is the cheapest ship
option; the gate computes all-in = item + shipping. Pin `itemCreationDate`
relative to nothing — use fixed ISO dates (the pipeline reads them as-is).

See `scripts/match/test-matchers.ts` for the assertion harness that runs each
matcher against its own fixture file and checks the expectations above.
