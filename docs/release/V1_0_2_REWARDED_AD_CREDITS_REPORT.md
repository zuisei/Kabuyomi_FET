# Kabuyomi v1.0.2-C Rewarded Ad SSV Credits Report

Superseded note: later on 2026-05-10 JST, the product decision changed. Rewarded-credit UI is now release-visible for v1.0.2 when required AdMob rewarded config is present. Older UI-hidden statements below are pre-decision history; use `docs/release/RELEASE_TRUTH.md` and `docs/release/V1_0_2_REWARDED_AD_RELEASE_VISIBLE_REPORT.md` for current truth.

## 1. Conclusion

Rewarded AdMob credit support is implemented and verified on the Worker side, with one narrow hardening change added in this pass.

The system now explicitly validates AdMob SSV `reward_amount` and `reward_item` when those fields are present. Invalid or forged callback values do not grant credits.

The iOS rewarded-credit UI already exists. This report originally observed the old hidden Release/TestFlight gate:

```swift
RewardedCreditReviewUI.rewardedAdsVisibleInV1Review = false
```

That old conclusion is superseded. Current v1.0.2 truth is release-visible optional rewarded ads with server-side SSV before grant.

## 2. Backend Endpoints Implemented / Verified

Verified in source:

- `POST /v1/admob/reward-intents`
- `GET /v1/admob/ssv`
- `GET /v1/admob/reward-status?id=...`
- `GET /v1/usage`

Route registration is present in `workers/src/index.ts` through `handleAdMobRewardRoutes`.

## 3. Rewarded Ad Policy

Implemented policy:

- Valid rewarded ad SSV grants exactly `+2` ad/reward credits.
- Daily cap is `3` successful rewards per quota subject per JST day.
- Daily max is `+6` ad credits.
- Reward intents expire after 30 minutes if SSV never arrives.
- Granted ad credits expire after 30 days through the rewarded-ad credit bucket expiry field.
- Rewarded credits are separate from paid consumable credits.
- Client-side ad completion alone does not grant credits.

## 4. SSV Verification Behavior

Verified behavior:

- SSV callback signature is verified through AdMob public keys.
- `custom_data` / `customData` must match a pending server-created reward intent.
- The configured AdMob ad unit is allowlisted, including accepted Google callback variants.
- Missing transaction or ad unit fields return `verified_no_grant`.
- AdMob console verification callbacks can return 200 without granting credits.
- Invalid signatures return 401 and grant nothing.

Added in this pass:

- Signed callbacks with mismatched `reward_amount` are rejected.
- Signed callbacks with mismatched `reward_item` are rejected.
- Valid callbacks with `reward_amount=2` and `reward_item=credits` still grant exactly 2 credits.

## 5. Idempotency Behavior

Idempotency is enforced by:

- `admob_reward_transactions.transaction_id` primary key.
- Reward intent state transition from `pending` to `granted`.
- Durable Object credit operation id: `admob-reward:<transactionId>`.

Duplicate SSV callbacks return success/no-op behavior and do not double grant.

## 6. Daily Cap Behavior

Daily cap is checked:

- Before creating a reward intent when possible.
- Again at SSV grant time before credits are granted.

Regression coverage verifies:

- The third same-day reward can grant.
- The fourth same-day reward is rejected.
- Rejected fourth grant marks the intent rejected and does not mutate credits.

## 7. Credit Ledger Behavior

Rewarded AdMob grants use the ad/reward credit bucket:

- Ledger type: `admob_rewarded_grant`
- Reference type: `admob_rewarded`
- Expiry: 30 days
- Consumption order: monthly/free credits first, then rewarded ad credits, then paid credits.

Paid consumable credits remain separate and are consumed last.

## 8. iOS UI Behavior

Existing iOS flow is present:

1. User action calls `createAdMobRewardIntent`.
2. App loads a rewarded ad.
3. App passes server custom data into Google Mobile Ads SSV options.
4. Client ad completion does not grant credits.
5. App polls `/v1/admob/reward-status`.
6. App stores refreshed server usage only after the server reports `granted`.

Release/TestFlight visibility:

- Rewarded-credit UI is now release-visible when required AdMob rewarded config is present.
- DEBUG builds can show the UI for development and SSV smoke work.
- DEBUG demo ad unit is blocked from creating production reward intents.

## 9. Screenshots Captured

No rewarded-ad UI screenshots were captured in this older pass. Current release-visible behavior needs fresh TestFlight/App Review screenshots or human smoke notes before main merge/App Store submission readiness.

## 10. Tests / Commands Run

Worker commands:

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
```

Result: passed.

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm test -- admob reward quota usage
```

Result: passed, 62 tests across focused rewarded/quota coverage.

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm test
```

Result: passed, 597 tests.

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run dryrun:test
```

Result: passed.

iOS commands:

```sh
taskpolicy -b nice -n 10 xcodebuild test \
  -project ios/Kabuyomi.xcodeproj \
  -scheme Kabuyomi \
  -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' \
  -parallel-testing-enabled NO \
  -jobs 6
```

Result: failed before test execution because the iOS 26.4.1 simulator refused to launch the test runner with:

```text
Simulator device failed to launch app.kabuyomi.ios.
Application failed preflight checks
Busy
```

A second attempt after checking simulator state failed with the same simulator launch error. The build phase completed before the launch failure.

```sh
taskpolicy -b nice -n 10 xcodebuild build \
  -project ios/Kabuyomi.xcodeproj \
  -scheme Kabuyomi \
  -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' \
  CODE_SIGNING_ALLOWED=NO \
  -jobs 6
```

Result: passed.

```sh
git diff --check
```

Result: passed.

Simulator used:

- iPhone 17 Pro
- iOS 26.4.1
- UDID: `C6AD1211-DB18-4F10-8003-85D637B4F4C4`

## 11. Manual AdMob Console Steps Needed

- Confirm AdMob SSV callback URL points to the deployed Worker `/v1/admob/ssv`.
- Confirm production Worker `ADMOB_REWARDED_AD_UNIT_ID` matches the production rewarded ad unit.
- Confirm test Worker uses the Google test rewarded unit where intended.
- Confirm AdMob console verification callback returns 200 without granting credits.
- Confirm production logs show valid SSV callback verification before enabling Release/TestFlight UI.

## 12. TestFlight Smoke Checklist

- Confirm AdMob SSV callback URL is configured.
- Confirm production/test ad unit selection.
- Open Credits screen.
- Confirm rewarded ad section is visible when required AdMob rewarded config is present.
- Tap rewarded ad.
- Confirm reward intent is created.
- Complete rewarded ad.
- Confirm SSV callback reaches Worker.
- Confirm reward status becomes granted.
- Confirm +2 ad credits appear in `/v1/usage`.
- Repeat 3 times and confirm +6 max.
- Attempt 4th time and confirm daily cap.
- Confirm app does not grant if SSV does not arrive.
- Confirm duplicate SSV does not double grant.
- Confirm paid credits remain separate.

## 13. App Review Notes Impact

For the current v1.0.2 Release/TestFlight build:

- App Review notes may say rewarded ads are optional.
- Notes have to explain that credits are granted only after server-side verification.
- Notes must not imply ads are required to unlock functionality or that ad availability is guaranteed.

## 14. Remaining Risks

- iOS full tests could not execute because the iOS 26.4.1 simulator launch service returned `Busy` twice. This needs a clean simulator/test-runner retry outside the current busy simulator state.
- No live AdMob SSV callback was executed in this pass.
- No production deploy was performed.
- Rewarded UI is release-visible; fresh screenshots and TestFlight smoke are required.

## 15. releaseDecision

`backend-ready-ui-release-visible-smoke-required`

The Worker rewarded-credit path is ready for test deployment/smoke. The Release/TestFlight rewarded-credit UI is now intentionally visible when config is present, but live AdMob SSV smoke must still be recorded before main merge/App Store submission readiness.
