# PR-04 Subscription Principal Migration Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion
Apple-verified original transactions now resolve to one versioned HMAC quota principal. Device bindings cannot mint a fresh paid balance, period grants are stable, and migration is previewable, evidence-checked, idempotent, conflict-aware, and tombstones the source. External two-device validation remains open.

## 2. Audit-claim verification table
| Claim | Result | Evidence |
|---|---|---|
| KBY-P0-04 device-derived ownership | Closed locally | stable principal derivation and entitlement lookup |
| Duplicate device-period grant | Closed locally | stable principal and period operation ID |
| Blind balance merge | Closed locally | occupied-target and evidence conflicts fail closed |

## 3. Implementation summary
Added HMAC principal derivation, verified device-binding limits, internal preview/apply migration, exact state copy, purchase-evidence checks, and source tombstones.

## 4. Files changed
Primary files are `subscription-principal.ts`, `internal-subscription-principal-migration.ts`, `entitlements.ts`, `user-quota.ts`, billing routes, migration `0010`, and tests.

## 5. Schema and migration changes
`0010_subscription_authority.sql` adds authority, binding, notification, and migration audit records. No remote application occurred.

## 6. State-machine or data-flow changes
Verified transaction -> stable principal -> preview -> validated apply -> target marker -> source tombstone. Conflicts are retained for manual review.

## 7. Tests added or updated
Tests cover stable A/B derivation, concurrent grants, preview without mutation, idempotent apply, occupied-target conflict, purchased-credit preservation, and tombstone rejection.

## 8. Commands run and exact results
Worker full suite PASS: 63 files / 814 tests after the consolidated remediation rerun. Migration validator PASS: 15 ordered migrations.

## 9. Security and privacy review
Derivation uses a server secret; logs and admin responses use digests/counts, not raw transaction principals.

## 10. Backward-compatibility review
Legacy state is copied exactly once and remains readable for state inspection, while post-migration mutations are rejected. Balances are never blindly summed.

## 11. Unresolved risks
No test/production D1 migration or physical device A/B StoreKit exercise was run.

## 12. Rollback or disable procedure
Disable billing grants and migration execution; retain additive tables and audit markers. Never subtract or reverse balances destructively.

## 13. releaseDecision
`releaseDecision: HOLD`
