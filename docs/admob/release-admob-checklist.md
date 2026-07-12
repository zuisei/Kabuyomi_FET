# Rewarded AdMob Credits Release Checklist

This checklist is for the installed TestFlight / App Store build. DEBUG smoke mode is a developer diagnostic path only and is not part of release readiness. Rewarded-credit visibility is controlled by the exact uploaded build plus a fresh trusted full production capability response. If real Google AdMob SSV grant evidence is not recorded, the submission config must explicitly disable the action and App Review copy must not advertise it.

## Pre-upload

- Release build uses the production API.
- Release build uses the production rewarded ad unit: `ca-app-pub-1248492954379402/7202804414`.
- Release build does not expose Test API controls.
- Release build does not expose SSV smoke mode controls.
- Release build does not expose test device ID controls.
- Release build does not use the Google demo rewarded ad unit.
- Record whether the exact Release/TestFlight build shows the rewarded-credit action. Visibility requires explicit compatible `adsEnabled`, `rewardedCreditEnabled`, and `rewardedSsvReady` values; missing or partial deployed config must hide it.
- Reward amount remains `+2 credits` in infrastructure.
- Rewarded grants remain capped at 3 valid grants / +6 ad credits per user per JST day when the UI is enabled.
- Rewarded ad credits expire 30 days after grant when granted.
- Reward grant waits for AdMob server-side verification before credits are reflected.
- Invalid signatures, invalid ad units, malformed callbacks, expired intents, and duplicate transactions do not grant extra credits.
- Rewarded credits are free/ad credits and remain separate from paid credits.
- Error messages distinguish ad display failure, ad unavailability/no-fill, and server confirmation timeout.
- Full iOS test suite passes.
- Release build passes.
- Archive/export passes if signing credentials and export configuration are available.
- App Store Connect upload passes if credentials and upload configuration are available.

## v1.0.2 StoreKit Products

- Primary consumable IAP product ID is `kabuyomi.credits.50`.
- `kabuyomi.credits.50` grants exactly `+50` paid credits.
- `kabuyomi.credits.100` remains supported as an existing compatibility consumable when App Store Connect returns it.
- Subscription group is `Kabuyomi_sus`.
- `kabuyomi.sub.lite.monthly` grants 400 subscription credits/month.
- `kabuyomi.sub.pro.monthly` grants 900 subscription credits/month.
- `kabuyomi.sub.max.monthly` grants 2,000 subscription credits/month.
- The app displays the localized StoreKit price when product metadata is available.
- Product loading has a finite timeout and surfaces `クレジット商品を読み込めませんでした。少し時間をおいて再試行してください。` instead of staying indefinitely on price/loading text.
- Purchase completion is sent to `/v1/ios/purchases/credits/complete`.
- Worker verifies the Apple transaction through App Store Server before granting credits.
- The server ignores client-side credit amounts and resolves the grant amount from the verified product ID.
- Duplicate Apple `transactionId` returns an already-granted result and does not double-grant.
- StoreKit transactions are finished only after the Worker grants or confirms the purchase was already granted.
- Production Worker route availability for credit and subscription sync has a v1.0.2 report, but real StoreKit purchase/restore smoke remains manual.
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
- Production ad config scan: pass when the Release archive contains the production API, does not expose demo/test/debug setup strings, and its rewarded-credit visibility matches the recorded trusted capability response.

## App Review Notes

Reviewer notes must match the exact uploaded build. If the rewarded-credit action is hidden, do not claim rewarded ads or ad credits. If it is visible, say it is optional, explain that only Worker-verified Google AdMob SSV grants credit, and attach real production/TestFlight SSV evidence. Paid IAP and subscriptions are described only when their explicit billing capabilities are enabled and StoreKit returns them.

## Manual Rewarded-Credit Verification Before Re-Enable

1. Install the TestFlight or Release build.
2. Use a dedicated smoke build or a Release candidate whose fresh trusted full config explicitly enables the rewarded-credit capability.
3. Open the credit/settings screen.
4. Tap the rewarded-ad button.
5. Confirm the ad loads and completes.
6. Confirm `/v1/admob/reward-intents` created a pending reward intent.
7. Confirm the Google SSV callback reached `/v1/admob/ssv`.
8. Confirm exactly +2 credits were granted.
9. Confirm `/v1/admob/reward-status?id=<intent>` shows `granted`.
10. Confirm `/v1/usage` reflects the granted ad credits.
11. Repeat until 3 valid grants have been made for the same JST day.
12. Confirm the 4th grant is capped.
13. Confirm a duplicate callback for the same transaction does not double grant.
14. Confirm an invalid ad unit test rejects and does not grant.
15. Confirm an invalid signature test rejects and does not grant.
16. Confirm paid credit balance is not consumed before free/ad credits.

## Post-upload / Post-release Monitoring

- Confirm the build is available in App Store Connect / TestFlight.
- Install the build from TestFlight / App Store, not from Xcode DEBUG.
- Confirm developer-only controls are absent.
- Confirm the rewarded-ad credit button is visible only when the complete trusted production capability is enabled, and that missing/partial config or an emergency disable hides it.
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
- App Review copy claims rewarded credit visible when the uploaded build hides it, or a visible action lacks real SSV evidence.
