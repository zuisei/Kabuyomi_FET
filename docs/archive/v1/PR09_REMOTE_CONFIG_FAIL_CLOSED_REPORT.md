# PR-09 Remote Config Fail-Closed Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion
Production config failure cannot silently enable chat, ads, rewards, purchases, welcome grants, or paid grants. Fresh complete KV is persisted as bounded D1 last-known-good; absent, partial, malformed, or stale trust selects a safe-disabled config; emergency disables always win. Deployed configs must explicitly provide every required typed capability field.

## 2. Audit-claim verification table
| Claim | Result | Evidence |
|---|---|---|
| KBY-P1-02 enabled outage fallback | Closed locally | safe production default and bounded LKG |
| Emergency override bypass | Closed locally | post-selection environment disables |

## 3. Implementation summary
Added config version/source/age metadata, production detection, D1 LKG, safe defaults, complete reward/purchase/account capabilities, a 45-day maximum trust age, 14/35-day lifecycle alerts, and an explicit human hash-approved refresh tool.

## 4. Files changed
`remote-config.ts`, env/wrangler settings, migration `0013`, capability consumers, and tests.

## 5. Schema and migration changes
`0013_remote_config_lkg.sql` is additive. No remote migration was run.

## 6. State-machine or data-flow changes
Fresh complete KV -> persist/use; otherwise bounded complete LKG -> use; otherwise production safe-disabled. KV and LKG retain the human-authored timestamp; storage never renews trust. Emergency disables post-process all sources.

## 7. Tests added or updated
Tests cover missing, partial, corrupt, stale and fresh configuration, LKG, emergency controls, explicit capability disables, 14-day warning, 35-day critical alert, 45-day expiry, authored-timestamp preservation, operator-script hash mismatch refusal, normalization, cache TTL, and normal operation.

## 8. Commands run and exact results
Current final Worker rerun PASS: 68 files / 897 tests; typecheck PASS.

## 9. Security and privacy review
LKG contains only capability configuration, not secrets or personal data. Failure logs are metadata-only.

## 10. Backward-compatibility review
Local non-production defaults remain usable; production outage behavior intentionally becomes safe-disabled. Existing implementations and balances remain intact, while new actions require a complete explicit trusted capability payload. No deployed legacy-field inference is accepted.

## 11. Unresolved risks
Remote D1 application, an actual KV/D1 outage drill, daily alert configuration, and the first human-reviewed test/production refresh are not complete.

## 12. Rollback or disable procedure
Use maintenance/emergency disables and preserve the LKG record. Never restore an enabled production fallback.

## 13. releaseDecision
`releaseDecision: HOLD`
