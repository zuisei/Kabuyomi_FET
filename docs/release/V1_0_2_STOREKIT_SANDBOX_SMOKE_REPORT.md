# Kabuyomi v1.0.2-C StoreKit Sandbox Smoke Report

## Summary

This report is the v1.0.2-C monetization smoke plan and local gate record for StoreKit sandbox/TestFlight verification.

Codex completed the code/config inspection and local automated validation. Real StoreKit purchase, restore, and App Store Server verification flows require a human operator with an App Store Connect sandbox tester or a TestFlight install; those manual checks are listed below with exact pass criteria.

No production deploy was performed. No push was performed.

## Environment

| Item | Value |
| --- | --- |
| Repo path | `/Users/0xt4/t4dano/Kabuyomi` |
| Branch | `v1.0.2-subscription-rewarded-credits` |
| Local iOS simulator used for build/test | iPhone 16, iOS 18.5 |
| iOS bundle ID | `app.kabuyomi.ios` |
| iOS project version observed | `MARKETING_VERSION: 1.0.1`, `CURRENT_PROJECT_VERSION: 3` in `ios/project.yml` |
| Release API base URL | `https://kabuyomi-api.dznqjmctk7.workers.dev` |
| Debug test API base URL | `https://kabuyomi-api-test.dznqjmctk7.workers.dev` |
| StoreKit config file | None found under `ios/` |
| TestFlight/sandbox runtime purchase execution | Not executable by Codex in this environment |

Important release note: because `MARKETING_VERSION` is still `1.0.1`, the human TestFlight operator must record the exact TestFlight build number/version before accepting this smoke. If the release is intended to ship as v1.0.2, update/versioning should be handled in the release process before upload.

## Product Configuration Checked

Code references inspected:

- `ios/Kabuyomi/Services/BetaBilling.swift`
- `ios/Kabuyomi/Services/SubscriptionStore.swift`
- `ios/Kabuyomi/Services/APIClient.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/App/AppModel.swift`
- `docs/release/V1_0_2_IOS_SUBSCRIPTION_UI_REPORT.md`

Expected products:

| Product ID | Kind | Expected result |
| --- | --- | --- |
| `kabuyomi.credits.50` | Consumable | Primary visible 50 paid-credit pack |
| `kabuyomi.credits.100` | Consumable | Visible compatibility 100 paid-credit pack |
| `kabuyomi.sub.lite.monthly` | Auto-renewable subscription | Lite, 400 monthly credits |
| `kabuyomi.sub.pro.monthly` | Auto-renewable subscription | Pro, 900 monthly credits |
| `kabuyomi.sub.max.monthly` | Auto-renewable subscription | Max, 2000 monthly credits |

Code-confirmed behavior:

- Product IDs are centralized in `BillingCatalog` and `SubscriptionStore`.
- Subscription sync posts to `POST /v1/ios/subscriptions/sync`.
- Credit purchase completion posts to `POST /v1/ios/purchases/credits/complete`.
- `/v1/usage` is refreshed after subscription sync and credit grant paths.
- The client does not grant subscription or consumable credits locally.
- Missing StoreKit products are represented as unavailable UI rows with retry/load state instead of enabled purchase actions.

## Product Load Smoke

Manual TestFlight/sandbox steps:

1. Install the candidate TestFlight build.
2. Open Settings > Credits.
3. Record diagnostic/runtime values visible in the app, especially API kind/base URL if shown.
4. Confirm all five products load with localized StoreKit prices:
   - `kabuyomi.credits.50`
   - `kabuyomi.credits.100`
   - `kabuyomi.sub.lite.monthly`
   - `kabuyomi.sub.pro.monthly`
   - `kabuyomi.sub.max.monthly`
5. Temporarily test a missing-product condition only in a debug/sandbox build if available; unavailable rows must be disabled and the screen must keep a retry path.

Pass criteria:

- Lite / Pro / Max rows are visible with monthly credit amounts and localized prices.
- `kabuyomi.credits.50` is first/primary.
- `kabuyomi.credits.100` remains visible and buyable.
- Missing/unreturned products do not show active purchase buttons.

Codex result: not executed against live StoreKit; no local `.storekit` config exists.

## Subscription Purchase Smoke

Manual steps for Lite:

1. Use a sandbox tester with no active Kabuyomi subscription, or clear existing sandbox subscription state as much as App Store sandbox permits.
2. Open Settings > Credits.
3. Tap Lite purchase.
4. Complete the App Store sandbox purchase sheet.
5. Confirm the app returns to Credits and shows a sync success state or active Lite state.
6. Confirm Worker logs or network instrumentation show `POST /v1/ios/subscriptions/sync`.
7. Confirm `/v1/usage` refreshes after sync.
8. Confirm active plan is Lite and monthly/subscription credits show 400 from server-provided usage fields.
9. Tap Restore/sync again and confirm no duplicate monthly grant.

Repeat when sandbox state allows:

- Pro should show active Pro and 900 monthly credits.
- Max should show active Max and 2000 monthly credits.

Pass criteria:

- Verified StoreKit transaction is sent to the Worker.
- Backend is authoritative for active plan and credits.
- Transaction is not treated as granted client-side if backend sync fails.
- Repeated sync for the same period does not double grant.

Codex result: not executed; requires sandbox purchase sheet and App Store sandbox account.

## Restore / Sync Smoke

Manual steps:

1. Start with an active sandbox subscription.
2. Reinstall the app or use Reset Local Data.
3. Open Settings > Credits.
4. Tap Restore/sync.
5. Confirm StoreKit entitlement is found.
6. Confirm `POST /v1/ios/subscriptions/sync` is called.
7. Confirm `/v1/usage` refreshes.
8. Confirm active plan summary appears.
9. Tap Restore/sync again.
10. Confirm backend returns the same state without duplicate credit grant.

Pass criteria:

- Restore uses StoreKit entitlement state.
- Restore does not grant credits locally.
- Duplicate restore/sync is idempotent.
- Device key remains stable across Reset Local Data.

Codex result: not executed; requires active sandbox entitlement.

## Consumable Smoke

Manual steps for `kabuyomi.credits.50`:

1. Record `/v1/usage` credit breakdown before purchase.
2. Buy the 50-credit pack.
3. Confirm Worker logs or network instrumentation show `POST /v1/ios/purchases/credits/complete`.
4. Confirm `/v1/usage` refreshes.
5. Confirm paid credits increase by 50.
6. Confirm monthly/subscription credits are unchanged except for normal server-side refresh values.

Manual steps for `kabuyomi.credits.100`:

1. Buy the 100-credit compatibility pack if visible in the candidate build.
2. Confirm paid credits increase by 100.
3. Confirm the compatibility product remains server-verified and idempotent.

Pass criteria:

- Paid credits are server-granted only after Apple verification.
- Paid credits remain separate from monthly/subscription credits.
- Repeating an already completed transaction does not double grant.

Codex result: not executed; requires sandbox purchase sheet and App Store sandbox account.

## Negative Flow Smoke

Manual checks:

| Scenario | Steps | Expected result |
| --- | --- | --- |
| User cancels purchase | Start Lite or credit-pack purchase, cancel in App Store sheet | No backend grant, no local credit increment, user remains on Credits |
| Backend/network failure | Use a debug build with unreachable API base URL or network disabled after StoreKit purchase sheet starts | App does not mark credits granted locally; pending/unfinished transaction can be retried or recovered |
| StoreKit pending | Trigger pending purchase state if sandbox supports it | No local grant; user sees pending/error state |
| Stale usage after reset | Start a slow usage refresh/sync in debug instrumentation, reset local data before completion | Old response does not overwrite current state |

Pass criteria:

- No client-side credit grant occurs in any negative flow.
- Failed or pending StoreKit transactions are recoverable through restore/retry paths.
- Reset generation guards prevent stale usage writes.

Codex result: stale usage/reset behavior is covered by local AppModel tests; StoreKit negative flows require manual sandbox execution.

## Upgrade / Downgrade Smoke

Manual steps:

1. Start with Lite active.
2. Upgrade to Pro or Max through the App Store sandbox sheet.
3. Confirm the new verified transaction syncs to the Worker.
4. Confirm active plan display follows the backend-returned plan.
5. Confirm `/v1/usage` refreshes.
6. Tap Restore/sync twice.
7. Confirm no duplicate same-period grant.
8. Schedule or trigger downgrade in sandbox if available.
9. Document when the downgraded plan becomes active according to App Store sandbox timing.

Pass criteria:

- Upgrade display and credits follow backend response.
- Same-period repeated sync does not double grant.
- Downgrade timing follows App Store sandbox behavior and backend active entitlement state.

Codex result: not executed; requires sandbox subscription state transitions.

## Local Commands Run

- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5'`
  - Result: passed.
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
- `cd workers && npm run typecheck`
  - Result: passed.
- `cd workers && npm test -- billing-catalog purchase billing quota subscription`
  - Result: passed, 3 files / 46 tests.
- `cd workers && npm run dryrun:test`
  - Result: passed, dry-run only.
- `git diff --check`
  - Result: passed.

## Manual Evidence To Capture

Record these fields before marking the smoke complete:

- TestFlight build number and app version shown by TestFlight.
- Installed runtime: TestFlight, App Store sandbox, or Xcode debug.
- Device model and iOS version.
- API base URL/kind displayed by the app.
- StoreKit product load result, including localized prices.
- Before/after `/v1/usage` screenshots or sanitized JSON.
- Worker log evidence for:
  - `/v1/ios/subscriptions/sync`
  - `/v1/ios/purchases/credits/complete`
  - duplicate sync/transaction idempotency
- Active plan and credit breakdown screenshots after purchase/restore.
- Any StoreKit diagnostics lines for empty/failed product loads.

## Release Decision

Local automated gate: green.

StoreKit sandbox/TestFlight monetization gate: hold until a human operator completes at least:

1. Product loading for all five product IDs.
2. One end-to-end subscription purchase, preferably Lite first.
3. Restore/sync with active entitlement.
4. 50-credit consumable purchase.
5. Duplicate restore/sync no-double-grant check.
6. Purchase cancel or backend/network failure negative check.

Do not submit v1.0.2 monetization until the manual evidence above is recorded. Do not deploy production or push from this smoke step unless explicitly instructed.
