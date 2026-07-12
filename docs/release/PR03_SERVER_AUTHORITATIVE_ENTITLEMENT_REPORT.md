# PR-03 Server-Authoritative Entitlement Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion

Entitlement state is now derived from Apple-verified server data. Client `active=false` is read-only, stored access expires on every read, revocation is terminal, and a bounded refresh/grace policy cannot preserve access beyond the verified period.

## 2. Audit-claim verification table

| Claim | Result | Evidence |
|---|---|---|
| KBY-P0-05 client-controlled state | Remediated locally | `billing-sync.ts` ignores client authority; `entitlement-state.ts` owns transitions |
| Expired stored access | Remediated locally | `EntitlementDO` enforces expiry on reads |

## 3. Implementation summary

Added a versioned verified entitlement state, server refresh metadata, terminal revocation, read-time expiry, and a non-mutating compatibility path for the old request shape.

## 4. Files changed

Primary files: `workers/src/lib/entitlement-state.ts`, `workers/src/durable/entitlement.ts`, `workers/src/lib/entitlements.ts`, `workers/src/routes/billing-sync.ts`, and related tests/iOS request models.

## 5. Schema and migration changes

No D1 migration in this phase; Durable Object state upgrades lazily and preserves verified bindings.

## 6. State-machine or data-flow changes

Allowed states are active, expired, and revoked. Reads may move active to expired; stale updates cannot move revoked back to active.

## 7. Tests added or updated

Eight entitlement tests cover matching/mismatched binding, expiry-on-read, five-binding limit, revocation, stale updates, and idempotency. Billing route tests cover inactive client input and verified Apple snapshots.

## 8. Commands run and exact results

Worker full suite PASS: 62 files, 807 tests. Typecheck PASS. iOS PASS: 168 tests.

## 9. Security and privacy review

No client boolean is authoritative. Logs contain hashes/suffixes, not Apple payloads or full identifiers.

## 10. Backward-compatibility review

The old iOS request shape remains accepted for one release but cannot demote or mint entitlement.

## 11. Unresolved risks

Real StoreKit sandbox expiry/renewal behavior still requires the PR-14 external validation run.

## 12. Rollback or disable procedure

Disable billing sync/paid grants through remote config; do not delete Durable Object state. Revert code only before applying dependent phases.

## 13. releaseDecision

`releaseDecision: READY_FOR_NEXT_PHASE`
