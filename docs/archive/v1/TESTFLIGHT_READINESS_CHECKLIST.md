# TestFlight Readiness Checklist

> **Historical release evidence — not current shipping authority.** This checklist records the former v1/TestFlight candidate and may contain catalog, capability, or release assumptions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

> Status: active v1 manual readiness checklist. `docs/archive/v1/RELEASE_TRUTH.md` remains the source of truth if any checklist item drifts.

This checklist is for shipping the current Kabuyomi build to TestFlight.

Treat the current code as the source of truth over older specs. The ship target is the current conversation-first iOS app, not the older tab-based UI.

## Current Ship Scope

- iOS app built from `ios/project.yml` via XcodeGen
- Conversation-first flow: entry -> company conversation -> drawers/settings
- Supported filings: `10-K` and `10-Q` only
- Starter preview tickers: `AAPL`, `MSFT`, `NVDA`, `AMZN`, `TSLA`
- Billing is credit-based for v1.0.2.
- Candidate paid consumables (visibility requires explicit billing capabilities):
  - `kabuyomi.credits.50`: 50 paid credits.
  - `kabuyomi.credits.100`: 100 paid credits; existing compatibility product.
- Candidate subscriptions use subscription group `Kabuyomi_sus`:
  - `kabuyomi.sub.lite.monthly`: 400 credits per Apple-verified period.
  - `kabuyomi.sub.pro.monthly`: 900 credits per Apple-verified period.
  - `kabuyomi.sub.max.monthly`: 2,000 credits per Apple-verified period.
- StoreKit localized product data is the only review-facing price authority.
- Free recurring monthly credits are 0. A verified installation may receive 50 welcome credits once.
- Paid credits do not expire.
- No obsolete 280-credit pack should be visible.
- Rewarded-credit visibility is capability-controlled. Reviewer notes must match the exact uploaded build's observed capability response; if visible, production/TestFlight Google AdMob SSV grant evidence is required before submission.
- Filing answers stay grounded in SEC filing material. External web search is not part of v1.
- Chat metadata should follow `responsePath`; remote model naming should appear only for real remote execution.
- Historical chat is narrow on purpose: explicit `3年` / `比較` / `推移` style prompts only
- Background history seed is the top 30 U.S.-listed issuers by market cap, using issuer-level normalization for class-share families and targeting 3 years of annual `10-K` coverage

## Not In Scope For This TestFlight

- `20-F`, `6-K`, `8-K`, or broader filing coverage
- obsolete 280-credit pack
- web search
- rewarded-credit grants from client-only ad completion without server-side Google SSV
- full cross-company comparison product
- broad notification system

## Exit Criteria

- A Release archive builds successfully.
- Workers and `sec-fetcher` are deployed with the expected secrets and storage bindings.
- The app copy consistently states v1.0.2 credit/subscription billing, `kabuyomi.credits.50`, `kabuyomi.credits.100` compatibility support, unsupported cases, and no investment advice.
- Manual QA covers the main happy paths plus saved/remove/reset/limit/error paths.
- TestFlight metadata and tester notes explain that this is a filing reader, not investment advice.

## 1. Freeze The Beta Scope

- [ ] Do not add product surface area beyond the v1.0.2 monetization scope.
- [ ] Keep the filing scope explicit everywhere: `10-K / 10-Q` only.
- [ ] Keep credit purchase copy aligned with `kabuyomi.credits.50`, 50 paid credits, and StoreKit `displayPrice`.
- [ ] Confirm `kabuyomi.credits.100` remains supported/visible as compatibility when billing capabilities allow purchases and StoreKit returns it.
- [ ] Keep subscription copy aligned with Lite / Pro / Max product IDs, StoreKit-localized prices, period credit amounts, daily fair-use limits, saved-company limits, and App Store auto-renewal behavior.
- [ ] Record the exact Release/TestFlight capability response. If rewarded credit is visible, verify +2 ad credits, 3 successful rewards/day, +6 ad credits/day, 30-day expiry, and server-side SSV. If hidden, do not claim it in reviewer notes.
- [ ] Confirm no obsolete 280-credit pack copy appears in the review-facing build.
- [ ] Decide whether the initial drop is `internal testers only` or `small external beta`.
- [ ] Use the current conversation-first UI as the ship target. Do not block on reviving the older home/search/tab concept.

## 2. Backend Readiness

- [ ] Confirm Worker bindings exist in the target environment: `KV`, `D1`, `R2`, Durable Objects.
- [ ] Confirm `SEC_FETCHER_SHARED_SECRET` matches between Workers and `sec-fetcher`.
- [ ] Confirm the deployed Worker model-provider config is intentional for the v1 environment.
- [ ] Confirm `maintenanceMode = false` and `chatEnabled = true`.
- [ ] Confirm web search / web supplement behavior is not exposed as a v1 feature.
- [ ] Confirm the Worker free-credit defaults and visible iOS credit copy match the current release truth.
- [ ] Confirm `dailyRefreshEnabled` and any background tracked ticker list are intentional for beta load, and are not being described as the user saved ticker source of truth.
- [ ] Confirm the tracked history seed still matches the intended top-30 U.S. issuer roster and remains issuer-normalized across class shares.
- [ ] Confirm `/v1/watchlist/add` and `/v1/watchlist/remove` return updated usage with the current saved ticker semantics.
- [ ] Confirm paid-credit grants use Worker-side Apple App Store Server verification and do not trust client payloads as authority.
- [ ] Confirm deployed remote config is a fresh trusted full payload with every required typed capability field; missing/malformed deployed fields must fail closed.
- [ ] Confirm `maxStaleAgeSeconds=3888000`, daily lifecycle inspection/alerts are configured, and the latest human-reviewed refresh is less than 14 days old per `REMOTE_CONFIG_LIFECYCLE_RUNBOOK.md`.
- [ ] Keep `accountRecoveryReady=false` until Sign in with Apple capability/provisioning, two-device recovery, and in-app account deletion (or a documented App Review determination that no account is created) are verified.
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

Do not install a product built with `CODE_SIGNING_ALLOWED=NO` into Simulator for UI or Keychain validation. That flag is valid only for compile-only CI gates; an installed unsigned product has no usable Keychain entitlement and will intentionally enter the degraded authentication state. Build the Simulator app with normal local signing before `simctl install` or visual review.

## 4. Release-Safety Checks In The iOS App

- [ ] Settings copy for Privacy Policy / Terms / Support is present and readable.
- [ ] Settings usage copy clearly separates persistent saved ticker count from today's chat count.
- [ ] AI consent flow appears before first chat send.
- [ ] Unsupported filing copy is consistent with the actual backend behavior.
- [ ] Error copy for daily chat limit, saved ticker limit, unsupported filing, and unsaved ticker access is clear.
- [ ] Response metadata shows a remote model badge only when the response actually used a remote model path.
- [ ] Reset confirmation clearly states that saved data and chat history will be deleted while the Keychain installation credential and server credit/purchase records remain.
- [ ] Reset local data returns the app to the entry/start state and does not leave stale UI state behind.
- [ ] Usage is re-fetched after reset for the same installation identity and no new welcome balance is created.

Explicitly recheck these current product rules:

- [ ] A supported search result can open without being saved; saving is a separate action and only that action consumes saved-company quota.
- [ ] Starter tickers open without consuming saved ticker quota.
- [ ] Search shows unsupported tickers as unsupported instead of allowing save.
- [ ] Filing-grounded beta mode stays on by default, and no external supplement copy leaks into the main happy path unless intentionally enabled.
- [ ] Credit UI shows `kabuyomi.credits.50` primary, keeps `kabuyomi.credits.100` compatibility support, and purchase / restore actions work end-to-end.
- [ ] Credit UI shows Lite / Pro / Max subscription products only when StoreKit returns them and disabled/retry states otherwise.
- [ ] Billing, subscriptions, consumables, account recovery, and rewarded-credit actions match the explicit capability response and fail closed when it is unavailable.
- [ ] App Review-facing copy describes rewarded ads/ad credits only if that action is visible in the exact uploaded build.
- [ ] A visible rewarded-credit action remains blocked from submission until the AdMob SSV runbook contains real grant evidence.
- [ ] Privacy, Terms, Support, 特商法, and Apple's standard EULA are reachable in-app and match the validated static legal source.

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
- [ ] Open a supported unsaved non-starter ticker and confirm it opens without changing saved-company count; then save it and confirm the count changes once.
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
- [ ] Validate and deploy the static Privacy / Terms / Support / 特商法 pages; record the deployed content revision. The 2026-07-11 read-only check found all four live pages still on the May revision and hash-different from local source.
- [ ] Generate the archive privacy report and reconcile App Store Connect answers for Kabuyomi and all bundled SDKs, including identifiers, purchase history, product interaction, search history, other user content, advertising data, coarse location, and diagnostics where reported.
- [ ] Reconcile AdMob consent/configuration with the questionnaire's tracking answers; do not infer third-party answers from Kabuyomi's own `PrivacyInfo.xcprivacy` alone.
- [ ] If external testers are included, be ready for Beta App Review and keep the scope narrow.

Suggested tester note baseline:

- This is a limited beta for reading SEC `10-K / 10-Q` filings in Japanese.
- `20-F / 6-K` companies are not yet supported.
- Saved tickers are capped separately from the daily chat quota.
- Candidate paid products are `kabuyomi.credits.50`, compatibility product `kabuyomi.credits.100`, and Lite / Pro / Max subscriptions. State only the products actually returned and enabled in the uploaded build; prices come from StoreKit.
- State the observed rewarded-credit visibility for the uploaded build. If visible, explain that it is optional and only server-verified Google AdMob SSV grants credit; if hidden, do not advertise it.
- The app is not investment advice and may contain summary or chat errors.
- Use TestFlight feedback with the ticker, redacted minimal repro, screenshot, and time. Do not send identity tokens, installation credentials, full receipts/purchase IDs, App Attest artifacts, or confidential question text.

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
- StoreKit purchase flow: `ios/Kabuyomi/Services/SubscriptionStore.swift`
- Search support gating: `ios/Kabuyomi/Models/APIModels.swift`
- Company access gating: `workers/src/routes/company.ts` and `workers/src/lib/quota.ts`
- Saved ticker quota semantics: `workers/src/durable/user-quota.ts`
- Watchlist add/remove flows: `workers/src/routes/watchlist-add.ts` and `workers/src/routes/watchlist-remove.ts`
- Chat response metadata: `workers/src/routes/chat.ts` and `ios/Kabuyomi/Persistence/PersistenceController.swift`
- Reset behavior: `ios/Kabuyomi/App/AppModel.swift`
- Beta limits and remote defaults: `workers/src/lib/remote-config.ts`
