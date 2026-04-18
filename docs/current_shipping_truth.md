# Current Shipping Truth

Last updated: 2026-04-18

This file is the current authoritative ship snapshot for Kabuyomi beta.
When an older spec or handoff disagrees with this file, the current code wins.

## Authoritative Files

- iOS route and app state: `ios/Kabuyomi/App/AppRootView.swift`, `ios/Kabuyomi/App/AppModel.swift`
- iOS project generation: `ios/project.yml`
- Worker routing and backend behavior: `workers/src/index.ts`, `workers/src/routes/*`, `workers/src/lib/*`
- Worker deploy config: `workers/wrangler.toml`
- SEC proxy runtime: `sec-fetcher/server.mjs`, `sec-fetcher/src/sec-service.mjs`
- Ship readiness checklist: `docs/testflight_readiness_checklist.md`

## Current User Flow

- First launch: `ConversationEntryView`
- Return path: `CompanyView(rootConversationTicker)`
- Search path: `SearchView` as a helper sheet or drawer path, not an app root
- Main chat path: `POST /v1/chat` with `filingKey`
- Main history path: explicit `3年` / `比較` / `推移` style prompts only

## Current Beta Scope

- In scope: iOS conversation-first filing reader, Worker-backed filing fetch and chat, `10-K` / `10-Q`, starter preview tickers, narrow historical comparison
- In scope: source-grounded filing answers, local caching, quota enforcement, billing-disabled beta messaging
- Out of scope: `20-F`, `6-K`, `8-K`, push, AdMob, public monetization, StoreKit reactivation, broad cross-company comparison

## Active vs Retained Paths

- Active path: `ConversationEntryView -> CompanyView`, `search`, `company`, `watchlist/add`, `chat`, `usage`, `internal/backfill/history`
- Retained but beta-disabled: `billing/sync`, `SubscriptionStore`, `EntitlementDO`, StoreKit and monetization scaffolding
- Historical reference only: older tab/home specs and refactor handoffs under `docs/specs/` and `docs/handoffs/`

## Beta Policy Locks

- Beta default is filing-grounded chat. `webSupplementEnabled` stays off unless intentionally re-enabled for a controlled test.
- The iOS debug unlimited toggle is a local/dev-only tool. The Worker only honors `x-kabuyomi-debug-unlimited` when `DEBUG_UNLIMITED_ENABLED=true` and the request is running against a local/test host.
- `ios/Kabuyomi.xcodeproj` is generated output. `ios/project.yml` is the project source of truth.

## Verification Snapshot

- Confirmed local on `2026-04-18`: `workers` tests passed (`75/75`), `npm run typecheck` passed, `sec-fetcher` tests passed (`7/7`), iOS unit tests passed via `xcodebuild test` on `iPhone 16 / iOS 18.5`
- Confirmed live on `2026-04-18`: deployed Worker smoke passed for `usage -> search -> watchlist/add -> company -> chat -> chat-history -> billing-disabled` against `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Confirmed live on `2026-04-18`: `GET /v1/search?q=AAPL` returned `200` with `snapshotUpdatedAt = 2026-04-17T18:00:33.815Z`
- Confirmed live on `2026-04-18`: `sec-fetcher` health returned `200` from `https://kabuyomifet-production.up.railway.app/health`
- Unconfirmed: deployed Worker code revision vs current local worktree parity
- Unconfirmed: live KV `remote_config` contents, including whether `webSupplementEnabled` has been manually re-enabled in runtime
