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
  `localizedAspects`). Shape defined in `scripts/lib/ebay-types.ts`.

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
