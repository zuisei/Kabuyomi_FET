# TestFlight Readiness Checklist

This checklist is for shipping the current Kabuyomi build to TestFlight.

Treat the current code as the source of truth over older specs. The ship target is the current conversation-first iOS app, not the older tab-based UI.

## Current Ship Scope

- iOS app built from `ios/project.yml` via XcodeGen
- Conversation-first flow: entry -> company conversation -> drawers/settings
- Supported filings: `10-K` and `10-Q` only
- Starter preview tickers: `AAPL`, `MSFT`, `NVDA`, `AMZN`, `TSLA`
- Beta billing disabled
- Default free beta limits: `3` saved tickers and `3` chats per JST day
- Historical chat is narrow on purpose: explicit `3年` / `比較` / `推移` style prompts only

## Not In Scope For This TestFlight

- `20-F`, `6-K`, `8-K`, or broader filing coverage
- public paid launch
- full cross-company comparison product
- broad notification system

## Exit Criteria

- A Release archive builds successfully.
- Workers and `sec-fetcher` are deployed with the expected secrets and storage bindings.
- The app copy consistently states the current beta limits and unsupported cases.
- Manual QA covers the main happy paths plus the common limit/error paths.
- TestFlight metadata and tester notes explain that this is a limited beta, not investment advice.

## 1. Freeze The Beta Scope

- [ ] Do not add new product surface area until the first TestFlight build is out.
- [ ] Keep the filing scope explicit everywhere: `10-K / 10-Q` only.
- [ ] Keep billing disabled for this beta.
- [ ] Decide whether the initial drop is `internal testers only` or `small external beta`.
- [ ] Use the current conversation-first UI as the ship target. Do not block on reviving the older home/search/tab concept.

## 2. Backend Readiness

- [ ] Confirm Worker bindings exist in the target environment: `KV`, `D1`, `R2`, Durable Objects.
- [ ] Confirm `SEC_FETCHER_SHARED_SECRET` matches between Workers and `sec-fetcher`.
- [ ] Confirm Gemini API key and model config are set for the beta environment.
- [ ] Confirm `maintenanceMode = false` and `chatEnabled = true`.
- [ ] Decide whether the default free beta limits stay at `3 / 3` or are raised before inviting testers.
- [ ] Confirm `dailyRefreshEnabled` and the tracked ticker list are intentional for the beta load.
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

- [ ] `DEBUG`-only unlimited mode is not reachable in TestFlight or Release.
- [ ] Settings copy for Privacy Policy / Terms / Support is present and readable.
- [ ] AI consent flow appears before first chat send.
- [ ] Unsupported filing copy is consistent with the actual backend behavior.
- [ ] Error copy for chat limit, watchlist limit, unsupported filing, and unsaved ticker access is clear.
- [ ] Reset local data works and does not leave stale UI state behind.

Explicitly recheck these current product rules:

- [ ] Unsaved non-starter tickers are blocked until the user saves them.
- [ ] Starter tickers open without consuming watchlist quota.
- [ ] Search shows unsupported tickers as unsupported instead of allowing save.
- [ ] Billing UI remains beta-disabled and does not expose dead purchase flows.

## 5. Manual QA Matrix

- [ ] First launch -> starter ticker selection -> company conversation opens.
- [ ] Search for a supported ticker and save it.
- [ ] Search for an unsupported ticker and confirm it cannot be saved.
- [ ] Open a saved ticker, send a normal filing question, and confirm grounded sources appear.
- [ ] Ask a `3年比較` style question and confirm the historical path behaves correctly.
- [ ] Hit chat quota and confirm the app shows the intended message.
- [ ] Hit watchlist quota and confirm the app shows the intended message.
- [ ] Try to open an unsaved non-starter ticker and confirm the app blocks it cleanly.
- [ ] Use manual refresh on a company screen.
- [ ] Visit Settings and read Privacy / Terms / Support.
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
- Beta billing flag: `ios/Kabuyomi/Services/BetaBilling.swift`
- DEBUG unlimited mode warning: `ios/Kabuyomi/App/AppModel.swift`
- Search support gating: `ios/Kabuyomi/Models/APIModels.swift`
- Company access gating: `workers/src/routes/company.ts` and `workers/src/lib/quota.ts`
- Watchlist add flow: `workers/src/routes/watchlist-add.ts`
- Beta limits and remote defaults: `workers/src/lib/remote-config.ts`
