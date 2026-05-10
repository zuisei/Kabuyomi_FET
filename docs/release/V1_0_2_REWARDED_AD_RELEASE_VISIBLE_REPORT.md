# Kabuyomi v1.0.2 Rewarded Ad Release-Visible Report

Date: 2026-05-10 JST

## 1. Conclusion

Rewarded ad credits are now intended to be release-visible for v1.0.2 when the required AdMob rewarded configuration is present.

The implementation remains server-authoritative:

- Rewarded ads are optional.
- A verified rewarded ad grants `+2` free/ad credits.
- The server enforces 3 successful rewards per JST day.
- The server enforces the +6 ad credits/day practical maximum through the 3 grants/day cap.
- Ad credits expire after 30 days through the rewarded-ad credit bucket.
- Paid credits remain separate.
- Client-only ad completion does not grant credits.
- Real Google AdMob SSV smoke is still required before main merge / App Store submission readiness.
- TestFlight StoreKit smoke is still required before main merge.

No production deploy, push, merge to `main`, v1.2 branch creation, SEC Form Router work, filing retrieval change, or answer-quality logic change was performed.

## 2. Branch / HEAD

- Branch: `v1.0.2-subscription-rewarded-credits`
- HEAD at start of this pass: `e35a9c1 Add v1.0.2 production Worker deploy report`
- `main` was not checked out or modified.

## 3. Required Audit Answers

1. Is the reward intent endpoint implemented?
   - Yes. `POST /v1/admob/reward-intents` creates a pending server intent, server-generated `customData`, `rewardCredits = 2`, and daily remaining count.

2. Does iOS request an intent before loading/presenting rewarded ad?
   - Yes. `AppModel.earnRewardedAdCredits()` calls `apiClient.createAdMobRewardIntent()` before `rewardedAdService.presentRewardedAd(customData:)`.

3. Does iOS pass server-generated customData / nonce to AdMob?
   - Yes. `GoogleRewardedAdService.loadRewardedAd(customData:)` sets `ServerSideVerificationOptions.customRewardText = customData`.

4. Does SSV verify signature/query/customData?
   - Yes. `/v1/admob/ssv` calls `verifyAdMobSsvCallback`; invalid signatures return `401`. The grant path requires `custom_data` / `customData` to match a pending intent, validates the configured ad unit, and validates `reward_amount` / `reward_item` when present.

5. Is grant idempotent by AdMob transaction ID?
   - Yes. `admob_reward_transactions.transaction_id` is checked before grant; duplicate callbacks return success/no-op and do not call the credit grant function again.

6. Is the daily cap enforced?
   - Yes. The server checks the cap before intent creation and again at SSV grant time. The 4th same-day grant is rejected and marked rejected.

7. Is there a reward status polling or usage refresh path?
   - Yes. iOS polls `/v1/admob/reward-status?id=...`; after `granted`, it stores server-returned usage.

8. Does client-only ad completion grant nothing?
   - Yes. iOS only polls status after ad completion and never mutates credits locally. Worker tests now cover that a client-created intent remains `pending` and grants nothing until verified SSV arrives.

9. Does invalid SSV grant nothing?
   - Yes. Invalid signature, missing/unknown custom data, invalid ad unit, invalid reward amount/item, and expired intents do not grant.

10. Does duplicate SSV grant nothing extra?
    - Yes. Duplicate transaction callbacks return `duplicate_ignored` with `creditsGranted = 0`.

11. Is the UI currently hidden by a release flag / remote config?
    - Previously yes: release visibility was disabled by a local review gate. This pass changed the v1.0.2 release default to visible when `AdMobConfig.hasRewardedCreditAdConfig` is true.

12. What exact change is needed to make it visible in v1.0.2?
    - `RewardedCreditReviewUI.rewardedAdsVisibleInV102Review = true`
    - Release visibility additionally requires `AdMobConfig.hasRewardedCreditAdConfig`.
    - No raw AdMob IDs or internal diagnostics are exposed in the release Credits UI.

## 4. Files Changed In This Pass

- `ios/Kabuyomi/Services/AdMobConfig.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/Services/RewardedAdService.swift`
- `ios/Kabuyomi/Features/Settings/SettingsView.swift`
- `ios/KabuyomiTests/AppModelTests.swift`
- `workers/test/admob-rewards.test.ts`
- `workers/src/routes/legal.ts`
- `README.md`
- `docs/INDEX.md`
- `docs/admob/release-admob-checklist.md`
- `docs/admob/rewarded_admob_credits_runbook.md`
- `docs/release/RELEASE_TRUTH.md`
- `docs/release/CURRENT_SHIPPING_TRUTH.md`
- `docs/release/APP_STORE_SUBMISSION_NOTES.md`
- `docs/release/TESTFLIGHT_READINESS_CHECKLIST.md`
- release reports updated to mark older UI-hidden conclusions as superseded
- `legal-site/public/privacy/index.html`
- `legal-site/public/terms/index.html`
- `legal-site/public/tokushoho/index.html`

## 5. Release Truth Decisions Reflected

- Rewarded ad credits are release-visible in v1.0.2 when AdMob rewarded config exists.
- Rewarded ad credits are App Review-visible.
- Rewarded ad credits are part of TestFlight smoke.
- Rewarded ads are optional.
- Rewarded ads grant free/ad credits, not paid credits.
- Credits grant only after server-side Google AdMob SSV.
- Daily cap is 3 successful rewards / +6 ad credits per JST day.
- Reward amount is +2 ad credits.
- Ad credits expire after 30 days through the rewarded-ad bucket.
- App Review notes explain that ad availability is not guaranteed.

## 6. UI Safety

Credits screen behavior:

- Shows the rewarded ad entry point when required AdMob rewarded config is present.
- States the ad is optional.
- States the reward is free/ad credit, not paid credit.
- Handles loading, presentation, dismissed-without-reward, pending verification, verified grant, daily cap, ad unavailable/load failure, and network/backend error states.
- Refreshes server usage after verified reward.
- Does not grant credit from iOS reward callback alone.

Release UI must not show raw AdMob unit IDs, callback URLs, Worker route paths, device keys, transaction IDs, or internal diagnostics. Developer diagnostics remain DEBUG-only.

## 7. Backend Safety Test Coverage

Covered by Worker tests:

- valid SSV grants +2 ad credits
- valid reward amount/item grants only the configured +2
- duplicate SSV does not double grant
- invalid signature grants nothing
- invalid custom data grants nothing
- unknown reward intent grants nothing
- expired reward intent grants nothing
- daily cap blocks 4th grant
- verify/test callback returns safely without unsafe grant
- client-created intent remains pending and grants nothing without SSV
- reward status reflects pending/granted/rejected
- usage reflects ad credits after verified grant

Covered by iOS tests:

- iOS passes server-generated custom data to the rewarded ad service.
- dismissed ad does not poll/grant.
- successful server status refreshes usage.
- daily cap disables the flow.
- DEBUG demo ad unit is blocked from production reward intent creation.

## 8. Automated Tests

Passed in this pass:

- `cd workers && npm run typecheck`
- `cd workers && npm test -- admob`: passed, 1 file / 21 tests.
- `cd workers && npm test`: passed, 48 files / 598 tests.
- `cd workers && npm run dryrun:test`: passed; Wrangler dry-run only, no deploy.
- `cd workers && npm run testbench:validate`: passed; 5 default tickers / 12 question templates.
- `cd legal-site && npm run validate`: passed.
- `git diff --check`: passed.
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`: passed, 140 tests.
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`: passed.

Not verified in this pass:

- Real Google AdMob SSV callback from TestFlight / production-like installed build.
- Real TestFlight StoreKit product load, purchase, subscription, restore, or Apple server verification.

## 9. Real-Device Smoke Checklist For Human

Automated/local validation is not a substitute for this checklist.

1. Install the v1.0.2 TestFlight candidate.
2. Confirm Credits / Account Status shows the rewarded ad option when AdMob config is present.
3. Confirm the UI says the ad is optional and grants free/ad credits.
4. Tap the rewarded ad option.
5. If no ad is served, confirm the app shows a non-granting unavailable/load-failure state.
6. If an ad is served, watch it to completion.
7. Return to the app and wait for verification / refresh.
8. Confirm the Worker receives a real Google AdMob SSV callback.
9. Confirm `/v1/admob/reward-status?id=<intent>` becomes `granted`.
10. Confirm `/v1/usage` and the app balance reflect exactly +2 ad credits.
11. Confirm paid credit balance remains separate.
12. Repeat until 3 successful rewards for the same JST day.
13. Confirm the 4th successful reward attempt is capped server-side.
14. Replay or observe a duplicate callback for the same transaction and confirm no extra grant.
15. Record sanitized evidence in `docs/admob/rewarded_admob_credits_runbook.md`.

## 10. Remaining Blockers Before Main Merge

P0:

- Real Google AdMob SSV smoke from TestFlight/production-like installed build is still required.
- TestFlight StoreKit smoke is still required:
  - `kabuyomi.credits.50` product load/purchase
  - `kabuyomi.credits.100` compatibility behavior if returned
  - Lite / Pro / Max product load
  - subscription purchase
  - restore
  - duplicate transaction/sync no-op
  - Apple server verification in the intended environment

P1:

- Superseded: the human decided Company UI polish stays in the v1.0.2 merge candidate.
- Static legal-site deployment / public URL smoke may be needed before App Review metadata is finalized.

## 11. Candidate Readiness

The branch can be prepared for human TestFlight candidate packaging after automated validation passes.

It is not main-merge-ready and not App-Store-submission-ready until real AdMob SSV smoke and real TestFlight StoreKit smoke are recorded.

## 12. No v1.2 Confirmation

Confirmed for this pass:

- No `v1.2-sec-form-router` branch was created.
- No SEC Form Router was implemented.
- No 20-F / 6-K / 8-K support was added.
- No filing retrieval logic was changed.
- No answer-quality logic was changed.
- No production deploy, push, or merge was performed.
