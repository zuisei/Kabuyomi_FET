# v1.0.2 Rewarded Ad Return Navigation Fix Report

## 1. Executive summary

This change fixes the rewarded-ad smoke issue where a release build could return to the Home / company root surface after an ad creative opened an App Store product page scene, even though the reward grant itself succeeded.

The reward, SSV, credit amount, daily cap, ledger, and Worker behavior were not changed. The fix only adds iOS-side return-destination state and restoration so a rewarded-ad flow started from Credits returns to Credits after ad dismissal, pending status, grant, cap, or failure unless the user explicitly closes Credits.

## 2. Root cause hypothesis

Kabuyomi does not currently use a root `TabView` for Home / Settings / Credits. The app root is `AppRootView`, which hosts `CompanyView` in a `NavigationStack`. `CreditView` is presented from `CompanyView` using local `@State`:

- `CompanyView.creditsPresented`
- `CompanyView.creditInitialSheet`
- `.fullScreenCover(isPresented: $creditsPresented) { CreditView(...) }`

Rewarded ad presentation can leave the app through an ad creative or `AppStore.ProductPageExtension` scene. When the app returns, SwiftUI local presentation state can be lost or churned while `AppModel` still has the rewarded-ad grant state. That makes the user appear to be back on the company root, even though logs show the rewarded grant flow continues and eventually reaches `reward_status_granted`.

No evidence was found that usage refresh or entitlement refresh intentionally navigates to Home. The likely reset point is the local Credits full-screen-cover presentation state around the external ad / App Store scene transition.

## 3. Files changed

- `ios/Kabuyomi/App/AppModel.swift`
  - Added rewarded-ad return destination state.
  - Added restore-request signaling.
  - Added scene-phase handling and safe logs.
  - Requests Credits restoration on pending, granted, dismissed, capped, unavailable, and failed rewarded-ad outcomes.
  - Redacted AdMob unit and reward intent values in rewarded-ad diagnostics.

- `ios/Kabuyomi/App/AppRootView.swift`
  - Observes `scenePhase`.
  - Forwards `active` / `inactive` / `background` transitions to `AppModel` for rewarded-ad return logging/restoration.

- `ios/Kabuyomi/Features/Company/CompanyView.swift`
  - Observes rewarded-ad restoration requests from `AppModel`.
  - Re-presents Credits when the active rewarded-ad flow has a `.credits` return destination.
  - Does not force navigation when the return destination was cleared by an explicit Credits close.

- `ios/Kabuyomi/Features/Settings/CreditView.swift`
  - Records `.credits` as the intended rewarded-ad return destination before starting the ad flow.
  - Marks the return destination as user-dismissed when the user taps Close.

- `ios/Kabuyomi/Services/RewardedAdService.swift`
  - Keeps existing ad behavior.
  - Redacts the AdMob unit in release-safe rewarded-ad logs.

- `ios/KabuyomiTests/AppModelTests.swift`
  - Adds tests for return-destination recording, successful grant restoration, pending SSV restoration, dismissed-without-reward restoration, usage refresh preservation, and manual close skip behavior.

## 4. Navigation behavior before/after

Before:

- Credits was only local `CompanyView` sheet state.
- Rewarded ad flow continued in `AppModel`, but a scene transition from an ad creative could leave the visible UI on the company root.
- The successful grant could be reflected in usage while the user was no longer looking at Credits.

After:

- Tapping the rewarded-ad entry in Credits records a return destination: `.credits`.
- `AppModel` logs `rewarded_ad_return_destination_set` and `selected_tab_before_rewarded_ad`.
- When the app returns active, when the ad is dismissed, when SSV polling starts, when grant completes, or when the flow ends in cap/failure/unavailable, `AppModel` issues a restore request if the current flow still owns the destination.
- `CompanyView` receives the request and presents Credits again.
- `AppModel` logs `rewarded_ad_return_destination_restored` and `selected_tab_after_rewarded_ad`.
- If the user explicitly taps Close in Credits, `markRewardedAdCreditsClosedByUser()` clears the destination and logs `rewarded_ad_return_destination_skipped_user_navigated`.

## 5. Rewarded ad grant behavior unchanged confirmation

The rewarded grant path is intentionally unchanged:

- iOS still creates a reward intent before presenting the ad.
- iOS still passes backend-provided `customData` to Google Mobile Ads before presentation.
- iOS still treats backend reward status as authoritative.
- Client-only ad completion still does not mutate the credit balance locally.
- iOS still waits for `/v1/admob/reward-status`.
- The grant still stores the backend-provided usage snapshot through the existing usage storage path.
- Reward amount remains +2 ad/free credits.
- Daily cap remains 3 successful rewards per JST day.
- Worker SSV verification, idempotency, ledger, caps, and endpoints were not changed.

## 6. Tests added/updated

Added iOS tests in `AppModelTests`:

- `testRewardedAdCreditsRecordsReturnDestinationBeforeFlow`
- `testRewardedAdCreditSuccessRequestsCreditsReturnDestination`
- `testRewardedAdPendingSSVKeepsCreditsReturnDestination`
- `testRewardedAdDismissedWithoutRewardRequestsCreditsReturnDestination`
- `testRewardedAdUsageRefreshAfterGrantDoesNotClearCreditsReturnDestination`
- `testRewardedAdManualCreditsCloseSkipsReturnDestinationRestore`

Existing rewarded-ad tests were kept.

## 7. Validation results

Commands run:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/ios
xcodegen generate
xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO
xcodebuild build -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO
cd /Users/0xt4/t4dano/Kabuyomi
git diff --check
```

Results:

- `xcodegen generate`: passed.
- `xcodebuild test`: passed, 146 tests executed, 0 failures.
- `xcodebuild build`: passed.
- `git diff --check`: passed.

Known validation note:

- Test output still includes pre-existing Swift actor-isolation warnings around `DeviceIdentityStore().reset()` in tests. This patch did not introduce those warnings.

Worker tests were not run because no Worker files were changed.

## 8. Remaining manual smoke steps

Run on the next TestFlight / release-device smoke:

1. Install/open the TestFlight build.
2. Open Credits / Account Status from the app UI.
3. Confirm rewarded ad UI is visible.
4. Record paid balance, ad/free balance, total balance, and daily remaining before the ad.
5. Tap the rewarded-ad entry.
6. Confirm logs include `rewarded_ad_return_destination_set`.
7. Confirm logs include `selected_tab_before_rewarded_ad`.
8. Watch the rewarded ad.
9. If the ad opens an App Store product page, return to Kabuyomi.
10. Confirm logs include `rewarded_ad_scene_phase_changed` for the scene transition.
11. Confirm the app remains on or returns to Credits / Account Status, not Home.
12. Confirm logs include `rewarded_ad_return_destination_restored`.
13. Confirm logs include `selected_tab_after_rewarded_ad`.
14. Wait for SSV / status polling.
15. Confirm `reward_status_granted`.
16. Confirm ad/free credits increase by exactly +2.
17. Confirm paid credits do not increase.
18. Repeat until 3 successful rewards.
19. Confirm daily remaining reaches 0.
20. Confirm the 4th attempt remains on Credits and shows the daily-cap state.
21. Explicitly tap Close on Credits, then confirm the app does not force Credits open again from an old reward flow.

Useful log events:

- `rewarded_button_tapped`
- `rewarded_ad_return_destination_set`
- `selected_tab_before_rewarded_ad`
- `rewarded_ad_scene_phase_changed`
- `rewarded_ad_user_did_earn_reward`
- `rewarded_ad_dismissed`
- `reward_status_polling_started`
- `reward_status_granted`
- `rewarded_ad_return_destination_restored`
- `selected_tab_after_rewarded_ad`
- `rewarded_ad_return_destination_skipped_user_navigated`

Redaction reminder:

- Do not capture raw device keys.
- Do not capture full reward intent IDs.
- Do not capture full transaction IDs.
- Do not capture full callback URLs.
- Do not capture AdMob unit IDs.
- Do not capture SSV signatures.
- Suffix-only IDs are enough for smoke evidence.

## 9. Scope confirmation

Confirmed scope:

- No `v1.2-sec-form-router` branch was created.
- No SEC Form Router work was added.
- No Worker filing retrieval code was changed.
- No Worker answer-quality logic was changed.
- No Worker files were changed.
- No reward grant logic was changed.
- No SSV verification logic was changed.
- No credit amount or daily cap was changed.
- Company UI polish was not removed or reverted.
- No push, merge, or production deploy was performed.
