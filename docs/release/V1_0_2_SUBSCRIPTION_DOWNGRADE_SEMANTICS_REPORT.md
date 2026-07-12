# V1.0.2 Subscription Downgrade Semantics Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## conclusion

PR4 is implemented as a Worker-only hardening patch for deterministic, auditable subscription downgrade / expiration semantics.

The chosen policy is no-clawback for same-period downgrades:

- same-period upgrades grant only the positive monthly allowance delta once
- same-period downgrades do not subtract already granted current-period monthly credits
- expired, canceled, revoked, or refunded subscription states do not create new subscription monthly grants
- purchased paid credits are not reduced or expired by subscription changes
- downgrade observations are auditable without changing balances

No source changes were made to iOS, chat answer quality, filing retrieval, model config, StoreKit trust-boundary verification, AdMob verification, reward behavior, or credit pricing.

## files changed

- `workers/src/durable/user-quota.ts`
- `workers/src/lib/quota.ts`
- `workers/test/user-quota.test.ts`
- `workers/test/index.test.ts`
- `docs/release/V1_0_2_SUBSCRIPTION_DOWNGRADE_SEMANTICS_REPORT.md`

## chosen downgrade policy

The patch enforces a no-clawback policy for current subscription periods.

If a user downgrades during an already-granted subscription period, the Worker updates the active plan identity for future entitlement display and future-period behavior, but it does not apply a negative monthly credit delta. Current-period monthly credits remain exactly as already granted and spent.

This avoids silent removal of credits, avoids negative monthly balances, and keeps purchased credits isolated from subscription lifecycle changes.

## same-period upgrade behavior

Same-period upgrades still grant only the positive delta between the previously granted monthly allowance and the new verified active plan allowance.

Verified behavior:

- Lite `400` -> Pro `900`: grants `+500` once
- Pro `900` -> Max `2000`: grants `+1100` once
- duplicate sync for the same period does not double grant
- purchased paid credits remain separate and unchanged

The upgrade grant remains represented as a normal monthly grant operation and is idempotent through the existing Durable Object operation record semantics.

## same-period downgrade behavior

Same-period downgrades no longer apply negative `limitDelta` to the current monthly bucket.

Verified behavior:

- Pro `900` -> Lite `400`: does not subtract credits
- Max `2000` -> Pro `900`: does not subtract credits
- duplicate downgrade sync is idempotent
- monthly remaining never goes negative
- purchased paid credits remain unchanged

The Durable Object records a no-op credit operation for the downgrade observation:

- `type`: `monthly_grant`
- `status`: `noop`
- `delta`: `0`
- `referenceType`: `subscription_downgrade_no_clawback`
- operation ID prefix: `monthly-downgrade-no-clawback`

The current-period monthly limit is kept high enough to reflect the already-granted bucket. The active plan can still move to the lower verified plan, so future subscription periods use the lower plan allowance.

## expiration/revocation behavior

Expired, canceled-not-active, revoked, or refunded subscription states do not create new paid subscription monthly grants.

The route-level billing sync test now verifies that an inactive expiration response does not grant Pro subscription credits. Existing Apple Store Server verification tests continue to verify rejected expired and revoked active transactions.

When a user becomes inactive/free, ordinary free/promotional usage grant behavior may still occur through the existing usage-load path. This is not a subscription grant and does not touch purchased paid credits.

## audit/logging behavior

No migration was added for PR4.

The patch uses the existing `credit_ledger` table for downgrade audit visibility. When a same-period downgrade is observed, `mutateUsage` persists a zero-delta credit ledger entry with:

- `type = monthly_grant`
- `delta = 0`
- `reference_type = subscription_downgrade_no_clawback`
- no balance mutation

The no-clawback operation is also stored in the `USER_QUOTA` Durable Object operation records, so repeated sync remains idempotent.

Production logs use PR1 redaction fields for downgrade observations:

- `quotaSubjectHash`
- `operationIdSuffix`
- numeric credit and balance fields

The tests assert that raw quota subject values and raw subscription transaction identifiers are not emitted in downgrade logs.

## tests added/updated

Updated `workers/test/user-quota.test.ts`:

- same-period Pro -> Lite downgrade keeps monthly credits and records a no-clawback no-op operation
- same-period Max -> Pro downgrade keeps monthly credits and is idempotent
- same-period Pro -> Max upgrade grants exactly `+1100` once

Updated `workers/test/index.test.ts`:

- route-level billing sync test for Pro -> Lite no-clawback behavior with paid credits preserved
- route-level assertion that no-clawback downgrade audit is written to `credit_ledger`
- route-level assertion that downgrade logs use redacted identifiers
- inactive expiration sync does not grant paid subscription monthly credits

Existing StoreKit, quota, credit audit repair, AdMob, and route tests still pass.

## commands run

From `workers/`:

```bash
npm run typecheck
npm test -- user-quota
npm test -- index
npm test -- entitlement
npm test -- apple-store-server
npm test -- credit-quota
npm test -- credit-audit-repair
npm test -- admob-rewards
npm test
npm run dryrun:test
```

From repo root:

```bash
git diff --check
rg "downgrade|upgrade|monthlyRemaining|monthly_grant|monthly-grant|originalTransactionId|webOrderLineItemId|transactionId|operationId|quotaSubject" workers/src workers/test workers/d1
```

Validation result:

- typecheck passed
- focused tests passed
- full test suite passed: `50` test files, `626` tests
- dry-run passed
- `git diff --check` passed
- final identifier/logging search completed and was reviewed; remaining matches are expected storage, request parsing, API response, idempotency, redacted logging, or test fixture usage

## failed commands

None.

## migration added, if any

No PR4 migration was added.

Important deploy prerequisite: PR3 introduced `workers/d1/migrations/0009_credit_audit_repair_queue.sql`, and that migration is still pending for production/test D1 according to the PR3 context. It must be applied before deploying PR3/PR4 behavior together.

## remaining risks

- No production deploy or TestFlight smoke was performed in this PR.
- PR3 D1 migration `0009_credit_audit_repair_queue.sql` remains a deploy prerequisite before enabling the repair queue behavior in production.
- The no-clawback policy intentionally allows usage to show a lower active plan while the current-period monthly bucket remains at the previously granted higher amount until the next subscription period. This is deterministic and auditable, but should be checked against final in-app wording before subscription UI ships.
- Downgrade no-clawback uses the existing `credit_ledger` table rather than a new dedicated downgrade table. This is intentionally minimal for v1.0.2.

## deploy/migration recommendation

Do not deploy this patch alone without the pending PR3 migration plan.

Recommended next step:

1. apply pending D1 migrations to test
2. run test D1/Worker smoke for credit audit repair and subscription downgrade semantics
3. apply pending D1 migrations to production
4. deploy Worker
5. run final production monetization smoke covering purchase, subscription sync, AdMob rewards, usage, and chat credit safety

## releaseDecision

releaseDecision: HOLD - FINAL HARDENING DEPLOY/MIGRATION SMOKE REQUIRED
