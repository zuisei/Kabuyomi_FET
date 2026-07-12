# Kabuyomi v1.0.2-A Subscription Backend Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Executive summary

This backend/config phase adds App Store product configuration, the new 50-credit consumable, Apple-verified subscription sync, and idempotent monthly subscription credit grants.

No production deploy was performed. No iOS subscription UI, rewarded ad UI, Worker answer-quality logic, SEC retrieval, model config, or SEC form router work was added.

## Product IDs implemented

Consumables:

- `kabuyomi.credits.50`: 50 paid credits, primary small pack.
- `kabuyomi.credits.100`: 100 paid credits, kept supported for existing App Store/app compatibility.

Auto-renewable subscriptions:

- `kabuyomi.sub.lite.monthly`: Lite.
- `kabuyomi.sub.pro.monthly`: Pro.
- `kabuyomi.sub.max.monthly`: Max.

## Subscription plan config

The authoritative backend App Store product catalog lives in `workers/src/lib/billing-catalog.ts`.

Plan credit grants:

- Lite: 400 monthly subscription credits.
- Pro: 900 monthly subscription credits.
- Max: 2000 monthly subscription credits.

The backend keeps the existing internal `pro_max` access-plan name for compatibility while mapping the App Store Max product to the Max subscription product config.

## Consumable changes

The existing iOS purchase completion route supports both public paths:

- `/v1/ios/purchases/credits/complete`
- `/v1/credits/purchase-grant`

`kabuyomi.credits.50` now grants 50 paid credits. `kabuyomi.credits.100` still grants 100 paid credits.

Required safeguards remain in place:

- Apple App Store Server verification is required.
- Server-fetched Apple transaction payload is authoritative.
- `transactionId` is idempotent.
- Duplicate transactions return `already_granted` without double-granting.
- Product ID mismatch is rejected.
- Bundle ID mismatch is rejected.
- sandbox / production / auto fallback behavior is preserved.

## Subscription sync endpoint

Subscription sync is available at:

- `/v1/ios/subscriptions/sync`
- `/v1/billing/sync` as the existing compatibility route

The endpoint requires a device key and an Apple-verifiable active transaction before granting subscription credits. It does not grant credits from client payload alone.

The response includes entitlement status, active subscription metadata, and refreshed usage when sync succeeds.

## Monthly grant behavior

Monthly subscription credits are granted into the existing monthly credit bucket using the Apple-verified subscription period:

- period start: Apple `purchaseDate`
- period end / reset: Apple `expiresDate`
- operation ID: stable hash over `originalTransactionId + productId + periodStart + periodEnd`

Repeated sync for the same subscription period does not double-grant.

Expired or revoked transactions are rejected before grant.

## Upgrade/downgrade behavior

Same-period upgrades grant only the audited delta. Example: Lite to Pro in the same verified period grants 500 additional monthly credits.

Same-period downgrades do not grant new credits. The monthly bucket is capped to the lower plan's allowance while paid credits remain separate and intact.

## Ledger/accounting behavior

The current ledger already supports separated buckets:

- monthly subscription/free allowance
- rewarded ad credits with expiry support
- paid consumable credits with no expiry

Consumption order remains monthly first, then rewarded ad credits, then paid credits. Paid consumable credits are consumed last and are not lost when subscription credits are granted.

For subscription users, the entitlement now binds to the device quota subject instead of a separate plan/original-transaction subject, so paid consumable balances and subscription balances stay on the same quota account.

## Monthly grants audit consistency

The existing D1 migration set already removed the older `monthly_grants(user_id, period_start, period_end)` uniqueness constraint in `0007_monthly_grants_drop_user_period_index.sql`.

The current uniqueness model is:

- `monthly_grants.operation_id` is unique.
- `idx_monthly_grants_user_plan_period` remains unique for user + plan + period.

Because subscription grant operation IDs include original transaction, product ID, and verified period via hash, repeated sync is idempotent while same-period plan changes remain auditable.

No new D1 migration was required for this phase.

## Tests added

Added or updated coverage for:

- product catalog mappings for `kabuyomi.credits.50`, `kabuyomi.credits.100`, Lite, Pro, and Max.
- 50-credit consumable grants.
- duplicate purchase transaction idempotency.
- Apple subscription period extraction.
- expired subscription rejection.
- revoked subscription rejection.
- bundle mismatch rejection.
- Lite / Pro / Max subscription sync grants.
- duplicate same-period subscription sync no double grant.
- paid credits preserved when subscription credits are granted.
- same-period upgrade delta and downgrade behavior.
- D1 monthly grant and credit ledger auditing.

## Commands run

Completed during implementation:

- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm run typecheck`
- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm test -- billing-catalog apple-store-server entitlement credit-quota user-quota index`
- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm test -- index user-quota credit-quota entitlement`
- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm test`
- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm run dryrun:test`
- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm run testbench:validate`
- `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm test -- apple-store-server purchase billing quota subscription`

## Remaining backend risks

- Server-side App Store transaction JWS chain verification remains a future hardening step; the current backend uses App Store Server API fetch as authority and parses the returned signed payload.
- Subscription status is based on the transaction being synced. If richer renewal status is needed later, add App Store Server subscription status/history API integration.
- iOS product config/UI is not part of this phase, so the app will need a later UI/config pass before users can buy these subscriptions in-app.
- Rewarded ad backend existed before this phase; no rewarded ad UI was added here.

## Next phase: iOS subscription UI

Next phase should wire iOS StoreKit product IDs and user-facing subscription UI to:

- purchase Lite / Pro / Max.
- call `/v1/ios/subscriptions/sync`.
- display active plan, renewal/expiration summary, and credit breakdown from `/v1/usage`.
- keep `kabuyomi.credits.50` as the primary small paid-credit pack while preserving `kabuyomi.credits.100` compatibility.
