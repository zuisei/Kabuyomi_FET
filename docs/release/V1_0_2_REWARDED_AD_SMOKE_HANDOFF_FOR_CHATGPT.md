# Kabuyomi v1.0.2 Rewarded Ad Smoke Handoff For ChatGPT

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Generated: 2026-05-10 JST

## Executive Summary

This is a handoff for the next real TestFlight/device rewarded-ad smoke. No production deploy, push, merge, filing retrieval change, answer-quality change, model-config change, SEC Form Router work, or code implementation was performed in this pass.

Current recommendation: **READY_FOR_HUMAN_SMOKE**, with external prerequisites still **UNKNOWN** until the human tester confirms TestFlight build availability and AdMob Console SSV configuration.

The implementation is designed so iOS can show the rewarded-ad entry point, create a server reward intent, pass server-generated `customData` into Google Mobile Ads SSV options before presentation, then poll the backend until the server reports `granted`. iOS does not locally mutate credit balances. The Worker verifies Google AdMob SSV signatures, requires a known pending intent/custom data, validates the ad unit and reward payload when grant fields are present, enforces idempotency by transaction ID, enforces the 3/day JST cap at intent creation and again at grant time, and records the grant as free/ad promotional credit separate from paid credits.

Real Google SSV evidence is still not recorded in the repository. The human smoke must prove:

- TestFlight app shows the rewarded-ad UI.
- A real AdMob SSV callback reaches the Worker.
- `/v1/admob/reward-status?id=<intent>` becomes `granted`.
- `/v1/usage` and UI increase by exactly `+2` ad/free credits.
- Paid credits remain unchanged.
- Three successful rewards are allowed per JST day, and the fourth is blocked server-side.
- Duplicate SSV does not double grant if observable.

## Branch / HEAD / Dirty State

Initial required commands were run after switching off `main` to the expected branch:

- `git branch --show-current`: `v1.0.2-subscription-rewarded-credits`
- `git status --short`: clean before this report was created
- `git log --oneline -5`:
  - `e5510a6 Prepare v1.0.2 release candidate`
  - `e35a9c1 Add v1.0.2 production Worker deploy report`
  - `04336e7 Add v1.0.2 StoreKit and Worker route smoke reports`
  - `066c052 Add subscription credits UI and billing diagnostics`
  - `96a62a2 Add subscription backend credit grants`
- `git diff --stat`: empty before this report
- `git diff --name-only`: empty before this report
- `git diff --check`: passed
- `git branch --list 'v1.2*'`: no output; no local `v1.2*` branch was being used

Important scope confirmations:

- Current branch is not `main`.
- No `v1.2*` branch is being used.
- Company UI polish remains included. Evidence: `docs/release/V1_0_2_COMPANY_UI_POLISH_RESTORED_REPORT.md` says Company UI polish is restored into the v1.0.2 release candidate, and `docs/release/V1_0_2_TESTFLIGHT_SMOKE_EVIDENCE_PACKET.md` says Company UI polish is included.
- The current working tree had no uncommitted Worker changes before this report. `HEAD` includes `workers/src/routes/admob-rewards.ts`, `workers/src/routes/legal.ts`, and `workers/test/admob-rewards.test.ts`; no filing retrieval, answer-quality, or SEC Form Router files were dirty.

## Rewarded Ad UI Entry Point

Where UI is shown:

- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `CreditView.body`: renders `rewardCard` when `shouldShowRewardedCreditUI` is true.
- `CreditView.rewardCard`: shows the card titled `広告報酬（任意）`, explanatory optional-ad copy, and `RewardedAdCreditButton`.
- `CreditView.purchaseManagementCard`: provides `利用状況`, which opens Account Status. The rewarded-ad card itself is on the Credits screen, not inside Account Status.

Visibility gate:

- `CreditView.shouldShowRewardedCreditUI`
- `RewardedCreditReviewUI.isVisible`
- DEBUG: always true.
- Release/TestFlight: `RewardedCreditReviewUI.rewardedAdsVisibleInV102Review && AdMobConfig.hasRewardedCreditAdConfig`.
- `AdMobConfig.hasRewardedCreditAdConfig`: true when `rewardedCreditAdUnitID` is non-empty.

Config requirements:

- `ios/Kabuyomi/Services/AdMobConfig.swift`
- `AdMobConfig.rewardedCreditAdUnitID`
- Release/TestFlight uses `RewardedAdRuntimeMode.releaseProduction.adUnitID`.
- DEBUG default uses the Google demo/test unit unless SSV smoke mode and Google test-device identifiers are configured.
- Do not paste raw AdMob unit IDs into smoke evidence. The source file contains the exact production and Google test values if the developer needs to inspect them locally.

Release/TestFlight real-vs-test unit:

- Release/TestFlight uses the production rewarded unit through `RewardedAdRuntimeMode.releaseProduction`.
- DEBUG uses the Google test unit by default.
- DEBUG can use the production unit only in the explicit SSV smoke path when smoke mode is enabled and a Google test-device ID is configured.

## iOS Reward Flow

Reward intent creation:

- `ios/Kabuyomi/App/AppModel.swift`
- `AppModel.earnRewardedAdCredits()`
- It sets state to `.loading`, then calls `apiClient.createAdMobRewardIntent()` before loading/presenting the ad.

Intent endpoint:

- `ios/Kabuyomi/Services/APIClient.swift`
- `APIClient.createAdMobRewardIntent()`
- `POST /v1/admob/reward-intents` with an empty JSON body and standard request headers, including `x-device-key`.

Intent response fields:

- `ios/Kabuyomi/Models/APIModels.swift`
- `AdMobRewardIntentResponse`
- Fields: `rewardIntentId`, `customData`, `rewardCredits`, `dailyRemaining`.

Passing custom data into Google Mobile Ads:

- `ios/Kabuyomi/Services/RewardedAdService.swift`
- `GoogleRewardedAdService.presentRewardedAd(customData:)` calls `loadRewardedAd(customData:)`.
- `GoogleRewardedAdService.loadRewardedAd(customData:)` creates `ServerSideVerificationOptions`, sets `options.customRewardText = customData`, assigns it to `ad.serverSideVerificationOptions`, then stores the loaded ad.
- `customData` is set before `ad.present(from:)` is called.

Dismissed without reward:

- `GoogleRewardedAdService.adDidDismissFullScreenContent(_:)` returns `didEarnReward`.
- `AppModel.earnRewardedAdCredits()` checks `guard didEarnReward else`, sets state back to `.idle`, and shows `RewardedAdServiceError.dismissedWithoutReward.localizedDescription`.
- Exact UI message: `広告の視聴が完了していないため、無料/ad creditは付与されませんでした。`
- iOS does not poll reward status in this case.

Callback says user earned reward:

- `GoogleRewardedAdService.presentRewardedAd(customData:)` sets `didEarnReward = true` inside the Google reward callback.
- `AppModel.earnRewardedAdCredits()` then sets `.pendingGrant` and polls reward status.

Local credit mutation:

- iOS does not mutate credits locally.
- After status becomes `granted`, `AppModel.earnRewardedAdCredits()` calls `storeUsage(status.usage, source: .refresh)` using the server-returned usage payload.

Reward status polling:

- `AppModel.pollRewardStatus(rewardIntentId:)`
- Up to 6 attempts, 1 second apart after the first attempt.
- Calls `apiClient.fetchAdMobRewardStatus(rewardIntentId:)`.

Reward status endpoint:

- `APIClient.fetchAdMobRewardStatus(rewardIntentId:)`
- `GET /v1/admob/reward-status?id=<rewardIntentId>`.

Observed/represented statuses:

- Worker intent row statuses: `pending`, `granted`, `expired`, `rejected`.
- SSV response statuses can include `granted`, `duplicate_ignored`, `already_granted`, `verified_no_grant`.
- Daily cap at intent creation returns HTTP 429 with `error: daily_cap_reached`.
- iOS does not currently model separate `failed` or `capped` backend status strings from reward-status; it maps the daily cap error or zero remaining to `.dailyCapReached`.

Post-grant refresh:

- `AppModel.earnRewardedAdCredits()`
- After `pollRewardStatus` returns `granted`, it stores `status.usage`.

Exact user-facing messages:

- Verified +2 credits: `2無料/ad creditを獲得しました。`
- Pending verification / SSV not yet received: `広告視聴は完了しましたが、サーバー確認がまだ完了していません。少し時間をおいて残高を更新してください。`
- Daily cap: `本日の広告報酬上限に達しました。`
- Ad unavailable/no-fill: `現在広告を利用できません。少し時間をおいて再試行してください。`
- Generic ad display failure: `広告を表示できませんでした。少し時間をおいて再試行してください。`
- Generic backend/network grant failure: `広告報酬を付与できませんでした。通信状況を確認して再試行してください。`

## Backend SSV Flow

SSV endpoint:

- `workers/src/routes/admob-rewards.ts`
- `handleAdMobRewardRoutes`
- `GET /v1/admob/ssv`

Signature verification:

- `handleAdMobRewardRoutes` calls `safeVerifySsv`.
- `safeVerifySsv` calls `verifyAdMobSsvCallback(url, env)`.
- `workers/src/lib/admob-ssv.ts`
- `verifyAdMobSsvCallback` reconstructs the signed query content up to `&signature=`, reads `signature` and `key_id`, fetches Google AdMob public keys from `ADMOB_SSV_PUBLIC_KEYS_URL` or the default Google verifier key URL, imports the P-256 key, normalizes DER signatures when needed, and verifies ECDSA SHA-256 via WebCrypto.
- Invalid signature returns `{ error: "invalid_signature" }` with HTTP 401 before grant processing.

Known intent/customData requirement:

- `processSsvGrant`
- Requires `custom_data` or `customData`.
- Calls `loadRewardIntentByCustomData`.
- Unknown custom data throws `Invalid rewarded ad custom data`.

Ad unit validation:

- `processSsvGrant`
- Reads `env.ADMOB_REWARDED_AD_UNIT_ID`.
- `isAllowedRewardedAdUnit` accepts only the configured unit, its numeric suffix, or the exact configured ID without `ca-app-pub-` prefix.
- Invalid values throw `Invalid rewarded ad unit`.
- AdMob Console dummy verification callback is allowed as `verified_no_grant` and does not grant credits.

Reward amount/item validation:

- `validateRewardPayload`
- If `reward_amount` is present, it must be `2`.
- If `reward_item` is present, it must be `credits`.

Intent expiry:

- `INTENT_TTL_MS = 30 * 60 * 1000`.
- `effectiveIntentStatus` returns `expired` when a pending intent is past `expires_at`.
- SSV for expired intents is rejected as not grantable.

Idempotency:

- `admob_reward_transactions.transaction_id` is the primary key in `workers/d1/migrations/0008_admob_rewarded_credits.sql`.
- `processSsvGrant` calls `loadRewardTransaction(transactionId)` before grant.
- If an existing granted transaction exists, it returns `duplicate_ignored` with `creditsGranted: 0`.
- `recordRewardTransaction` uses `INSERT OR IGNORE` and updates the intent to `granted` only when it is still `pending`.

Daily cap:

- Constants in `admob-rewards.ts`: `REWARD_CREDITS = 2`, `DAILY_REWARD_CAP = 3`.
- `POST /v1/admob/reward-intents` checks `countGrantedRewards` before creating an intent; if the user already has 3 grants that JST day, it returns HTTP 429 with `daily_cap_reached`.
- `processSsvGrant` checks `countGrantedRewards` again immediately before grant; if the cap is reached, it marks the intent `rejected` and throws HTTP 429.

## Credit Ledger Behavior

Grant call:

- `workers/src/routes/admob-rewards.ts`
- `processSsvGrant` calls `grantRewardedAdCredits(identity, env, config, { rewardIntentId, transactionId, credits: 2, expiresAt })`.

Ledger mutation:

- `workers/src/lib/quota.ts`
- `grantRewardedAdCredits`
- `mutateRewardedAdCreditGrant`
- Sends Durable Object action `grantRewardedAdCredit` with `credits`, `promoExpiresAt`, `referenceType: "admob_rewarded"`, `referenceId: rewardIntentId`, and `transactionId`.

30-day expiry:

- `PROMO_CREDIT_TTL_MS = 30 * 24 * 60 * 60 * 1000` in `admob-rewards.ts`.
- The SSV grant path computes `expiresAt` as now plus 30 days and passes it as `promoExpiresAt`.
- `persistCreditLedgerEntry` stores `rewardedAdExpiresAt` in ledger metadata when the Durable Object returns it.

Usage representation:

- `ios/Kabuyomi/Models/APIModels.swift`
- `CreditUsagePayload` has `monthlyRemaining`, `monthlyLimit`, `rewardedAdRemaining`, `rewardedAdExpiresAt`, `purchasedRemaining`, `totalRemaining`, and `resetsAt`.
- `/v1/admob/reward-status` returns `usage`, so the app can refresh all balances from the server after grant.
- Paid balance remains separate as `purchasedRemaining`; rewarded ads should increase `rewardedAdRemaining`/`totalRemaining`, not `purchasedRemaining`.

## Daily Cap Behavior

Expected real smoke:

- Successful reward 1: +2 ad/free credits, daily remaining decrements.
- Successful reward 2: +2 more ad/free credits.
- Successful reward 3: +2 more ad/free credits, daily remaining should become 0.
- Fourth same-JST-day grant attempt: blocked server-side with no credit mutation.

Implementation evidence:

- Intent creation cap: `handleAdMobRewardRoutes`, `POST /v1/admob/reward-intents`.
- Grant-time cap: `processSsvGrant`.
- Count query: `countGrantedRewards`.
- Rejected fourth intent status: `markRewardIntentRejected`.

## Idempotency Behavior

Expected real smoke:

- If Google or an operator replay produces the same `transaction_id`, the Worker must return success/no-op and grant 0 additional credits.
- Do not expose full transaction IDs in evidence; suffix only.

Implementation evidence:

- Transaction table primary key: `workers/d1/migrations/0008_admob_rewarded_credits.sql`, `admob_reward_transactions.transaction_id`.
- Duplicate check: `processSsvGrant` + `loadRewardTransaction`.
- Duplicate response: `duplicate_ignored`, `creditsGranted: 0`.

## Existing Automated Tests

iOS tests:

- `AppModelTests.testRewardedAdCreditSuccessRefreshesBalance`: proves iOS passes server `customData`, polls reward status, stores server usage, and shows `2無料/ad creditを獲得しました。`
- `AppModelTests.testRewardedAdDismissedWithoutRewardDoesNotPollOrGrant`: proves dismissed-without-reward does not poll or grant.
- `AppModelTests.testRewardedAdPresentFailureMapsAlreadyPresenting`: covers presentation failure messaging.
- `AppModelTests.testRewardedAdPendingSSVFailureUsesPreciseDebugReason`: covers pending/SSV-not-received diagnostic/message behavior.
- `AppModelTests.testRewardedAdProductionAPIWithDemoAdUnitBlocksBeforeRewardIntent`: DEBUG demo ad unit cannot create production reward intent.
- `AppModelTests.testRewardedAdSSVSmokeModeRequiresGoogleTestDeviceMode`: smoke mode without test-device identifiers stays blocked to demo unit.
- `AppModelTests.testRewardedAdSSVSmokeModeUsesProductionAdUnitWithTestDeviceMode`: DEBUG smoke with test-device identifiers uses production unit path.
- `AppModelTests.testRewardedAdProductionSSVSmokeModeAllowsRewardIntentWithTestDeviceMode`: production SSV smoke mode can create intent and pass customData.
- `AppModelTests.testRewardedAdDailyCapDisablesGrantFlow`: daily cap response disables flow and shows cap message.
- `AppModelTests.testRewardedAdCreditBillingDisabledReturnsBeforeRewardIntentRequest`: credit billing disabled returns before intent request.

Worker tests:

- `workers/test/admob-rewards.test.ts`
- `creates a reward intent with a server-defined +2 credit grant and daily cap snapshot`
- `keeps a client-created reward intent pending until a verified SSV callback arrives`: proves client-only completion grants nothing.
- `valid SSV grants exactly +2 promotional credits and records the transaction`
- `valid SSV with reward amount and item grants only the configured +2 credits`
- `rejects signed SSV callbacks with mismatched reward_amount`
- `rejects signed SSV callbacks with mismatched reward_item`
- `rejects invalid SSV signatures before reading callback grant fields`
- `rejects non-allowlisted ad_unit values even when SSV signature is valid`
- `rejects signed SSV callbacks without custom_data`
- `rejects signed SSV callbacks with unknown custom_data`
- `rejects signed SSV callbacks for expired reward intents`
- `duplicate SSV callbacks are success no-ops and do not grant twice`
- `enforces the daily cap server-side before granting an SSV callback`: proves fourth daily reward is blocked.
- `allows the third same-day reward and then reports zero remaining`

Validation run in this pass:

- `git diff --check`: passed.
- `cd workers && npm test -- admob`: passed, 1 file, 21 tests.

## Real-Device Smoke Steps

Use the installed TestFlight candidate, not a DEBUG simulator build.

1. Record TestFlight app version/build, device model, iOS version, JST timestamp, and whether the app is using the production Worker.
2. Open Kabuyomi from TestFlight.
3. Open Settings/Credits.
4. Open Account Status and capture a screenshot showing safe environment/usage information. Do not expose raw device key or secrets.
5. Confirm the rewarded-ad UI card is visible on the Credits screen.
6. Capture Credits screen screenshot before reward.
7. Record `/v1/usage` before reward, sanitized:
   - total remaining
   - ad/free rewarded balance
   - paid/purchased balance
   - no raw device key
8. Tap the rewarded-ad entry.
9. Confirm reward intent creation in iOS logs or Worker logs if visible:
   - event like `create_reward_intent_succeeded` or `rewarded_ad_intent_created`
   - reward intent suffix only
   - `rewardCredits=2`
10. Watch the rewarded ad if served.
11. Return to app.
12. Watch iOS logs for `rewarded_ad_user_did_earn_reward`, then `reward_status_polling_started`.
13. Watch Worker logs for real AdMob SSV callback:
   - `rewarded_ad_ssv_received`
   - then `rewarded_ad_credit_granted`
14. Poll/check `/v1/admob/reward-status?id=<intent>` until it becomes `granted`.
15. Confirm `/v1/usage` after reward.
16. Confirm ad/free rewarded balance and total balance increased by exactly `+2`.
17. Confirm paid/purchased balance did not increase.
18. Capture Credits screen screenshot after reward.
19. Repeat successful reward flow until 3 total successful rewards for the same JST day.
20. Confirm the third grant succeeds and daily remaining reaches 0.
21. Attempt a fourth same-day reward path.
22. Confirm server-side cap blocks the fourth grant and no credits are added.
23. If duplicate SSV/replay is observable, record sanitized duplicate behavior: same transaction suffix returns no additional grant.
24. Fill `docs/release/V1_0_2_TESTFLIGHT_SMOKE_EVIDENCE_PACKET.md` and/or `docs/admob/rewarded_admob_credits_runbook.md` evidence rows with sanitized summaries.

## Logs / Evidence To Capture

iOS device console / Xcode logs:

- Filter for subsystem/category or text containing `rewarded_ad`.
- Useful events:
  - `settings_view_appeared`
  - `rewarded_button_tapped`
  - `earn_rewarded_ad_credits_entered`
  - `create_reward_intent_started`
  - `create_reward_intent_succeeded`
  - `present_rewarded_ad_entered`
  - `rewarded_ad_load_started`
  - `rewarded_ad_load_succeeded`
  - `rewarded_ad_present_started`
  - `rewarded_ad_user_did_earn_reward`
  - `rewarded_ad_dismissed`
  - `reward_status_polling_started`
  - `reward_status_poll_result`
  - `reward_status_granted`
  - `rewarded_flow_failed`

Worker logs:

- Use the project’s normal Cloudflare log viewing flow, for example `wrangler tail` in the Worker project if the human has Cloudflare access.
- Useful events:
  - `rewarded_ad_intent_created`
  - `rewarded_ad_ssv_received`
  - `rewarded_ad_credit_granted`
  - `rewarded_ad_duplicate_ignored`
  - `rewarded_ad_ssv_daily_cap_reached`
  - `rewarded_ad_ssv_invalid_signature`
  - `rewarded_ad_ssv_invalid_ad_unit`
  - `rewarded_ad_ssv_unknown_custom_data`
  - `rewarded_ad_ssv_intent_not_grantable`

Safe endpoint observations:

- `/v1/admob/reward-status?id=<intent>`:
  - record status only, reward credits, daily remaining, total remaining, rewarded/ad remaining, paid remaining
  - reward intent suffix only
- `/v1/usage`:
  - record credit totals before/after
  - paid/purchased balance before/after
  - rewarded/ad balance before/after
- AdMob SSV callback summary:
  - callback reached Worker
  - signature verified
  - transaction suffix only
  - grant result `+2` or no-op
  - no full callback URL
- Screenshots:
  - Account Status screenshot
  - Credits screen before
  - Credits screen after +2
  - daily-cap state if reached

## Sensitive-Data Redaction Rules

Do not paste:

- raw device key
- full reward intent ID
- full transaction ID
- full callback URL
- raw AdMob unit ID
- SSV signature
- raw Apple payload
- secret values
- full App Store transaction payloads

Allowed:

- transaction ID suffix only
- reward intent ID suffix only if needed
- route name without full signed query
- sanitized status summaries
- screenshot file paths
- aggregate credit balances
- build number, device model, iOS version

## Current Blockers / Unknowns

| Item | Classification | Current status |
| --- | --- | --- |
| Required AdMob rewarded config present in iOS code | READY_FOR_HUMAN_SMOKE | `AdMobConfig.swift` contains release production rewarded config and non-empty gate. Raw unit ID intentionally omitted here. |
| Worker route deployed to production | READY_FOR_HUMAN_SMOKE | Docs record production deploy/version and route checks. This pass also safely probed `POST /v1/admob/reward-intents` without a device key and received `Device key is required`, not 404, proving the route is live. |
| Production D1 migration for reward tables | READY_FOR_HUMAN_SMOKE by docs; UNKNOWN live | `docs/admob/rewarded_admob_credits_runbook.md` records `0008_admob_rewarded_credits.sql` applied to production. This pass did not inspect Cloudflare D1 directly. |
| AdMob Console SSV callback URL configured | UNKNOWN / NEEDS_ADMOB_CONSOLE_ACTION | Repo docs specify expected callback route, but this pass cannot verify the AdMob Console. Human must confirm in AdMob. |
| App uses production Worker in TestFlight candidate | READY_FOR_HUMAN_SMOKE by code; UNKNOWN on installed build | Release `APIBaseURLResolver.resolve` returns production Worker. Human must confirm Account Status in the installed TestFlight build. |
| TestFlight build available | UNKNOWN / NEEDS_TESTFLIGHT_BUILD | Cannot verify from repo/local commands. Human must provide build number and install evidence. |
| Docs say where to capture Worker logs | READY_FOR_HUMAN_SMOKE | `docs/admob/release-admob-checklist.md`, `docs/admob/rewarded_admob_credits_runbook.md`, and evidence packet mention Worker logs and SSV evidence. |
| Evidence packet has rows to fill | READY_FOR_HUMAN_SMOKE | `docs/release/V1_0_2_TESTFLIGHT_SMOKE_EVIDENCE_PACKET.md` has AdMob rows and an evidence table. |
| Docs/implementation mismatch | READY_FOR_HUMAN_SMOKE with minor note | Docs mention real SSV evidence not recorded, matching implementation status. Some historical docs are superseded about Company UI splitting; current restored report/evidence packet say Company UI polish is included. |
| Filing retrieval / answer-quality / SEC Form Router touched | READY_FOR_HUMAN_SMOKE | No dirty changes. Current branch scope/docs state no v1.2/SEC Form Router/filing retrieval/answer-quality work. |
| Real Google SSV grant evidence | UNKNOWN / NEEDS_ADMOB_CONSOLE_ACTION / NEEDS_TESTFLIGHT_BUILD | Not recorded in repo. This is the main human smoke target. |

## Exact Questions For The Human

1. What TestFlight version/build number is installed on the device?
2. Does Account Status in that installed build show the production Worker environment?
3. Is the AdMob production rewarded unit’s SSV callback configured to the production Worker `/v1/admob/ssv` route?
4. Did the rewarded-ad card appear in Credits on the TestFlight build?
5. Did Google serve an ad, or did the app show the ad-unavailable message?
6. After a completed ad, did Worker logs show a real signed SSV callback?
7. What was the reward intent suffix and transaction suffix for the successful grant?
8. Did `/v1/admob/reward-status?id=<intent>` become `granted`?
9. What were `/v1/usage` credit totals before and after?
10. Did rewarded/ad credits increase by exactly `+2`?
11. Did paid/purchased credits remain unchanged?
12. Were three successful rewards possible in the same JST day?
13. Was the fourth same-day reward blocked server-side with no extra credits?
14. Was duplicate SSV behavior observed, and if so did it no-op?
15. Where are the sanitized screenshots/log summaries stored?

## Final Recommendation

**READY_FOR_HUMAN_SMOKE**

Reasons:

- Correct branch is active and not `main`.
- No `v1.2*` branch is being used.
- Local working tree was clean before this report.
- Rewarded-ad UI, intent creation, customData handoff, status polling, and server-authoritative usage refresh are implemented.
- Worker SSV signature validation, known-intent/customData requirement, ad unit validation, reward amount/item validation, intent expiry, idempotency, daily cap, and ledger grant path are implemented.
- Automated Worker AdMob tests passed: 21/21.
- `git diff --check` passed.
- Production reward-intent route is live enough to return `Device key is required` instead of 404 on a safe unauthenticated probe.

Remaining external unknowns that the human must resolve during smoke:

- TestFlight build availability and exact build identity.
- Installed build actually using production Worker.
- AdMob Console SSV callback configuration.
- Real Google SSV callback success.
- Exact +2 ad/free credit grant and paid balance unchanged.
- 3/day cap and fourth-grant server block on a real device/account.
