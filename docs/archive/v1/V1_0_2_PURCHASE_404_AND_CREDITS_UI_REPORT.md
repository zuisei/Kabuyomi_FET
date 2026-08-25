# Kabuyomi v1.0.2 Purchase 404 And Credits UI Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Executive Summary

The purchase 404 was diagnosed as an API deployment/base-route issue, not a StoreKit product validation error and not a client-side credit grant issue.

Current source code registers:

- `POST /v1/ios/subscriptions/sync`
- `POST /v1/ios/purchases/credits/complete`
- compatibility `POST /v1/credits/purchase-grant`
- compatibility `POST /v1/billing/sync`

Live route probes on May 9, 2026 showed:

| Base URL | Endpoint | Result | Interpretation |
| --- | --- | --- | --- |
| `https://kabuyomi-api.dznqjmctk7.workers.dev` | `GET /v1/usage` | 200 | production Worker reachable |
| `https://kabuyomi-api.dznqjmctk7.workers.dev` | `POST /v1/ios/purchases/credits/complete` with `{}` | 400 `Invalid credit purchase payload` | credit route exists; payload validation reached |
| `https://kabuyomi-api.dznqjmctk7.workers.dev` | `POST /v1/ios/subscriptions/sync` with `{}` | 404 `Not found` | subscription route is missing from deployed production Worker |
| `https://kabuyomi-api-test.dznqjmctk7.workers.dev` | `POST /v1/ios/purchases/credits/complete` with `{}` | 400 `Invalid credit purchase payload` | test credit route exists |
| `https://kabuyomi-api-test.dznqjmctk7.workers.dev` | `POST /v1/ios/subscriptions/sync` with `{}` | 404 `Not found` | test subscription route is also missing from deployed Worker |

Conclusion: the source tree has the subscription route, but the deployed Workers inspected at the public production/test URLs do not yet expose `/v1/ios/subscriptions/sync`. A subscription purchase from TestFlight/Release will therefore fail after StoreKit purchase when the app tries to sync with the backend. The app must not finish the transaction as granted in this state, and it does not grant credits locally.

No production deploy was performed.

## 404 Root Cause

Most likely root cause:

- deployed Worker is stale relative to the v1.0.2-A backend commit, at least for subscription sync.

Ruled out by inspection/probe:

- wrong iOS endpoint path: iOS calls `POST /v1/ios/subscriptions/sync`, matching current Worker source.
- method mismatch: probe used `POST`, matching current Worker source.
- credit consumable route missing on the probed production URL: `POST /v1/ios/purchases/credits/complete` returns 400 for invalid payload, so the route exists there.
- Apple/product validation failure: route-level 404 happens before Apple verification or product validation.

Still possible in a specific device report:

- the installed TestFlight build may be old or may use an unexpected API base URL. The Account Status sheet now displays API environment/base URL and route health diagnostics to confirm this on-device.

## iOS Diagnostics Added

- `APIClient` now maps HTTP 404 responses to `APIError.routeMissing`, preserving:
  - HTTP status
  - endpoint path
  - full URL
  - server error message
- Debug error presentation distinguishes route missing from Apple verification/product validation failures.
- `APIClient.checkBillingAPIHealth()` probes:
  - `GET /v1/usage`
  - `POST /v1/ios/subscriptions/sync` with an invalid empty JSON body
  - `POST /v1/ios/purchases/credits/complete` with an invalid empty JSON body
- Expected route-exists result for invalid billing POSTs is 400/401-class validation/auth failure, not 404.
- `AppModel` tracks:
  - last usage refresh time
  - last billing sync/grant status
  - last billing sync/grant time
  - billing API health report

Safety behavior remains unchanged:

- no client-side credit grants were added.
- StoreKit transactions are not finished as granted when backend sync/grant returns 404.
- backend remains authoritative for credit grants, plan status, and usage.

## Account Status UI

Settings > Credits now has an Account Status sheet under Purchase Management.

It displays only runtime/server-provided state:

- API environment and base URL
- app version/build
- current plan
- total credits
- monthly/subscription credits
- rewarded/ad credits when provided
- paid credits
- next renewal/reset when provided
- last usage refresh
- last billing sync status
- redacted device identity suffix only
- billing route health results after running the debug route check

It does not display full device keys, tokens, full transaction IDs, or client-invented credit accounting.

## Credits Screen IA Changes

The main Credits screen is now reduced to:

1. Top balance card
   - total credits
   - active plan badge
   - next reset/renewal when available
   - refresh button
2. Current plan card
   - active plan summary
   - View / change plan button
3. Add credits card
   - primary 50-credit pack
   - More packs sheet for the 100-credit compatibility pack
4. Purchase Management
   - Restore purchases
   - Account status
   - Credit rules / legal info

Detailed Lite / Pro / Max comparison moved to a plan sheet. Credit rules and restore explanation moved to a separate rules sheet.

## Tests Added / Updated

- APIClient maps subscription sync 404 to route missing with endpoint details.
- APIClient maps credit purchase completion 404 to route missing with endpoint details.
- Billing API health check distinguishes 404 route missing from 400 validation errors.
- Credit pack presentation keeps 50-credit primary and 100-credit compatibility rows separate.
- Account Status display model formats server usage and handles missing `activeSubscription`.

## Manual TestFlight Checks Remaining

Before release submission:

1. Install the current TestFlight candidate and open Settings > Credits > Account Status.
2. Confirm API base URL shown by the app.
3. In a debug build, run billing route health:
   - `/v1/usage` should be 200.
   - `/v1/ios/subscriptions/sync` should not be 404 after the backend is deployed.
   - `/v1/ios/purchases/credits/complete` should not be 404.
4. Attempt Lite purchase again only after subscription route health is not 404.
5. Confirm subscription purchase calls `/v1/ios/subscriptions/sync`, refreshes `/v1/usage`, and shows Lite / 400 monthly credits.
6. Confirm Restore/sync is idempotent.
7. Confirm `kabuyomi.credits.50` purchase still uses `/v1/ios/purchases/credits/complete` and paid credits increase only after backend verification.

## Validation Commands

Run on May 9, 2026:

| Command | Result | Notes |
| --- | --- | --- |
| `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5'` | blocked by CoreSimulator clone failure | Xcode failed before XCTest execution: device allocated but stuck in creation state. |
| `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO` | passed | 136 tests, 0 failures. |
| `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO` | passed | unsigned simulator build succeeded. |
| `cd workers && npm run typecheck` | passed | TypeScript compile check succeeded. |
| `cd workers && npm test -- billing-catalog purchase billing quota subscription` | passed | 46 Worker tests passed. |
| `cd workers && npm run dryrun:test` | passed | Wrangler test dry-run succeeded; no deploy performed. |
| `git diff --check` | passed | no whitespace errors. |

## Release Decision

Code-level diagnostics and Credits UI IA changes are ready for local validation.

Release remains blocked until the deployed Worker used by TestFlight exposes `POST /v1/ios/subscriptions/sync` and an end-to-end sandbox subscription purchase succeeds. Do not submit v1.0.2 monetization while that endpoint returns 404.
