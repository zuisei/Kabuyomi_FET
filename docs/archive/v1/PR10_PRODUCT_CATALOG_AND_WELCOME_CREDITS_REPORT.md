# PR-10 Product Catalog and Welcome Credits Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion
Free recurring monthly credits are zero. One verified installation receives one 50-credit welcome bucket, while a shared catalog contract keeps Worker/iOS product IDs and grant quantities aligned and leaves price authority to StoreKit.

## 2. Audit-claim verification table
| Claim | Result | Evidence |
|---|---|---|
| KBY-P1-03 recurring Free grant | Closed locally | one-time welcome marker and zero Free monthly limit |
| KBY-P1-04 Lite truth mismatch | Closed locally | shared catalog and corrected copy |

## 3. Implementation summary
Added welcome state, one-time verified eligibility, rollover preservation, exact reservation/refund allocations, shared JSON catalog, and aligned Lite text.

## 4. Files changed
`user-quota.ts`, remote config, shared catalog, Swift billing/models/UI, legal/current truth, and tests.

## 5. Schema and migration changes
Durable Object credit state upgrades lazily. Legacy Free monthly state becomes welcome state without duplication; no destructive rewrite occurs.

## 6. State-machine or data-flow changes
Verified installation -> welcome once -> expiring monthly/ad lots -> welcome -> purchased; month rollover preserves welcome and grants zero recurring Free credit.

## 7. Tests added or updated
Tests cover one-time welcome, rollover, reservation/release, legacy installation migration, and Worker/Swift catalog contracts.

## 8. Commands run and exact results
Worker full suite PASS: 63 files / 814 tests. iOS full suite PASS: 171/171.

## 9. Security and privacy review
Welcome eligibility is server-verified and logs do not contain raw identity.

## 10. Backward-compatibility review
Existing paid, welcome, subscription, and reward balances are preserved; migration cannot double-grant welcome.

## 11. Unresolved risks
A production balance-distribution dry run remains required.

## 12. Rollback or disable procedure
Disable new welcome grants through remote config. Never subtract previously granted welcome or paid balance.

## 13. releaseDecision
`releaseDecision: HOLD`
