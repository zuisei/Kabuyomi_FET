# TestFlight Readiness Checklist

This checklist is for shipping the current Kabuyomi build to TestFlight.

Treat the current code as the source of truth over older specs. The ship target is the current conversation-first iOS app, not the older tab-based UI.

## Current Ship Scope

- iOS app built from `ios/project.yml` via XcodeGen
- Conversation-first flow: entry -> company conversation -> drawers/settings
- Supported filings: `10-K` and `10-Q` only
- Starter preview tickers: `AAPL`, `MSFT`, `NVDA`, `AMZN`, `TSLA`
- Billing is enabled with the current free/pro quota ladder
- Beta default is filing-grounded only. External web supplements stay disabled unless explicitly re-enabled for a controlled test.
- Saved tickers are persistent server-side; chat quota resets daily on JST boundaries
- Current limits: `free = 3` saved tickers / `10` chats per JST day, `pro = 20` saved tickers / `50` chats per JST day
- Chat metadata should follow `responsePath`; remote model naming should appear only for real remote Gemini execution
- Historical chat is narrow on purpose: explicit `3年` / `比較` / `推移` style prompts only
- Background history seed is the top 30 U.S.-listed issuers by market cap, using issuer-level normalization for class-share families and targeting 3 years of annual `10-K` coverage

## Not In Scope For This TestFlight

- `20-F`, `6-K`, `8-K`, or broader filing coverage
- public paid launch
- full cross-company comparison product
- broad notification system

## Exit Criteria

- A Release archive builds successfully.
- Workers and `sec-fetcher` are deployed with the expected secrets and storage bindings.
- The app copy consistently states saved tickers vs daily chat quota, the current free/pro ladder, and unsupported cases.
- Manual QA covers the main happy paths plus saved/remove/reset/limit/error paths.
- TestFlight metadata and tester notes explain that this is a limited beta, not investment advice.

## 1. Freeze The Beta Scope

- [ ] Do not add new product surface area until the first TestFlight build is out.
- [ ] Keep the filing scope explicit everywhere: `10-K / 10-Q` only.
- [ ] Keep the free/pro ladder and paywall copy aligned with the actual StoreKit SKU and Worker limits.
- [ ] Decide whether the initial drop is `internal testers only` or `small external beta`.
- [ ] Use the current conversation-first UI as the ship target. Do not block on reviving the older home/search/tab concept.

## 2. Backend Readiness

- [ ] Confirm Worker bindings exist in the target environment: `KV`, `D1`, `R2`, Durable Objects.
- [ ] Confirm `SEC_FETCHER_SHARED_SECRET` matches between Workers and `sec-fetcher`.
- [ ] Confirm Gemini API key and model config are set for the beta environment.
- [ ] Confirm `maintenanceMode = false` and `chatEnabled = true`.
- [ ] Confirm `webSupplementEnabled = false` unless you are intentionally running an external-supplement test.
- [ ] Confirm the default limits stay at `free 3 / 10` and `pro 20 / 50`, or intentionally update both StoreKit copy and Worker remote config together.
- [ ] Confirm `dailyRefreshEnabled` and any background tracked ticker list are intentional for beta load, and are not being described as the user saved ticker source of truth.
- [ ] Confirm the tracked history seed still matches the intended top-30 U.S. issuer roster and remains issuer-normalized across class shares.
- [ ] Confirm `/v1/watchlist/add` and `/v1/watchlist/remove` return updated usage with the current saved ticker semantics.
- [ ] Confirm `/v1/billing/sync` returns a synced entitlement payload in the target environment and that requests with `x-kabuyomi-original-transaction-id` resolve to `pro` usage.
- [ ] Run remote D1 migration if the target environment is fresh.

Reference commands:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler d1 execute kabuyomi-history --remote --file ./d1/migrations/0001_history.sql
npx wrangler deploy
npm run smoke:staging
```

`sec-fetcher`:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/sec-fetcher
npm test
```

## 3. Local Verification Before Upload

- [ ] `workers` tests pass.
- [ ] `workers` typecheck passes.
- [ ] `sec-fetcher` tests pass.
- [ ] Target-environment smoke passes after deploy.
- [ ] Xcode project is regenerated from `project.yml`.
- [ ] iOS unit tests pass on a real simulator destination.
- [ ] Release build succeeds.
- [ ] Release archive succeeds.

Reference commands:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm test
npm run typecheck
```

```bash
cd /Users/0xt4/t4dano/Kabuyomi/sec-fetcher
npm test
```

```bash
cd /Users/0xt4/t4dano/Kabuyomi/ios
xcodegen generate
xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5'
xcodebuild build -project Kabuyomi.xcodeproj -scheme Kabuyomi -configuration Release -destination 'generic/platform=iOS'
xcodebuild archive -project Kabuyomi.xcodeproj -scheme Kabuyomi -configuration Release -destination 'generic/platform=iOS' -archivePath /Users/0xt4/t4dano/Kabuyomi/build/Kabuyomi.xcarchive
```

If the local simulator name or OS differs, adjust only the `xcodebuild test` destination.

## 4. Release-Safety Checks In The iOS App

- [ ] Settings copy for Privacy Policy / Terms / Support is present and readable.
- [ ] Settings usage copy clearly separates persistent saved ticker count from today's chat count.
- [ ] AI consent flow appears before first chat send.
- [ ] Unsupported filing copy is consistent with the actual backend behavior.
- [ ] Error copy for daily chat limit, saved ticker limit, unsupported filing, and unsaved ticker access is clear.
- [ ] Response metadata shows a remote model badge only when the response actually used the remote Gemini path.
- [ ] Reset confirmation clearly states that saved data and chat history will be deleted, device identity will be regenerated, and usage may return to a new-user state.
- [ ] Reset local data returns the app to the entry/start state and does not leave stale UI state behind.
- [ ] Usage is re-fetched after reset and does not stay pinned to the pre-reset device identity.

Explicitly recheck these current product rules:

- [ ] Unsaved non-starter tickers are blocked until the user saves them.
- [ ] Starter tickers open without consuming saved ticker quota.
- [ ] Search shows unsupported tickers as unsupported instead of allowing save.
- [ ] Filing-grounded beta mode stays on by default, and no external supplement copy leaks into the main happy path unless intentionally enabled.
- [ ] Billing UI shows the actual free/pro ladder and the purchase / restore actions work end-to-end.

## 5. Manual QA Matrix

- [ ] First launch -> starter ticker selection -> company conversation opens.
- [ ] Search for a supported ticker and save it.
- [ ] Confirm the saved ticker count increases while the daily chat count does not change on save.
- [ ] Search for an unsupported ticker and confirm it cannot be saved.
- [ ] Open a saved ticker, send a normal filing question, and confirm grounded sources appear.
- [ ] Ask a `3年比較` style question and confirm the historical path behaves correctly.
- [ ] Hit chat quota and confirm the app shows the intended message.
- [ ] Hit saved ticker quota and confirm the app shows the intended message.
- [ ] Remove a saved non-starter ticker and confirm the saved ticker count decrements without changing today's chat count.
- [ ] Try to open an unsaved non-starter ticker and confirm the app blocks it cleanly.
- [ ] Use manual refresh on a company screen.
- [ ] Visit Settings and read Privacy / Terms / Support.
- [ ] Run Reset Local Data from Settings and confirm the app returns to the first-run entry state with refreshed usage.
- [ ] Submit one TestFlight feedback report from the app flow as a dry run.

Recommended QA seed set:

- `AAPL`
- `MSFT`
- `NVDA`
- one saved non-starter ticker with a recent `10-Q`
- one unsupported ticker whose latest filing is `20-F` or `6-K`

## 6. App Store Connect / TestFlight Setup

- [ ] Confirm bundle identifier, version, and build number are intentional.
- [ ] Upload the Release archive.
- [ ] Add beta app description that matches the actual scope.
- [ ] Add tester notes with the current limits and known unsupported cases.
- [ ] Fill the App Privacy questionnaire to match the current in-app privacy copy.
- [ ] If external testers are included, be ready for Beta App Review and keep the scope narrow.

Suggested tester note baseline:

- This is a limited beta for reading SEC `10-K / 10-Q` filings in Japanese.
- `20-F / 6-K` companies are not yet supported.
- Saved tickers are capped separately from the daily chat quota.
- Current limits are `free 3 / 10` and `pro 20 / 50`.
- The app is not investment advice and may contain summary or chat errors.
- Use TestFlight feedback with the ticker, question, screenshot, and repro steps.

## 7. First-Day Monitoring After Upload

- [ ] Watch Worker logs for quota denials, unsupported filings, and chat failures.
- [ ] Watch for `gemini_fallback_used` spikes.
- [ ] Watch for daily refresh failures.
- [ ] Review TestFlight crash reports and screenshot feedback the same day.
- [ ] Keep the first tester cohort small until the main failure patterns are understood.

## 8. Recommended Order

1. Freeze scope and decide `internal only` vs `small external`.
2. Verify backend config and deploy Workers.
3. Run local tests, Release build, and archive.
4. Execute the manual QA matrix on the archive candidate.
5. Upload to TestFlight and fill metadata.
6. Start with a small tester group and monitor logs closely.

## Current Code Anchors

- Xcode project source of truth: `ios/project.yml`
- Billing catalog: `ios/Kabuyomi/Services/BetaBilling.swift`
- StoreKit sync and purchase flow: `ios/Kabuyomi/Services/SubscriptionStore.swift`
- Search support gating: `ios/Kabuyomi/Models/APIModels.swift`
- Company access gating: `workers/src/routes/company.ts` and `workers/src/lib/quota.ts`
- Saved ticker quota semantics: `workers/src/durable/user-quota.ts`
- Watchlist add/remove flows: `workers/src/routes/watchlist-add.ts` and `workers/src/routes/watchlist-remove.ts`
- Chat response metadata: `workers/src/routes/chat.ts` and `ios/Kabuyomi/Persistence/PersistenceController.swift`
- Reset behavior: `ios/Kabuyomi/App/AppModel.swift`
- Beta limits and remote defaults: `workers/src/lib/remote-config.ts`
