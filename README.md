# Kabuyomi

Kabuyomi is an iOS + Cloudflare Workers app for reading SEC filings in Japanese with source-grounded AI answers.

## Repository Map

- `ios/`: current SwiftUI app generated with XcodeGen
- `workers/`: Cloudflare Workers API, Durable Objects, chat orchestration, quota, and filing history pipeline
- `sec-fetcher/`: SEC submissions and filing fetcher used by Workers
- `docs/`: product specs, as-built notes, and implementation handoff documents
- `artifacts/`: screenshot dumps and exported UI archives

## Current Product Shape

- Main iOS flow is `AppRootView -> ConversationEntryView -> CompanyView`.
- `SearchView` is now a utility sheet for ticker discovery, not the app root.
- `CompanyView` is split into focused subcomponents under `ios/Kabuyomi/Features/Company/`.
- Kabuyomi is currently a free beta. Billing / monetization remains intentionally disabled even though StoreKit and Worker scaffolding still exist in the repo.
- Beta chat is filing-grounded by default. External web supplements stay off unless you intentionally re-enable them for testing via Worker remote config.
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
- `DEBUG_UNLIMITED_ENABLED=true` only when you intentionally want a local Worker to honor the iOS DEBUG quota-bypass header

The repo default model lives in `workers/src/clients/gemini/request.ts` as `DEFAULT_GEMINI_MODEL`.
Set `GEMINI_MODEL` only when you want a local or deployed override, so model swaps do not require iOS code changes.

### 3. iOS

```bash
cd /Users/0xt4/t4dano/Kabuyomi/ios
xcodegen generate
open Kabuyomi.xcodeproj
```

Unit tests live under `ios/KabuyomiTests/` and can be run with `xcodebuild test` after generating the project.

## Current Beta Semantics

- Saved tickers are persistent on the server. In `/v1/usage`, `stocksUsed` means the current saved ticker count, not "today's stock consumption".
- Daily quota currently applies only to chats and resets on JST day boundaries.
- `/v1/watchlist/add` saves a ticker. `/v1/watchlist/remove` removes it and returns updated usage.
- `/v1/chat` returns `responsePath`; `modelName` is populated only when the answer actually used the remote Gemini path.
- `resetLocalData()` is a full "start over" reset: local saved data and chat history are cleared, device identity is regenerated, and usage may come back in a new-user state.
- `/v1/billing/sync` is intentionally disabled during beta and should return the beta-disabled response.

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
- The current background history seed targets the top 30 U.S.-listed issuers by market cap, normalized at the issuer/CIK level so class-share families such as `GOOG/GOOGL` or `BRK-A/BRK-B` count as one tracked company.
- Live annual coverage is intended to hold 3 years of `10-K` history for that top-30 tracked issuer set before any broader `10-Q` rollout.
- Free-tier-safe defaults currently cap one run to annual filings with `maxFilingsPerTicker=1` and `maxTotalFilings=8`.
- User-facing history chat stays narrow on purpose: each request hydrates at most 2 prior filings and does not do broad background sweeps.

Backfill example:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
BACKFILL_URL=http://127.0.0.1:8787 \
BACKFILL_SHARED_SECRET=replace-me \
node ./scripts/backfill-history.mjs AAPL MSFT --years=3
```

If no tickers are supplied, the worker uses the configured tracked tickers list.
That tracked ticker list is background ops config for refresh/backfill, not the user saved ticker source of truth.

## Ops Notes

Staging smoke calls the deployed Worker instead of carrying a second implementation:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_SMOKE_BASE_URL=https://your-staging-worker.example.workers.dev \
npm run smoke:staging
```

The smoke path covers `usage-baseline -> search -> watchlist/add -> company -> chat -> chat-history -> watchlist/remove -> billing-disabled`.
It also validates the current chat metadata contract: `responsePath` must be present, and `modelName` must be non-null only for the remote Gemini path.

## Historical Docs

- Older specs and handoffs under `docs/` are reference-only. Some still describe Home/Tab roots, monetization-forward work, or pre-slice quota language.
- Local coordination docs such as `docs/current_shipping_truth.md` and `CURRENT_SLICE.md` are intentionally kept out of Git.
- For the tracked repository, use `docs/testflight_readiness_checklist.md` and the current code as the current-behavior reference.
- Screenshot notes are consolidated at `artifacts/README.md` instead of keeping README files inside dated capture folders.

Project docs that were previously scattered in the repository root now live under `docs/`.
