# Starling

**Starling is a public deal board that points [lectr](https://lectr.bid)'s
certified price knowledge at eBay Buy It Now.** lectr knows what things actually
sell for — 1.1M lots, 761K settled auction prices, every value replayed against
history. Starling takes that value book, sweeps eBay's fixed-price listings on a
3-hourly cron, identifies the ones it can pin to a known key, and surfaces the
ones trading below their proven market — each with an evidence panel, a risk
grade, and a receipt tracked to outcome. Powered by lectr; static-export
Next.js on Cloudflare Pages; official eBay APIs only. Full spec:
[`PROPOSAL.md`](./PROPOSAL.md).

---

## Fixture-first workflow (no eBay access required)

The eBay production keyset + EPN approval is the one external long pole
(PROPOSAL §14). **The entire system builds and verifies without it** via
recorded fixtures — `STARLING_MODE=fixture` makes `poll`/`enrich` read
`fixtures/` instead of calling eBay, and every downstream stage (identify →
gate → score → publish → receipts → the board UI) runs the real code paths
offline.

```bash
npm ci                 # deps (Node ≥ 22)
npm run board:fixture  # run the whole pipeline against fixtures → public/data/starling/*.json
npm run dev            # http://localhost:3000 — see the board render the fixture deals
```

Also useful:

```bash
npm run test:matchers  # each matcher vs its fixture file (incl. abstain/scam/flag cases)
npm run typecheck      # tsc --noEmit
npm run build          # static export → out/  (what deploy.yml ships)
```

Every phase's definition of done includes **visual verification in situ** — run
the site and confirm the board renders with your own eyes, not just green tests.

---

## Going live (Collin's action items — PROPOSAL §14)

The only external dependencies. None of them block the fixture build; the moment
`EBAY_CLIENT_ID` is set as a repo secret, `board.yml` flips from fixture to live
with no code edit.

1. **eBay Developers account + production keyset** — *day 1*. Unlocks Browse at
   5,000 calls/day; nothing else blocks polling. → `EBAY_CLIENT_ID`,
   `EBAY_CLIENT_SECRET`.
2. **EPN application** (partnernetwork.ebay.com) once the P0 shell is live; a
   personal eBay account is fine. Yields the 10-digit campaign ID →
   `EPN_CAMPAIGN_ID`. Also the prerequisite for the Buy API Application if we
   later file it for scale.
3. **PSA public API token** — free account at psacard.com/publicapi, minutes →
   `PSA_API_TOKEN`. Cert verification is an opportunistic *upgrade*, never a
   dependency the pipeline blocks on.
4. **Register the domain** — default **starling.bid** (sister to lectr.bid).
5. **Create R2 bucket `starling-data`** + scope a Cloudflare API token that can
   read/write it → `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

### Secrets (repo settings → Actions secrets)

| Secret | What it is | Where to get it |
| --- | --- | --- |
| `EBAY_CLIENT_ID` | eBay OAuth client id (production keyset). **Empty ⇒ `board.yml` runs fixture mode.** | developer.ebay.com → your app keyset |
| `EBAY_CLIENT_SECRET` | eBay OAuth client secret — pairs with the id for the client-credentials grant | developer.ebay.com → same keyset |
| `EPN_CAMPAIGN_ID` | 10-digit EPN campaign id — stamped into affiliate links so EPN reporting splits revenue per vertical | partnernetwork.ebay.com |
| `PSA_API_TOKEN` | PSA public cert API bearer token — free authenticity upgrade for graded cards | psacard.com/publicapi |
| `CLOUDFLARE_API_TOKEN` | R2 read/write **and** Pages deploy. Scope: Account → Workers R2 Storage → Edit (state store) + Cloudflare Pages → Edit (deploy) | dash.cloudflare.com/profile/api-tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id — same Cloudflare account as `lectr-data` (find it in your CF dashboard URL) | Cloudflare dashboard |
| `LECTR_R2_TOKEN` | **Read-only** token scoped to lectr's private value-book object (`lectr-data/latest/value-book.json.gz`). The value book is lectr's crown jewel — it is NOT published publicly; live mode reads it from private R2 in-build. Empty ⇒ live mode fails closed (fixture still runs). | Cloudflare → R2 → scoped read token |
| `RESEND_API_KEY` | *(P4, later)* saved-key alert digests | resend.com |

> **Why private R2, not a public URL.** The value book distills lectr's entire
> price knowledge into one file; publishing it would hand competitors the moat.
> It stays in private R2 and only enters Starling's build. The one thing Starling
> publishes is `board.json`, which carries book numbers for just the currently-
> surfaced deals — the minimum a deal card needs to show its own evidence.
> Override the R2 location with `LECTR_R2_ACCOUNT_ID` / `LECTR_R2_BUCKET` /
> `LECTR_R2_BOOK_KEY` env vars if lectr emits it elsewhere.

---

## Data flow

```
R2 (private) lectr-data/latest/value-book.json.gz   the certified price knowledge
        │  sync-book.ts (live, scoped read token)  ·  fixtures/value-book.sample.json (fixture)
        ▼
   poll.ts        Tier-1 eBay item_summary/search sweeps — scheduler allocates
        │         the 5,000/day call budget (cards ≤40% cap, autographs/pokémon/
        │         editions ≥15% floors), quota ledger hard-stops before the limit
        ▼
   enrich.ts      Tier-2 getItem on shortlisted candidates — pulls localizedAspects
        ▼
   identify()     each vertical's matcher pins the listing to a book key, or ABSTAINS
        ▼
   gate           condition-flag + scam-cap (depth > 0.90) suppression
        ▼
   score          risk grade (A/B/…) + rank (depth × confidence × liquidity)
        ▼
   publish.ts     board.json → public/data/starling/   (committed to the repo)
        ▼
   receipts.ts    ledger append + outcome resolution (Starling's backtest)
```

The pipeline's **persistent state** — seen-ledger, receipts ledger, quota
ledger, scheduler wheel position, cert-verdict cache — lives in R2 (bucket
`starling-data`), not git, under `.starling-state/` locally. See
`scripts/lib/data-store.sh`.

## Infra

- **`board.yml`** — cron `15 */3 * * *` + manual dispatch. Pulls R2 state → runs
  the pipeline (live if `EBAY_CLIENT_ID` is set, else fixture) → pushes R2 state
  → commits the regenerated `public/data/starling/*.json` to `main`. That commit
  triggers the deploy.
- **`deploy.yml`** — on push to `main` touching `app/**` or `public/**`, builds
  the static export and `wrangler pages deploy out --project-name starling`.
- **R2 state store** (`scripts/lib/data-store.sh`) — write-once
  `versions/<UTC>-<sha>/state.tar.gz` payloads behind a single overwritten
  `latest/pointer.txt`, plus a `snapshots/YYYYMMDD/` rollback ladder. The
  write-once scheme dodges R2's 10–15min GET-lag on overwritten keys (the header
  comment explains it in full). Ported from lectr's proven `data-store.sh`.

## Repo layout

```
starling/
  app/                      # board UI (routes per PROPOSAL §4.2)
  scripts/
    sync-book.ts            # fetch value-book from private R2 (scoped read token)
    poll.ts  enrich.ts      # Tier-1 sweeps + Tier-2 enrichment
    run-board.ts            # pipeline entrypoint (npm run board[:fixture])
    match/                  # VerticalMatcher contract + per-vertical matchers
    score/                  # risk.ts, rank.ts
    publish.ts receipts.ts  # board.json emit + receipts ledger
    lib/
      data-store.sh         # R2 state store (this repo's, bucket starling-data)
      condition.ts ebay-types.ts id.ts slug.ts
  fixtures/                 # recorded eBay responses + sample value book (§11)
  public/data/starling/     # board.json — committed, baked into the export
  .github/workflows/        # board.yml (cron) · deploy.yml (Pages)
```

---

*Starling is powered by lectr (lectr.bid). See [`PROPOSAL.md`](./PROPOSAL.md)
for the full specification.*
