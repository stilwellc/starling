# Starling — powered by lectr

**A public deal board that points lectr's certified price knowledge at eBay Buy It Now and surfaces listings sitting deep under what the corpus says they're worth — across every high-confidence pocket of the market, risk-ranked and evidence-backed.**

New repo, new app, new domain. Starling consumes lectr's data products; it never rebuilds them.

> **Build-ready edition (v2, Aug 14 2026).** This version is written so Opus can build end-to-end without coming back for answers: every lectr integration point is cited to real file:line, every artifact has a schema, the open questions have defaults, and there's a fixture-first plan so the build doesn't block on eBay's approval queue. The handful of external facts that must be re-verified against live docs are collected in §15.

---

## 1 · Thesis

lectr spent a year building the sell-side truth: a **1.1M+ sold-lot corpus** across six verticals, exact-identity keys that turn "similar items" into "the same item," certified repeat-sale indexes, and a value engine whose every call is replayed against history. That knowledge currently reads *auction* lots.

eBay Buy It Now is the largest fixed-price collectibles surface on earth, and it is priced by humans without that knowledge. Sellers misprice constantly — wrong comps, stale comps, no comps. **Starling is the arbitrage lens**: for every eBay listing whose identity we can pin, look up what that exact thing actually trades for in the corpus, and surface the ones listed deep below it.

The moat is not the eBay integration (anyone can call the Browse API). The moat is that a depth call is only as good as the value behind it, and the value book behind Starling has 761K+ settled prices, conformal bands, and a published backtest record.

---

## 2 · Design mandate: anti-cards-trap, calibrated

**This is a first-class constraint, not a preference — but read it precisely.**

Cards are simultaneously the vertical where lectr has the **most data** and the arena with the **most competition**: card comps are trivially findable by anyone (PSA pop reports, 130point, eBay sold filters), so card mispricings get sniped fast and the residual EV per surfaced deal is the lowest of any vertical. Meanwhile the opaque-comp verticals — watch references, art editions, autographs, design — are where lectr's corpus is a *genuine information advantage* nobody else holds. That's where Starling's differentiated EV lives.

The failure mode to engineer against is **hyper-indexing into cards by default**: the value book will contain 10× more card keys than anything else, so an unguarded scheduler would spend the whole eBay call budget on cards, the board would fill with card deals by sheer volume, and the differentiated verticals would starve — not because anyone chose that, but because data abundance silently became attention monopoly.

The rules, exactly:

- **Cards are first-class.** Full matcher, full polling, full board presence. A great card deal is a great deal.
- **Ranking stays honest — no cards penalty.** Board rank is `depth × confidence × risk` (§8), period. If a card deal earns the top slot, it gets the top slot. We do not cook the ranking.
- **The guard lives in the scheduler, where the skew originates.** Cards get a hard **cap of 40% of the daily eBay call budget**; each of the other three launch verticals gets a **floor of 15%** (§5.4). Key count doesn't set the budget — the budget is allocated, then keys compete within their vertical's slice.
- **Launch bar = vertical coverage, not deal volume.** Starling does not launch until at least **four verticals** are live on the board: watches (reference-keyed), sports cards, Pokémon, and art editions — with autograph material (science/culture) in the first post-launch milestone. A cards-only board is not a launchable state.
- **One matcher interface, N implementations** (§6). Every vertical gets its own real implementation; no vertical rides a degraded generic path.
- **The board defaults to the mixed view.** Vertical tabs are filters, not silos.
- **Per-vertical metrics from day one** (§10), never blended. If watches surface 3 deals/week and cards surface 300, that gap is a visible roadmap item, not a hidden fact.

lectr's own history justifies this: the non-card verticals looked weak until the recent audit proved they were merely *unmeasured* (culture coverage went 2%→53% the day single-point estimates were admitted). eBay will be the same — the non-card deals exist; the engineering has to go find them.

---

## 3 · What lectr supplies — the data contract, with real coordinates

Starling holds **no corpus copy**. It consumes one net-new nightly artifact: lectr's `value-book.json.gz`.

**The book is NOT published publicly — it is lectr's moat.** The value book distills lectr's entire price knowledge (every high-confidence identity key + median + band) into a single file; a public URL would hand any competitor the arbitrage lens without the year of corpus work behind it. So the book lives in lectr's **private R2** and Starling's build fetches it with a **read-only token scoped to that one object** (never shipped to the browser). The only lectr value data that reaches the public is `board.json` — and that carries book numbers for just the handful of currently-surfaced deals, the irreducible minimum a deal card needs to show its own evidence.

### 3.1 Where the data physically lives and how to hook in

| Artifact | How Starling reads it | Status |
|---|---|---|
| `value-book.json.gz` | **Private R2 GET** — `lectr-data/latest/value-book.json.gz` via the Cloudflare API with `LECTR_R2_TOKEN` (read-only, single-object scope) | **NET-NEW — must be built in the Ray repo first** (§3.4) |

Per-key **evidence deep-links** (`See the comps on lectr →`) still point at lectr's existing public per-item pages — that's the intended "powered by lectr" cross-sell, and it exposes one key at a time on click-through, never the bulk book.

Starling's `sync-book.ts` job fetches the book at the top of every cron run, verifies its build stamp is <48h old (else: flag the board stale, never poll against a stale book silently), and caches the parsed book for the run. That is the entire "DB integration" — one authenticated R2 read, no public exposure. Override the R2 coordinates with `LECTR_R2_ACCOUNT_ID` / `LECTR_R2_BUCKET` / `LECTR_R2_BOOK_KEY` if lectr emits it elsewhere.

### 3.2 `value-book.json.gz` — schema (versioned)

```jsonc
{
  "schema": 1,
  "builtAt": "2026-08-14T06:00:00Z",        // must match meta.json stamp
  "rows": [
    { "k": "mickey-mantle|1952|topps|311|PSA6",  // identity key (exact-class only)
      "v": "sports-cards",                        // vertical slug
      "med": 42000, "lo": 31000, "hi": 55000,     // recency-weighted median + band, USD
      "n": 9,                                     // settled sales behind it
      "lastSale": "2026-07-19",
      "trend": 0.38,                              // 1Y sub-index read where certified, else null
      "conf": "high" }                            // 'high' | 'medium' (low never ships)
  ]
}
```

### 3.3 The high-confidence bar — as the code actually defines it

The earlier draft said "n≥3, ≤24 months." The real machinery is better and already holdout-validated; the emitter reuses it verbatim rather than inventing a parallel bar:

- **Confidence tiers** are `'high' | 'medium' | 'low'` from `app/lib/value.ts:213-217`: `high` = comp pool ≥6 AND (best cosine ≥0.85 OR exact-identity n ≥4) AND dispersion ≤1.5; `medium` = pool ≥4 AND (cos ≥0.72 OR idn ≥3) AND dispersion ≤2.5. Fallback-tier pools can never claim `high`.
- **Recency** is continuous decay, not a hard window: half-life 2 years, weight `0.5^(ageYears/halflife)` folded into the weighted median (`value.ts:178-193`).
- **Cards-specific tier**: the card-comp path additionally requires `cardComps.n >= 3` (`scripts/close-board.ts:122`).
- **Book admission rule**: a row ships iff `conf ∈ {high, medium}` AND the key is exact-class (from the §3.5 key functions, never a fuzzy title pool). `n` and `lastSale` ship in the row so Starling can apply its own display gates (e.g. badge rows whose last sale is >24mo as "aging book").

### 3.4 The lectr-side work item (~1 day, in the Ray repo — build this FIRST)

- **Where**: `scripts/build-market.ts` — the nightly builder that already walks the per-vertical machinery. Add an `emitValueBook()` step that writes `value-book.json.gz` to **private R2** (`lectr-data/latest/value-book.json.gz`) via the existing `data-store.sh` push path — **NOT** into `SERVED = public/data/ray`. This is the one deliberate difference from lectr's other artifacts: the book must never land in the public static export.
- **When it runs**: the existing nightly workflow `.github/workflows/nightly.yml`, cron `0 6 * * *` (06:00 UTC). The artifact rides the normal deploy to Pages — no new infra.
- **Key functions to walk** (all existing, all cited):

| Vertical | Function | Location | Key shape / example |
|---|---|---|---|
| Sports cards | `cardKey` (corpus-side) | `scripts/sub-markets.ts:230` (app-side twin at `app/lib/cards.ts:248`) | `player\|year\|set\|no\|grade` → `mickey-mantle\|1952\|topps\|311\|PSA6` (+ optional `/serial`) |
| Pokémon | `pokemonKey` | `scripts/sub-markets.ts:316` | `year\|set\|no\|edition\|grade` → `1999\|base-set\|4\|1st\|PSA10`; edition ∈ `1st\|shadowless\|unl` |
| Watches | `numericWatchRef` | `app/lib/identity.ts:34` | `maker\|ref` → `patek-philippe\|3940`; digit required in ref; material axis separate via `watchMaterialCoarse` (`identity.ts:43`) |
| Art editions | `editionIdentityKey` | `app/lib/identity.ts:58` | `artist\|normalizedTitle` (strips `22/50`, AP/PP/HC, dates); gate on `isEditionLot` (`identity.ts:69`) |
| Autographs | entity + `autographFormatOf` | `app/lib/identity.ts:78` | format canon `als\|tls\|ans\|aqs\|ds\|ls\|check\|sp\|book` → `albert-einstein\|tls` |
| Design | `modelKey` | `app/lib/comps.ts:241` | title-derived model codes (`lc2`, `pk22`, `ch24`, `model 123`) |

- **Shared condition gate**: `hasConditionFlag(title)` in `scripts/lib/condition.ts:14` (regex covers damaged/as-is/cracked/trimmed/restored/miscut/etc., born from the "Missing Back at 96% under floor" incident documented at `condition.ts:2-9`). Port it verbatim into Starling — copy the file, note the provenance in a comment.

### 3.5 Attribution

Every Starling surface carries "powered by lectr" with deep links into lectr's evidence pages (the comps, the index, the backtest receipt). Starling is the buy-side face; lectr is the proof.

---

## 4 · Product: the deal board

Public site, same publishing DNA as lectr: static export, no accounts to browse.

### 4.1 The board

A ranked ledger of live Buy It Now deals. Each card:

- **The listing**: photo, title, **all-in price** (item + shipping — lectr's all-in doctrine applies on the buy side too), seller grade, time listed, marketplace flag.
- **The call**: `depth` — "38% under the book" — shown against `med` with the lo–hi band drawn, not just stated.
- **The evidence** (the lectr panel): `n` sales behind the number, last sale + date, trend where certified, confidence tier. One tap deep-links to lectr's evidence page for that key. Starling never manufactures a number.
- **The risk grade**: A/B/C/D chip with reasons spelled out on the card (§7).
- **Out-link**: the EPN affiliate URL (`itemAffiliateWebUrl`, §5.3). Affiliate disclosure must be **"unavoidable" and placed close to the out-links themselves** — EPN's FAQ explicitly says a disclosure buried in Terms/About pages is non-compliant. Put it on the board near the deal cards, not just the footer.

### 4.2 Routes (Next.js static export)

| Route | Content |
|---|---|
| `/` | Mixed board, rank order, vertical filter chips, risk filter |
| `/v/[vertical]` | Per-vertical board |
| `/deal/[id]` | Deal permalink: full evidence panel, risk breakdown, receipt status once resolved |
| `/tape` | The receipts tape: every surfaced deal and what happened (sold / ended / delisted, final price when visible) |
| `/about` | Thesis, methodology, the honesty rules, powered-by-lectr |

States to build deliberately: **empty vertical** ("book is live, no qualifying deals right now — last found: …") and **stale data** banner if the board artifact is older than 2 cron periods. No skeleton-forever states.

### 4.3 Views

Mixed (default) · per-vertical · "fresh" (recently listed, deepest first) · the tape. **Alerts are post-launch** (P4): saved identity-key searches → email digest, reusing lectr's existing Resend plumbing (`scripts/send-digest.ts:21-22`, `RESEND_API_KEY`/`RESEND_FROM`, posts to `api.resend.com/emails`).

---

## 5 · eBay integration (official APIs only)

### 5.1 Access + auth (verified against official docs, Aug 2026)

- **eBay Developers Program** account → production keyset. **A default production keyset gets Browse at 5,000 calls/day without any special approval** — search and getItem work in practice from day one. The formal "Buy API Application" path (Limited Release, partners-only) primarily gates checkout, Feed downloads, and higher volumes; its sequence is: join EPN → submit Buy API Application → EPN responds **within 10 business days** → support ticket + compliance review → sign Buy-API contracts. Docs are ambiguous on whether Browse formally requires this at all (the call-limits page footnotes "Buy APIs require an additional license" but the Browse overview carries no Limited Release label). **Spec-safe reading: build and launch on the default 5k/day keyset now; file EPN + the Buy application in parallel for scale and clean standing.**
- **OAuth**: client-credentials grant — `POST https://api.ebay.com/identity/v1/oauth2/token`, Basic auth = base64(clientId:clientSecret), body `grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope`. Confirmed `expires_in: 7200` (2h); cache in-process per cron run, refresh on 401.
- **EPN** (eBay Partner Network): signup at partnernetwork.ebay.com with an eBay account (personal account is fine — no business entity required); needs the site to exist in some form (the P0 shell is enough). Yields the **10-digit campaign ID**. Official docs don't state a turnaround; secondary sources say hours to ~5 business days. Note EPN membership is also the *prerequisite* for the Buy API Application above — so it's first in the sequence either way.

### 5.2 The two-tier call pattern (this shapes the whole budget)

- **Tier 1 — `GET /buy/browse/v1/item_summary/search`**: params `q`, `category_ids`, `filter=buyingOptions:{FIXED_PRICE},price:[..],priceCurrency:USD`, optional `aspect_filter`; headers `X-EBAY-C-MARKETPLACE-ID: EBAY_US` (v2: `EBAY_GB`, `EBAY_DE` — confirmed IDs). Summaries confirmed to include `price`, `condition`/`conditionId`, `seller.feedbackPercentage`/`feedbackScore`, `shippingOptions[].shippingCost`, `itemCreationDate`, `itemGroupType`, `buyingOptions`, image, `legacyItemId` — enough for a provisional all-in price and depth. `limit` max **200**/page, `offset` cap 9,999 (10K-item ceiling per result set — compiled queries must stay narrower than that anyway).
  - **Leaf-category trap (from the official filter doc)**: the `buyingOptions` filter is defined at the **leaf category level** and silently fails with top-level category IDs — compile queries against leaf categories. (FIXED_PRICE is also the search default, so the filter is belt-and-suspenders.)
  - `aspect_filter` requires the category ID repeated inside it: `aspect_filter=categoryId:<leaf>,Professional Grader:{PSA}`.
  - Accurate US shipping costs require the buyer-zip context header: `X-EBAY-C-ENDUSERCTX: contextualLocation=country%3DUS%2Czip%3D<zip>` (pick one fixed reference zip; note it in the methodology page).
- **Tier 2 — `GET /buy/browse/v1/item/{itemId}`**: full item detail including `localizedAspects` (array of `{name, type, value}`) — this is where the gold lives: `Professional Grader`, `Certification Number`, `Grade`, `Reference Number`, `Signed`, `Year`, `Set`. **Summaries confirmed to NOT carry aspects** — so the pipeline is: cheap Tier-1 sweeps → shortlist by provisional depth → Tier-2 enrichment only on candidates. Budget roughly 75/25 between tiers.
- **Live-status re-checks are cheap**: `getItem?fieldgroups=COMPACT` (must be used alone) returns just price/availability — eBay's docs explicitly bless it "for items you have stored." Use it for the receipts re-check loop (§6.1 step 9) so tracking surfaced deals costs a fraction of a full getItem.
- **Category IDs**: do not hardcode — resolve **leaf** categories via the Taxonomy API (`getCategorySuggestions`) during P0 and commit the mapping as a reviewed constants file with the resolution date in a comment.

### 5.3 Affiliate links

Send header `X-EBAY-C-ENDUSERCTX: affiliateCampaignId=<10-digit EPN campaign id>,affiliateReferenceId=<optional tracking id>` on Browse calls → responses include `itemAffiliateWebUrl` ("In order to receive commissions on sales, EPN affiliates must use this URL" — official). Use `affiliateReferenceId` to stamp the vertical, so EPN reporting splits revenue per vertical for free (§10). This header combines with the `contextualLocation` value (comma-separated in the same header). Use the returned URL verbatim; no hand-built rover links.

### 5.4 The scheduler — where the anti-cards guard lives

The value book generates the queries: for each book row, the vertical's matcher compiles an eBay query (§6). The scheduler then allocates the **daily call budget** (confirmed default: 5,000 calls/day per production keyset; raisable later via eBay's Application Growth Check):

- **Cards ≤ 40% of daily calls (hard cap). Watches, Pokémon, art editions ≥ 15% each (floors).** Remainder is elastic, spent where yield (deals found per call, §10) has been highest trailing-7-day. Cards would otherwise dominate purely by key count — the cap is a resource-allocation guard, **not** a statement that card deals are unwelcome (§2).
- Within a vertical: keys ranked by `med × trailing yield` — hot keys polled every cron tick, the long tail on a rotating daily wheel. The wheel position persists in R2 state so restarts don't re-poll the same head.
- A **quota ledger** (counter in R2 state, reset daily) hard-stops calls before the eBay limit; the run degrades gracefully (skips tail, never drops receipts/publish steps).
- Once real usage exists, file eBay's rate-increase / application-growth request (P4).

### 5.5 Cert verification (free authenticity upgrade)

- **PSA**: public cert API — `GET https://api.psacard.com/publicapi/cert/GetByCertNumber/{cert}`, `Authorization: bearer <token>` (free token generated after signing in at psacard.com/publicapi). Confirmed return model includes `Subject`, `Year`, `Brand`, `CardNumber`, `Variety`, `CardGrade`, `PrimarySigners`, `TotalPopulation`, `IsPSADNA` — enough to match card+grade against the claimed identity → risk grade A evidence, and the population fields are a bonus evidence-panel stat when non-null. **The free-tier quota is genuinely uncertain in 2026**: community docs say 100/day, but a mid-2026 secondary source claims PSA cut it to ~1/day with paid tiers via collectors-apis@collectors.com. Design defensively: budget ≤100/day, back off on HTTP 429, treat cert verification as an *upgrade* the system runs opportunistically — never a dependency the pipeline blocks on. Cache verdicts permanently in R2 (cert facts don't change), highest-value deals verified first.
- **CGC/BGS/SGC**: confirmed no public cert APIs in 2026 (web lookup pages only) — out of v1; slab-claimed-unverified = B-grade, which is honest.

### 5.6 Compliance (per the current API License Agreement, read in full Aug 2026)

Official API + EPN = clean ToS. Four obligations to engineer in:

1. **Delete-when-gone**: the ALA's Public Display clause requires that "when the eBay Content is no longer publicly available, you must delete it from your Application." Concretely: a sold/ended/delisted deal's live listing data (photo, title, price) comes **off the board immediately**; the tape entry keeps only *our own* record — the call we made, the book value, the outcome — not the dead listing's content. The oft-cited "refresh every 24h" rule does **not** exist in the current ALA; the operative mechanism is delete-when-gone plus keeping prices current via `COMPACT` re-checks (§5.2) — which the 3h cron satisfies comfortably.
2. **No co-mingling**: eBay Content "may not be co-mingled or combined with non-eBay Content… must be visually isolated from third-party listings." This directly constrains the P4 lectr cross-sell (§13.3): a lectr auction lot can't sit inside an eBay deal card — it must be a visually separate module.
3. **Affiliate disclosure**, unavoidable and adjacent to out-links (§4.1).
4. **No scraping in v1** — if a field gap ever forces it, that's a separate eyes-open decision. Note also eBay's 2026 banner that data-handling terms are actively changing — re-read the ALA at P3 launch.

---

## 6 · The matching engine

One contract, per-vertical plugins — the anti-cards-trap made structural:

```ts
interface VerticalMatcher {
  vertical: string;
  queriesFor(book: ValueBookRow[]): EbayQuery[];       // book → compiled search plan
  identify(listing: EbayListing): IdentityKey | null;  // listing → exact key, or ABSTAIN
  riskInputs(listing: EbayListing): RiskSignals;       // slab/cert/ref/papers evidence
}

interface EbayQuery  { key: string; q: string; categoryIds: string[]; aspectFilter?: string; }
interface RiskSignals { authenticityAnchor: 'cert-verified'|'slab-claimed'|'papers'|'raw';
                        certNumber?: string; grader?: string; conditionFlags: string[]; }
```

### 6.1 Pipeline (GitHub Actions cron, every 3h)

1. **Sync** — fetch value book + meta from lectr.bid; staleness check (§3.1).
2. **Poll** — Tier-1 sweeps per the scheduler's allocation → normalized listings; diff against the seen-ledger (skip already-processed itemIds at unchanged prices).
3. **Identify** — per-vertical `identify()`. Parse `localizedAspects` first, title as fallback. **Abstention is correct**: unparseable → dropped, never fuzzy-matched. lectr's parsers port directly — grade regexes (`sub-markets.ts`), ref extraction (`identity.ts:34`), edition normalization (`identity.ts:58`), format canon (`identity.ts:78`).
4. **Value** — key → book row. No row / `conf` missing → no deal.
5. **Gate** — `hasConditionFlag` (ported, §3.4) · all-in price incl. cheapest shipping option · **depth ∈ [0.25, 0.90]** — the exact gate proven in lectr's own deep-value board (`scripts/close-board.ts:128`): under 25% isn't a deal after fees/risk; **over 90% reads as fake/scam and is suppressed with a stated rule**, the one hard suppression in the system.
6. **Enrich** — Tier-2 getItem on gate survivors → full aspects → re-run identify/risk with real data; cert-verify where possible.
7. **Score** — §8 → board rank.
8. **Publish** — `board.json` → `public/data/starling/` → Pages deploy. Same write-once discipline as lectr.
9. **Receipts** — append new deals to the receipts ledger; re-check previously surfaced deals' live status; resolved deals (sold/ended/delisted, final price when visible) move to the tape. *This is Starling's calls-ledger — the trust engine and the marketing engine* (pattern: `scripts/lib/calls-ledger.ts` in Ray — NDJSON, first-call-wins append, graded against outcomes).

### 6.2 Worked examples (one per launch vertical — the fixture set starts from these)

- **Watches**: listing "Rolex Sea-Dweller 1665 Great White 1978 Matte Dial" + aspect `Reference Number: 1665` → `numericWatchRef` → `rolex|1665`. Book: `med 24500, n 14, conf high`. All-in $15,200 → depth 0.38. No numeric ref anywhere → abstain.
- **Cards**: aspects `Professional Grader: PSA, Certification Number: 12345678, Grade: 6, Player: Mickey Mantle, Year: 1952, Set: Topps, Card Number: 311` → `mickey-mantle|1952|topps|311|PSA6`; PSA API confirms cert → grade-A evidence.
- **Pokémon**: "1999 Pokemon Base Set 1st Edition Charizard #4 PSA 10" → `1999|base-set|4|1st|PSA10`. Missing edition token → abstain (unlimited vs 1st is a 10× price axis; guessing is the failure mode).
- **Art editions**: "KAWS Companion (Open Edition) screenprint, signed, 22/50" → `editionIdentityKey` → `kaws|companion-open-edition`; `22/50` stripped by normalizer; unnumbered/unsigned recorded as risk inputs, not identity.

---

## 7 · Risk model — everything shown, ranked honestly

No hard gating (sole exception: the >90% depth cap). Grade A–D, always explained on the card:

| Grade | Bar |
|---|---|
| **A** | Authenticity anchor machine-verified (PSA cert API match), seller ≥98% feedback with ≥100 ratings, aspects complete |
| **B** | Slab/papers/LOA claimed but unverified, decent seller, no condition flags |
| **C** | Raw item or thin listing (stock photo, sparse aspects) or newer seller |
| **D** | Multiple weak signals — shown at the bottom, reasons listed, never silently hidden |

Score = weighted signals: authenticity anchor (0–40) · seller feedback %, volume, top-rated, account age (0–30) · listing quality: aspect completeness, photo count, condition-qualifier hits (0–20) · per-vertical fake-rate prior (0–10; watches/autographs carry higher priors than slabbed cards — priced in, not hidden). Thresholds A ≥80, B ≥60, C ≥40, else D. Weights start as constants in one reviewed file (`score/risk.ts`) — tuned later against receipts, not vibes.

---

## 8 · Ranking

```
depth      = 1 − allIn/med                       // close-board.ts:127 formula, buy-side
confW      = { high: 1.0, medium: 0.6 }
riskW      = { A: 1.0, B: 0.85, C: 0.6, D: 0.3 }
freshBoost = 1.15 if listed < 24h else 1.0        // fresh deals get sniped; surface fast
rank       = depth × confW × riskW × freshBoost
```

No vertical term — §2. Constants live in one file with the rationale in comments.

---

## 9 · Architecture

Mirror lectr's proven infra — boring on purpose:

- **Repo**: `stilwellc/starling`, public (free Actions, same reasoning as lectr).
- **Stack**: Next.js 14 static export (`output:'export'`, `images.unoptimized`) → **Cloudflare Pages**, matching Ray's `next.config.js`/`deploy.yml` patterns (Node 22, npm, `tsx` for all scripts, `wrangler pages deploy out`). Zero server routes.
- **Layout**:

```
starling/
  app/                      # board UI (routes per §4.2)
  scripts/
    sync-book.ts            # fetch value-book/meta from lectr.bid
    poll.ts                 # Tier-1 sweeps (scheduler + quota ledger)
    enrich.ts               # Tier-2 getItem on candidates
    match/
      types.ts              # VerticalMatcher contract
      watches.ts  cards.ts  pokemon.ts  editions.ts   # P1; autographs.ts P3
    lib/condition.ts        # ported verbatim from Ray scripts/lib/condition.ts
    score/{risk.ts,rank.ts}
    publish.ts              # board.json → public/data/starling/
    receipts.ts             # ledger append + outcome resolution
    data-store.sh           # ported from Ray, bucket starling-data
  fixtures/                 # §11 — recorded eBay responses + sample value book
  .github/workflows/
    board.yml               # cron 15 */3 * * *  → sync→poll→…→publish→deploy
    deploy.yml              # push to main → Pages
```

- **R2 state**: bucket **`starling-data`** (same Cloudflare account as `lectr-data`). Copy Ray's write-once scheme (`scripts/data-store.sh` — its header documents why: R2 GET-lag of 10–15 min on overwritten keys): `versions/<UTC>-<sha>/state.tar.gz` write-once payloads, `latest/pointer.txt` as the only overwritten object, `snapshots/YYYYMMDD/` rollback ladder. State = seen-ledger NDJSON, receipts ledger NDJSON, quota ledger, scheduler wheel position, cert-verdict cache.
- **Secrets** (repo settings, day one): `EBAY_CLIENT_ID` · `EBAY_CLIENT_SECRET` · `EPN_CAMPAIGN_ID` · `PSA_API_TOKEN` · `CLOUDFLARE_API_TOKEN` (Account → Workers R2 Storage → Edit, per Ray's data-store.sh header) · `CLOUDFLARE_ACCOUNT_ID` · later `RESEND_API_KEY`. Workflows get `permissions: contents: write` from day one (Ray learned this via 403s — commit `43e4005`).
- **`board.json` schema** (versioned like the value book): `{ schema: 1, builtAt, deals: [{ id, itemId, vertical, key, title, img, allIn, itemPrice, shipping, med, lo, hi, n, lastSale, trend, conf, depth, risk: {grade, reasons[]}, rank, listedAt, affiliateUrl, marketplace }], perVertical: {<v>: {polled, matched, surfaced}} }`.
- **Not in v1**: accounts, comments, per-listing price-drop tracking, non-eBay marketplaces (Mercari/Whatnot/Chrono24 are natural v2+ — the matcher contract is marketplace-agnostic on purpose).

---

## 10 · Success metrics (per vertical, always — never blended)

- **Coverage**: book keys with ≥1 live eBay match found this week.
- **Yield**: deals surfaced / calls spent (this feeds the scheduler's elastic allocation, §5.4).
- **Truth**: receipts — % of surfaced deals that sold, median sold-vs-book. *Did the market agree the deal was real?* This is Starling's backtest.
- **Honesty**: `identify()` abstention rate (high is fine; **wrong matches are the failure mode**, so also track receipt-discovered misidentifications, target ~0).
- Revenue (later): EPN earnings per vertical.

Emitted as `perVertical` in every `board.json`; a small `/about` methodology table renders the current numbers publicly.

---

## 11 · Fixture-first build plan (do not block on eBay approval)

eBay keyset + EPN approval is the external long pole. The entire system builds and verifies without it:

- `fixtures/ebay/` — hand-authored `item_summary/search` and `getItem` response JSONs per launch vertical (start from §6.2's worked examples; match real Browse API response shapes from the docs; ~10 listings per vertical including abstain cases, condition-flag cases, and one >90%-depth scam case).
- `fixtures/value-book.sample.json` — ~50 rows across the four launch verticals (schema §3.2), used until the real lectr emitter lands.
- `STARLING_MODE=fixture` env var: `poll.ts`/`enrich.ts` read fixtures instead of calling eBay; everything downstream (identify → gate → score → publish → receipts → UI) runs the real code paths offline.
- eBay also has a **sandbox environment** (sandbox keyset, no approval wait) — use it to validate auth + request shapes while production approval is pending; sandbox data is junk, so fixtures remain the correctness harness.
- **Definition of done for every phase includes visual verification in situ** — run the site, screenshot the board rendering fixture deals, confirm with eyes. Not just tests.

---

## 12 · Phases, with acceptance criteria

- **P0 · Keys + contract (week 1)**
  Collin (external, start day 1): eBay dev account + production keyset request + EPN application + PSA API token + domain registration.
  Opus: lectr-side `value-book.json.gz` emitter in the Ray repo (§3.4) merged and writing to **private R2** (`lectr-data/latest/value-book.json.gz`) after one nightly, plus a read-only `LECTR_R2_TOKEN` scoped to that object; Starling repo scaffold; board shell deployed to Pages; fixtures authored; category-ID mapping resolved.
  ✅ *Done when: value book fetches from lectr.bid with sane row counts per vertical; fixture board renders end-to-end; screenshot verified.*
- **P1 · Four matchers, together (weeks 2–4)** — watches, cards, Pokémon, editions built **in parallel against the shared contract** (subagent-per-vertical, the lectr expansion-house pattern). Scheduler with cap/floors + quota ledger. Real polling live once keys arrive (whichever week that is — fixtures until then).
  ✅ *Done when: each matcher passes its fixture suite incl. abstain cases; internal board shows real (or fixture) deals from all four verticals; per-vertical metrics emitting.*
- **P2 · Risk + receipts (week 5)** — risk grades + PSA cert verification, receipts ledger, the tape, deal permalinks with live-status re-check.
  ✅ *Done when: a surfaced fixture deal flows to a resolved tape entry; risk reasons render on cards; scam-cap case suppressed with the rule stated in logs.*
- **P3 · Launch (week 6)** — public board + EPN links + disclosure + powered-by-lectr cross-links + autograph matcher (the fifth vertical, not the forgotten one).
  ✅ *Go/no-go bar: four verticals each showing ≥1 real deal surfaced by real polling in the launch week; receipts flowing; affiliate links resolving.*
- **P4 · Alerts + expansion** — saved-key alerts/digest (Resend), design/`modelKey` vertical, EBAY_GB/EBAY_DE, quota-increase application, second-marketplace scoping.

---

## 13 · Decisions & defaults (formerly "open questions" — Opus proceeds on these, Collin can override any of them)

1. **Domain**: default **starling.bid** (sister to lectr.bid). Wordmark lowercase "starling." Visual identity: its own palette (dawn/first-light against lectr's golden hour), but inherit the certificate/ledger design language — evidence panels should feel like the same family of instruments.
2. **Marketplaces**: `EBAY_US` only in v1; GB/DE in P4 (watches + editions upside — supports the coverage goal).
3. **lectr cross-sell** ("or buy it at auction for less" when a live lectr lot beats the eBay price): yes, but P4, behind a flag — and as a **visually separate module**, never inside an eBay deal card (the ALA's no-co-mingling clause, §5.6.2).
4. **Receipts cadence**: live `/tape` page from P2; weekly digest post is a P4 marketing add-on.

## 14 · Collin's action items (the only external dependencies)

1. eBay Developers account + production keyset — **day 1**. This alone unlocks Browse at 5,000 calls/day; nothing else blocks polling.
2. EPN application as soon as the P0 site shell is live (personal account is fine; it's also the prerequisite for the Buy API Application if we later file it for scale — §5.1).
3. PSA public API token (free account at psacard.com/publicapi, minutes).
4. Register the domain (default starling.bid).
5. Create R2 bucket `starling-data` + scope the API token (or hand Opus a token that can).

## 15 · External facts: what's verified vs still open (checked against official docs, Aug 2026)

**Verified from official sources** (safe to build on): Browse endpoints/params/response fields as specced in §5 · 5,000 calls/day default Browse quota, raised via the Application Growth Check · 200/page, 10K-result ceiling · leaf-category filter behavior · EPN header format and `itemAffiliateWebUrl` · marketplace IDs (`EBAY_US`/`EBAY_GB`/`EBAY_DE`) · ALA delete-when-gone + no-co-mingling clauses (and the *absence* of a 24h-refresh rule) · Buy API Application sequence and its 10-business-day EPN review · PSA endpoint, auth, and response schema.

**Still unverified — hold loosely, confirm during P0**: EPN approval turnaround (secondary: hours–5 business days) · PSA's current free-tier quota (conflicting 100/day vs ~1/day claims — the §5.5 defensive design absorbs either) · post-Growth-Check quota numbers · whether Browse formally requires the Buy API Application at scale (docs internally inconsistent; §5.1's spec-safe reading covers it) · eBay's in-flight 2026 data-handling term changes (re-read the ALA at P3).

---

*Prepared for Opus · August 14, 2026 · Starling is powered by lectr (lectr.bid) — 1.1M lots, 761K settled prices, every call replayed against history.*
