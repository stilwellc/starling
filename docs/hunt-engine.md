# Hunt engine

Starling's primary job is now an **acquisition hunt**: 35 checked-in hunts (22 acquisition hunts plus the 13 Bell System Technical Journal grails, moved in from the deal board on Sep 25 2026) are searched on live eBay (official Browse API) every tick. Every listing is evaluated against deterministic rules, the evidence is persisted, and under-cap inventory is shown first on `/` and served at `/api/v1/*`. The deep-value deal board is kept as a secondary feature at `/board`.

## Path mapping (prompt → this repo)

| Prompt suggested | Actual | Why |
|---|---|---|
| `src/hunt/hunts.ts` | `scripts/hunt-engine/hunts.ts` | The repo has no `src/`. Pipeline code lives in `scripts/` and pages in `app/`. |
| `src/jobs/scan.ts` | `scripts/hunt-engine/scan.ts` (orchestrator) + `scripts/hunt-engine/cli.ts` (entry) | Same convention as `scripts/run-board.ts`. |
| `GET /api/v1/{status,hunts,alerts}` | Cloudflare Pages Functions in `functions/api/v1/*.ts` | The site is a static export (`output: 'export'`), so Next can't serve dynamic routes. `wrangler pages deploy out` picks up `functions/` from the repo root. |
| R2 object model | bucket `starling-data`, prefix `hunt/` | Same bucket and Cloudflare REST API as `scripts/lib/data-store.sh`. |
| `public/dashboard.json` | R2 `hunt/public/dashboard.json`, plus the deployed copy at `public/data/starling/hunt/dashboard.json` | The page is built from the deployed copy, and the Functions read the same file, so the run ID always matches. |

## Files

**Engine** (`scripts/hunt-engine/`)
- `hunts.ts`: the 22 acquisition hunts and the 13 BSTJ grails (`GRAILS`, watch-only, originals only), collection meta, notes, the manual research brief, and the alias lists. This file is the source of truth; there is no Notion.
- `validate.ts`: ids unique and slugged, exactly 22 active, caps positive or `null`, queries and terms nonempty. A bad config throws before any provider call.
- `text.ts`: case- and punctuation-tolerant whole-word phrase matching (tolerates a trailing plural "s").
- `evaluate.ts`: classifies each candidate as under, over, watch or reject, with machine-readable reasons and flags, a confidence score, all-in, dollars under and percent under, `taxExcluded`, and the cap wording.
- `provider.ts`: `EbayBrowseProvider`. OAuth client credentials, token cached until 60s before expiry. `PAGE_SIZE` is 100 and `MAX_PAGES` is 10, so each hunt is searched to completion (up to 1,000 listings). 20s timeout. Error handling:
  - 401 or 403: auth failure; the provider stops.
  - 429: hard stop for the rest of the run, keeping the rate-limit headers.
  - A timeout or malformed page: that hunt fails, or is partial if earlier pages succeeded.
  - Credentials are redacted from all messages.
- `fixture-provider.ts`: recorded payloads. Tests and explicit local fixture mode only.
- `env.ts`: live is the default and fails closed without eBay or storage credentials. Fixture mode is refused when `CI` or `GITHUB_ACTIONS` is set.
- `store.ts`: `R2RestStore` (production), `FileStore` (local) and `MemoryStore` (tests).
- `ledger.ts`: alert dedupe and material versions.
- `sink.ts`: optional webhook (`STARLING_ALERT_WEBHOOK_URL`).
- `dashboard.ts`: the single versioned view model, plus the pure API response builders shared with the Functions.
- `scan.ts`: the orchestrator.
- `cli.ts`: the command-line entry.
- `tests/*.test.ts`: `node:test` via tsx.

**Other files**
- **Functions**: `functions/api/v1/{_shared,status,hunts,alerts}.ts`.
- **UI**: `/` is the Hunt view, `/board` the deep-value board (moved), `/hunt` the BSTJ lane (now labeled "Grails"), `/hunts/brief/` the read-only brief. Also `app/lib/hunt-data.ts` and the hunt components.
- **Budget: hunts first, the board gets the rest.** Each tick's share of the 5,000/day quota is `PER_RUN_CALLS` = 625. The engine runs first, searches every hunt to completion, and writes what it actually spent to `.starling-state/hunt-usage.json` (`scripts/hunt-engine/usage.ts`). `run-board.ts` then budgets 625 minus that spend (`boardDailyBudget` in `scripts/scheduler.ts`). If the usage file is missing or older than 90 minutes, the board assumes the engine's worst case (`HUNT_ENGINE_MAX_CALLS_PER_RUN` = 22 × 10 = 220), so the two together can never exceed the quota.
- **Workflows**:
  - `board.yml`: validates the hunt list, then runs the hunt scan, then the board. `workflow_dispatch` takes an optional `hunt_id` for a single-hunt run, which skips the board. The existing `board` concurrency group means one production writer.
  - `deploy.yml`: refuses a fixture hunt payload, runs typecheck and tests, and watches `functions/**` and `scripts/hunt-engine/**`.
- `.env.example`: variable names only.

## Data flow

```
hunts.ts ─validate─▶ for each hunt (priority order):
   Browse search (paginated) ─▶ normalize ─▶ evaluate (reasons/flags) ─▶ R2 runs/{run}/raw + evaluations
 ─▶ merge into manifest (unsearched/failed hunts carry last good results, marked "carried")
 ─▶ ledger (material changes only) ─▶ optional sink
 ─▶ dashboard.json ─▶ R2 public/dashboard.json + public/data/starling/hunt/dashboard.json
 ─▶ manifests/{run}.json then manifests/latest.json (promotion, last) ─▶ runs/{run}/summary.json
 ─▶ board.yml commits public/data/starling ─▶ deploy.yml builds the page + Functions from the same file
```

## Persistence (R2 `starling-data`, prefix `hunt/`)

```
runs/{runId}/summary.json               immutable: coverage, per-hunt state, provider health, counts, promotion, alerts
runs/{runId}/raw/ebay/{huntId}.json     raw Browse pages as returned
runs/{runId}/evaluations/{huntId}.json  every candidate, kept or rejected, with reasons and flags
listings/ebay/{itemId}.json             latest normalized listing (retained candidates)
manifests/{runId}.json                  immutable promoted manifest
manifests/latest.json                   the pointer, written last (one PUT, atomic)
alerts/ledger.json                      dedupe tracks and the alert queue
public/dashboard.json                   the published view model
```

**Promotion policy**
- `success` (35 of 35 searched) and `partial` (at least one hunt searched) promote.
- `failed` (nothing searched) writes its summary and the ledger but never touches `manifests/latest.json`. The last good results stay live and every hunt row shows `failed`.
- A hunt the run could not search keeps its last good observations, marked `carried`. It is never replaced by an empty list.

**Coverage states per hunt**: `complete`, `partial`, `failed`, or `not-searched`. `stale` is computed at read time, when the run finished more than `STARLING_STALE_AFTER_MINUTES` (default 240) ago. A complete hunt with no retained listings is a real "0 matches". Any other state is never rendered as zero.

## Pricing and classification

- `allIn` = item price + lowest listed shipping. `underBy` = cap − allIn. `underPct` = underBy / cap. Tax is excluded and labeled.
- Missing shipping gives `allIn = null` and a classification of `watch`. It can never become an under.
- Auctions use the current bid and say "under cap now", never "under cap".
- A `null` cap means watch-only. It does not mean uncapped buying.

## Alerts

- **Key**: `ebay:{itemId}:{huntId}:v{N}`.
- **N advances only on**:
  - the first time a listing is seen under cap
  - a crossing from over (or unknown) to under
  - a price drop while under, of at least $25 or 5% of the last alerted all-in, whichever is larger
  - new authenticity evidence in the title (photo matched, MeiGray, COA, PSA/DNA, and so on)
- Timestamps and punctuation changes are not material.
- A pending alert expires when its listing is no longer an under in a hunt this run searched completely. An unsearched hunt never expires anything.
- **Delivery and review are separate states.** If no sink is configured, the pending feed is the whole notification mechanism. A failed delivery stays pending and records only the status and error class.

## Commands

```
npm run hunt:validate      validate the 35 hunts
npm run hunt:test          engine tests
npm test                   matcher harness + engine tests
npm run hunt:scan          live scan (needs EBAY_* and R2 credentials; fails closed)
npm run hunt:scan:fixture  explicit local fixture scan (writes a FIXTURE-labeled payload; refused in CI)
npm run typecheck
npm run build
```

Do not commit a fixture `public/data/starling/hunt/dashboard.json`. The deploy workflow refuses it.

## Migration risks

- **Budget**: the board's share now varies by tick: 625 minus what the hunts used (typically about 30–60 calls, at most 220). The BSTJ reserve and the board's lanes are proportional, so each flexes with it.
- **Home route**: `/` changed from the deal board to the Hunt view. Old links to `/` land on the hunts, and the board is one click away at `/board`.
- **Functions**: the first deploy with Functions adds a Worker in front of `/api/*` only, via the auto-generated `_routes.json`. Static pages are unaffected.
- **R2 GET lag**: the R2 REST API can serve a stale object for a short time after a PUT (see `data-store.sh`). Runs are 3h apart, so the ledger and manifest reads are unaffected in practice.
- **Lint**: `next lint` has no ESLint installed or configured in this repo, so it prompts interactively. It was not run.
- **Unchanged**: the value book integration, `receipts.json`, and the BSTJ lane (`hunt/priority.yaml`).

## Grails (moved Sep 25 2026)

The 13 BSTJ grails that ran inside the deal board (`hunt/priority.yaml`, now an intentionally empty list) are hunts 23–35 in `hunts.ts`, section "Bell System Technical Journal":
- They are watch-only (no cap), exactly as before.
- They use the originals-only exclusions (reprint, facsimile, photocopy, PDF, print-on-demand and so on).
- Their title rules match the old lane: journal name + year for the per-year hunts, plus the roman-numeral and "BSTJ" catch-alls.

When one listing matches several hunts, only the highest-priority hunt keeps it; the others record `claimed-by-earlier-hunt:<id>`. This matters for the catch-alls. `/hunt/` now forwards to `/#hunts-grails`. The engine's worst case is now 35 × 10 = 350 calls per tick; the board still gets whatever the hunts leave.

## Access (PIN gate, Sep 25 2026)

The whole site is private. `functions/_middleware.ts` runs in front of every request: pages, `/data/*.json` and `/api/v1/*`.

- **Browsers** get a PIN screen. The correct PIN sets an HttpOnly, Secure cookie (an HMAC of the PIN) for 30 days.
- **Agents** send the PIN in an `X-Starling-Pin` header.
- **Where the PIN lives:** the GitHub secret `STARLING_PIN`. `deploy.yml` pushes it to the Pages project as a secret before each deploy and refuses to deploy if it's missing. It is never in this public repo.
- **If the PIN is unset, the gate fails closed** and serves a 503.
- **Strength:** a 4-digit PIN keeps the site private from casual visitors and search engines. It is not strong security: wrong attempts are slowed, but not rate-limited per IP.

## v2 (Sep 25 2026): evidence, feedback, cadence

- **Item details** (`enrich.ts`): candidates that pass the title rules get an eBay `getItem` lookup, unders first. The limit is 40 lookups per run, cached in R2 `details/ebay/` for 24h, or less if the price moves. The rules read the item specifics:
  - "Original/Licensed Reprint", a print production technique, or a "not game used" value → reject.
  - Original, signed, or an authenticator (PSA/JSA/Beckett/MeiGray/Fanatics/Resolution) → a reason. An authenticator clears the sports "no authentication" flag.
  - The description: provenance language lowers forgery risk; reproduction or replica language raises it to high.
- **Photos** (`enrich.ts`): a 64-bit dHash of each candidate's small eBay image (`jpeg-js`). The same photo on other listings (Hamming distance ≤ 6) is flagged `photo-reused:<n>`: high risk for art, medium for sports.
- **Price history and relists** (`ledger.ts`): each track keeps up to 12 price points, and cards show "was $X · since …" with a sparkline. The same seller relisting the same title under a new item id is flagged `relisted` (medium risk).
- **Feedback** (`feedback.ts` and `functions/api/v1/feedback.ts`): "Not it" and "Block seller" on each card POST to `/api/v1/feedback`. Each choice is one R2 object under `feedback/`, and the next run drops those listings (reject reasons `dismissed-by-you`, `seller-blocked`). A seller dismissed twice is blocked automatically (`seller-blocked:learned`). The function reaches R2 with the Pages secrets `STARLING_R2_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, which `deploy.yml` pushes.
- **Cadence and budget**:
  - The hunts now also run hourly: `board.yml` has a second cron for the non-board hours that skips the board.
  - The board reserves three hunt runs' worth of search calls per 3-hour window: `625 − 3 × hunt spend`.
  - A run stops paginating at `CALL_CEILING` = 170 calls (later hunts get their first page, marked partial). A run's worst case is therefore 205, so three fit in a window.
