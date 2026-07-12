# Kabuyomi v1.0.2-B iOS Subscription UI Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Executive summary

This phase wires the iOS app to the v1.0.2 subscription backend without changing Worker answer quality, SEC retrieval, model config, prompt policy, or filing router logic.

The Credits screen now loads StoreKit products for Lite, Pro, and Max monthly auto-renewable subscriptions, keeps the 50-credit consumable first as the primary small pack, and preserves the legacy 100-credit consumable as a visible buyable compatibility pack.

## Product IDs shown in UI

- Primary consumable: `kabuyomi.credits.50`
- Compatibility consumable: `kabuyomi.credits.100`
- Monthly subscriptions:
  - `kabuyomi.sub.lite.monthly`
  - `kabuyomi.sub.pro.monthly`
  - `kabuyomi.sub.max.monthly`

`kabuyomi.credits.50` is shown first and marked as the primary option. `kabuyomi.credits.100` remains visible and buyable so existing App Store Connect support and existing users are not broken.

## Screens touched

- Settings > Credits
  - Credit balance card
  - Monthly subscription section
  - Paid credit purchase section
  - Restore/sync purchase action
- Settings legal text
  - Terms credit purchase section
  - Tokushoho sale price section

## Subscription plan config

| Plan | Product ID | Monthly credits |
| --- | --- | ---: |
| Lite | `kabuyomi.sub.lite.monthly` | 400 |
| Pro | `kabuyomi.sub.pro.monthly` | 900 |
| Max | `kabuyomi.sub.max.monthly` | 2000 |

The screen displays localized StoreKit prices when StoreKit returns product metadata. Missing StoreKit products stay disabled and show a retry path instead of exposing unsupported purchase buttons.

## Purchase and sync behavior

- Subscription purchases use StoreKit 2.
- On a verified subscription purchase, iOS sends the transaction to `POST /v1/ios/subscriptions/sync`.
- The app refreshes `/v1/usage` after sync.
- Subscription transactions are finished only after the app successfully syncs the verified transaction with the backend.
- The backend remains authoritative for active plan, monthly credit grants, idempotency, and credit balances.
- User cancellation returns without a grant attempt.
- Pending purchases and unknown purchase results are surfaced as user-visible errors.
- Backend rejection or network failure does not create client-side credits.

## Restore / sync behavior

- The Credits screen has a visible restore/sync action.
- Restore uses StoreKit 2 `AppStore.sync()` and current entitlements.
- If an active subscription entitlement is found, iOS calls `POST /v1/ios/subscriptions/sync` and then refreshes `/v1/usage`.
- If no active subscription is found, the app shows a no-restorable-subscription message.

## Usage and credit display behavior

- The Credits screen uses server-provided `/v1/usage` fields.
- It displays total credits, monthly/free or monthly subscription credits, rewarded/ad credits when the existing rewarded UI is visible, and paid credits when present.
- Active subscription details come from server-provided `activeSubscription` fields when available.
- The client does not infer grants or perform local credit accounting.

## Sandbox purchase scenarios to test

- Load StoreKit products for Lite, Pro, Max, the 50-credit pack, and the 100-credit compatibility pack.
- Buy Lite and confirm `/v1/ios/subscriptions/sync` succeeds, `/v1/usage` refreshes, and 400 monthly credits appear.
- Buy Pro and confirm 900 monthly credits appear.
- Buy Max and confirm 2000 monthly credits appear.
- Cancel from the App Store purchase sheet and confirm no backend grant is attempted.
- Trigger pending purchase flow if available from StoreKit sandbox and confirm the app does not grant credits locally.
- Simulate backend rejection or network failure and confirm the transaction is not treated as granted client-side.
- Buy the 50-credit consumable and confirm paid credits increase and remain separate.
- Buy the 100-credit consumable and confirm paid credits still increase through the compatibility path.

## Restore purchase scenario

- Install clean app state with an existing active sandbox subscription.
- Open Settings > Credits.
- Tap Restore/sync.
- Confirm StoreKit entitlement is found, `/v1/ios/subscriptions/sync` is called, `/v1/usage` refreshes, and the active plan summary appears.

## Upgrade / downgrade scenario

- Start with Lite active in sandbox.
- Upgrade to Pro or Max in the App Store sandbox flow.
- Confirm the app sends the new verified transaction to the backend and shows the backend-returned active plan.
- Confirm duplicate grants are not created on repeated Restore/sync taps.
- Downgrade behavior should follow App Store sandbox subscription timing; the app displays the backend-returned active plan and credit balance after sync.

## Known limitations

- This older subscription-UI phase did not add rewarded ad UI. Later v1.0.2 ad-credit visibility claims are superseded by current RC truth: rewarded-credit UI is hidden for Release/App Review until real Google AdMob SSV grant evidence is recorded in-repo.
- This phase does not add account sync, App Attest, external purchase links, or SEC form router work.
- Renewal/cancel status is displayed only from server-provided `periodEnd`/`expiresAt`; the UI does not independently interpret App Store renewal state beyond StoreKit entitlements.
- The `kabuyomi.credits.100` consumable remains supported and visible, but `kabuyomi.credits.50` is the first/primary pack.

## Device key / reset regression fix

The first full iOS test run exposed a regression in existing AppModel identity/reset invariants:

- `AppModelTests.testResetLocalDataClearsRecentStateAndKeepsDeviceIdentity`
- `AppModelTests.testWatchlistAddsReuseStableDeviceKey`
- `AppModelTests.testResetLocalDataIgnoresStaleUsageRefreshFromPreviousGeneration`

Root cause: the device key is backed by Keychain, but the unsigned simulator test host can fail or miss Keychain reads during rapid AppModel setup/reset paths. Without an in-process fallback, `DeviceIdentityStore.deviceKey()` could generate a new UUID for a later APIClient/watchlist call in the same session. The subscription sync additions also introduced new usage-write paths that needed the same reset-generation guard as the existing usage refresh flow.

Fix:

- `DeviceIdentityStore` now caches the resolved device key in process memory and clears that cache only through the explicit identity reset path.
- `resetLocalData` continues to clear local app state without rotating the anonymous device identity.
- Subscription purchase sync and restore/sync now guard response application and `response.usage` writes with the current AppModel generation, so stale async billing responses cannot overwrite state after reset.
- No client-side credit grants were added; `/v1/ios/subscriptions/sync` and `/v1/usage` remain server-authoritative.

## Commands run

- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5'`
  - Result: passed.
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
  - The previously failing AppModel tests now pass:
    - `AppModelTests.testResetLocalDataClearsRecentStateAndKeepsDeviceIdentity`
    - `AppModelTests.testWatchlistAddsReuseStableDeviceKey`
    - `AppModelTests.testResetLocalDataIgnoresStaleUsageRefreshFromPreviousGeneration`
- Focused rerun:
  - `xcodebuild test ... -only-testing:KabuyomiTests/AppModelTests/testResetLocalDataClearsRecentStateAndKeepsDeviceIdentity -only-testing:KabuyomiTests/AppModelTests/testWatchlistAddsReuseStableDeviceKey -only-testing:KabuyomiTests/AppModelTests/testResetLocalDataIgnoresStaleUsageRefreshFromPreviousGeneration`
  - Result: passed.
- Swift format/lint:
  - Result: no `.swiftformat` or `.swiftlint.yml` configuration was found in the repository.
- `cd workers && npm run typecheck`
  - Result: passed.
- `cd workers && npm test -- billing-catalog purchase billing quota subscription`
  - Result: passed, 3 files / 46 tests.
- `cd workers && npm run dryrun:test`
  - Result: passed, Wrangler dry-run only.

## Release decision

Local code/test gate is green for v1.0.2-B after the AppModel device-key/reset fix. Do not submit release until the manual StoreKit sandbox checklist above is exercised against App Store sandbox/TestFlight and the backend subscription sync endpoint is confirmed in that environment.
