# Rewarded AdMob Credits Release Checklist

This checklist is for the installed TestFlight / App Store build. DEBUG smoke mode is a developer diagnostic path only and is not part of release readiness.

## Pre-upload

- Release build uses the production API.
- Release build uses the production rewarded ad unit: `ca-app-pub-1248492954379402/7202804414`.
- Release build does not expose Test API controls.
- Release build does not expose SSV smoke mode controls.
- Release build does not expose test device ID controls.
- Release build does not use the Google demo rewarded ad unit.
- Rewarded-ad credit feature is visible and enabled for eligible users.
- Reward amount is `+2 credits`.
- Reward grant waits for AdMob server-side verification before credits are reflected.
- Error messages distinguish ad display failure, ad unavailability/no-fill, and server confirmation timeout.
- Full iOS test suite passes.
- Release build passes.
- Archive/export passes if signing credentials and export configuration are available.
- App Store Connect upload passes if credentials and upload configuration are available.

## Mini Consumable IAP

- Consumable IAP product ID is `kabuyomi.credits.100`.
- App Store Connect reference name is `Kabuyomi Credits 100`.
- App Store Connect product exists: yes.
- App Store Connect product status: Ready to Submit.
- Product grants exactly `+100` purchased credits.
- The app displays the localized StoreKit price when product metadata is available.
- Product loading has a finite timeout and surfaces `クレジット商品を読み込めませんでした。少し時間をおいて再試行してください。` instead of staying indefinitely on price/loading text.
- Purchase completion is sent to `/v1/ios/purchases/credits/complete`.
- Worker verifies the Apple transaction through App Store Server before granting credits.
- The server ignores client-side credit amounts and resolves the grant amount from `kabuyomi.credits.100`.
- Duplicate Apple `transactionId` returns an already-granted result and does not double-grant.
- StoreKit transactions are finished only after the Worker grants or confirms the purchase was already granted.
- Production Worker deploy with Mini route: not confirmed.
- App version IAP attachment: manual check required.
- TestFlight product load: not verified.
- TestFlight sandbox purchase: not verified.

## Packaging Status

- Code release candidate: verified.
- Full iOS test suite: pass.
- Release build: pass.
- Unsigned archive check: pass.
- Signed archive: pass with local automatic signing.
- IPA export: pass with App Store Connect export options and Xcode-managed distribution signing.
- App Store Connect upload: blocked unless App Store Connect upload credentials or an authenticated Xcode account with an associated provider are available.
- Export options template: `ios/ExportOptions.appstore.template.plist`.
- Production ad config scan: pass when the Release archive contains the production API and production rewarded ad unit, and does not contain demo/test/debug setup strings.

## App Review Notes

Rewarded ads are optional. Users can watch a rewarded ad to receive 2 in-app credits. Credits are used for AI chat requests. The app verifies rewarded ad completion through AdMob server-side verification before granting credits.

## Post-upload / Post-release Monitoring

- Confirm the build is available in App Store Connect / TestFlight.
- Install the build from TestFlight / App Store, not from Xcode DEBUG.
- Confirm developer-only controls are absent.
- Confirm the rewarded-ad credit button is present for eligible users.
- Confirm the AdMob app is linked to the App Store listing when available.
- Monitor AdMob app readiness status.
- Monitor production Worker logs for `/v1/admob/ssv`.
- Confirm valid SSV callbacks return HTTP 200.
- Confirm reward-status changes from `pending` to `granted` for real user callbacks.
- Confirm `+2 credits` are reflected.
- Confirm duplicate `transaction_id` does not double-grant.
- Confirm daily cap still works.
- Confirm invalid `ad_unit` is rejected.
- Confirm reward_amount mismatch is rejected.
- Confirm expired reward intents are rejected.
- Monitor pending reward-intent timeout rate.

## Rollback / Hold Triggers

- Release/TestFlight build selects any non-production API by default.
- Release/TestFlight build selects the Google demo rewarded ad unit.
- Release/TestFlight exposes DEBUG-only ad controls or setup instructions.
- Rewarded ad completion grants credits without server-side verification.
- Production SSV callbacks fail signature verification unexpectedly.
- Duplicate SSV callbacks double-grant credits.
- Daily cap is not enforced.
- Mini consumable purchase grants credits from an unverified client payload.
- Mini consumable duplicate transaction grants credits more than once.
