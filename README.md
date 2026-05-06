# Kabuyomi

Kabuyomi is an iOS + Cloudflare Workers app for reading SEC filings in Japanese with source-grounded AI answers.

## Repository Map

- `ios/`: current SwiftUI app generated with XcodeGen
- `workers/`: Cloudflare Workers API, Durable Objects, chat orchestration, quota, and filing history pipeline
- `sec-fetcher/`: SEC submissions and filing fetcher used by Workers
- `legal-site/`: Cloudflare Pages-ready static legal pages for App Store metadata and public legal links
- `docs/`: organized release, legal, quality, AdMob, and historical documentation
- `artifacts/`: screenshot dumps and exported UI archives

## Current Product Shape

- Main iOS flow is `AppRootView -> ConversationEntryView -> CompanyView`.
- `SearchView` is now a utility sheet for ticker discovery, not the app root.
- `CompanyView` is split into focused subcomponents under `ios/Kabuyomi/Features/Company/`.
- v1 submission scope is a Japanese SEC filing reader for U.S. stocks, limited to `10-K` / `10-Q`.
- v1 chat is filing-grounded by default and must not be described as web search, investment advice, buy/sell recommendation, stock-price forecast, or target-price service.
- v1 monetization is consumable credits only. The only visible paid IAP product is `kabuyomi.credits.100`, which grants 100 paid credits for ¥200.
- Paid credits do not expire. Free/promotional credits and ad credits are separate from paid credits.
- AdMob rewarded-credit infrastructure exists, but the normal rewarded-credit UI is hidden for v1 App Review and deferred to v1.1 / post-approval.
- Subscriptions, Lite / Pro / Pro Max public plans, the ¥500 pack, App Attest, DeviceCheck, account systems, 8-K support, and web search are v1.1+ or later.
- Public legal pages are served from `https://kabuyomi-legal-site.pages.dev`. Worker `/legal/*` routes are legacy API-hosted fallback copies, not the preferred App Store metadata surface.
- Workers routes live under `workers/src/routes/`; shared logic is split across `workers/src/lib/` and `workers/src/clients/gemini/`.

## Quick Start

### 1. SEC Fetcher

```bash
cd /Users/0xt4/t4dano/Kabuyomi/sec-fetcher
npm install
SEC_FETCHER_SHARED_SECRET=replace-me npm run dev
```

### 2. Workers

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm install
cp .dev.vars.example .dev.vars
npm run test
npm run dev
```

Local Workers development expects:

- `SEC_FETCHER_BASE_URL=http://127.0.0.1:8789`
- the same `SEC_FETCHER_SHARED_SECRET` in `workers/.dev.vars`
- optional overrides such as `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `SEC_FETCHER_TIMEOUT_MS`, and `BACKFILL_SHARED_SECRET`

The repo default model lives in `workers/src/clients/gemini/request.ts` as `DEFAULT_GEMINI_MODEL`.
Set `GEMINI_MODEL` only when you want a local or deployed override, so model swaps do not require iOS code changes.

### 3. iOS

```bash
cd /Users/0xt4/t4dano/Kabuyomi/ios
xcodegen generate
open Kabuyomi.xcodeproj
```

Unit tests live under `ios/KabuyomiTests/` and can be run with `xcodebuild test` after generating the project.

### 4. Static Legal Site

```bash
cd /Users/0xt4/t4dano/Kabuyomi/legal-site
npm run validate
```

Preferred public legal URLs:

- `https://kabuyomi-legal-site.pages.dev/privacy/`
- `https://kabuyomi-legal-site.pages.dev/terms/`
- `https://kabuyomi-legal-site.pages.dev/support/`
- `https://kabuyomi-legal-site.pages.dev/tokushoho/`

## Current v1 Semantics

- Saved tickers are persistent on the server. In `/v1/usage`, `stocksUsed` means the current saved ticker count, not "today's stock consumption".
- Opening a ticker is independent from saving it. `/v1/company/{ticker}` and `/v1/chat` require a device identity, but they do not consume or require a saved ticker slot.
- Free/promotional credit applies to chats and resets according to the server-provided reset time.
- Free-plan quota identity currently trusts the client-provided `x-device-key`. That is acceptable for the current beta, but it is not abuse-resistant because rotating keys can evade the free limits; production hardening would need a server-issued identity or attestation.
- `/v1/watchlist/add` saves a ticker. `/v1/watchlist/remove` removes it and returns updated usage.
- `/v1/chat` returns `responsePath`; `modelName` is populated only when the answer actually used the remote Gemini path.
- `resetLocalData()` is a full "start over" reset: local saved data and chat history are cleared, device identity is regenerated, and usage may come back in a new-user state.
- `/v1/credits/purchase-grant` and `/v1/ios/purchases/credits/complete` require Worker-side App Store Server verification before granting paid credits.

## Storage And History

- `KV`: latest filing alias, remote config, hot filing cache
- `D1`: 3-year history index for `trend / compare` style questions
- `R2`: archived filing payloads such as `sourceChunks`, `mdaText`, and summary JSON

`/v1/chat` uses KV-backed current filings by default. Only explicit history prompts such as `3年`, `比較`, `推移`, `trend`, or `compare` use the D1 path.

When a user explicitly asks for a 3-year comparison and the D1 index does not yet have enough rows, chat now auto-hydrates only the minimum missing history:

- `10-K`: up to 2 prior annual filings
- `10-Q`: up to 2 prior same-quarter filings
- historical auto-hydration uses fallback-only summaries to avoid Gemini cost for archive preparation
- if comparable filings still are not available, chat responds explicitly that the historical window is still insufficient instead of silently falling back to a single-filing answer

### D1 Migration

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler d1 execute kabuyomi-history --local --file ./d1/migrations/0001_history.sql
npx wrangler d1 execute kabuyomi-history --remote --file ./d1/migrations/0001_history.sql
```

### Backfill Guardrails

- Treat D1 as an index only; keep large filing payloads in R2.
- Prefer small batch runs over broad backfills.
- Default rollout is annual `10-K` first, then narrow `10-Q` top-ups for saved or explicitly requested tickers.
- The curated 30-company seed remains available for manual backfill/update, but scheduled background refresh is disabled unless ops explicitly enables it.
- The tracked ticker list is capped at 30 issuers and normalized at the issuer/CIK level so class-share families such as `GOOG/GOOGL` or `BRK-A/BRK-B` count as one tracked company.
- Free-tier-safe defaults currently cap one run to annual filings with `maxFilingsPerTicker=1` and `maxTotalFilings=8`.
- User-facing history chat stays narrow on purpose: each request hydrates at most 2 prior filings and does not do broad background sweeps.

Backfill example:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
BACKFILL_URL=http://127.0.0.1:8787 \
BACKFILL_SHARED_SECRET=replace-me \
node ./scripts/backfill-history.mjs AAPL MSFT --years=3
```

If no tickers are supplied, the worker uses the configured tracked tickers list, falling back to the curated 30-company seed.
That tracked ticker list is background ops config for refresh/backfill, not the user saved ticker source of truth.

Filing cleanup is dry-run by default. It targets old extractor versions only, preserves old D1 rows that do not yet have a current-version replacement, and requires `--execute` before any KV/D1/R2 deletion:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
CLEANUP_URL=http://127.0.0.1:8787 \
BACKFILL_SHARED_SECRET=replace-me \
npm run cleanup:filings -- AAPL MSFT --only-disagreeing-metrics
```

After reviewing the returned manifest, rerun with `--execute` to delete the listed candidates.

## Ops Notes

Staging smoke calls the deployed Worker instead of carrying a second implementation:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_SMOKE_BASE_URL=https://your-staging-worker.example.workers.dev \
npm run smoke:staging
```

The smoke path covers `usage-baseline -> search -> watchlist/add -> company -> chat -> chat-history -> watchlist/remove -> billing-sync`.
It also validates the current chat metadata contract: `responsePath` must be present, and `modelName` must be non-null only for the remote Gemini path.

## Historical Docs

- Start from `docs/INDEX.md` for the maintained documentation map.
- Current v1 release truth lives at `docs/release/RELEASE_TRUTH.md`.
- Current shipping snapshot lives at `docs/release/CURRENT_SHIPPING_TRUTH.md`.
- App Review notes live at `docs/release/APP_STORE_SUBMISSION_NOTES.md`.
- TestFlight readiness notes live at `docs/release/TESTFLIGHT_READINESS_CHECKLIST.md`.
- Older specs and handoffs under `docs/archive/` are reference-only. Some still describe Home/Tab roots, subscription-era monetization, old beta quota language, or broader product plans.
- Screenshot notes are consolidated at `artifacts/README.md` instead of keeping README files inside dated capture folders.

Project docs that were previously scattered in the repository root now live under `docs/`.
