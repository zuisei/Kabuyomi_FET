# PR-06 Anonymous Identity and App Attest Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion
Arbitrary device-key rotation cannot create a trusted free principal when identity enforcement is configured. The Worker issues signed installation credentials, rate-limits bootstrap, migrates legacy quota exactly once, and verifies App Attest challenges/assertions bound to request content. External verifier and physical-device evidence remain open.

## 2. Audit-claim verification table
| Claim | Result | Evidence |
|---|---|---|
| KBY-P0-06 arbitrary free identity | Closed locally | signed D1-backed installation credential |
| Existing-user state preservation | Closed locally | `0015` legacy-to-installation migration and tombstone |
| Attestation replay/body mismatch | Closed locally | atomic challenge claim and request binding |

## 3. Implementation summary
Added Keychain credential storage, server token MAC, three-per-hour network bootstrap limit, App Attest key/challenge flow, fail-closed unsupported policy, sensitive-route assertions, deterministic legacy migration, and telemetry without raw identity material.

## 4. Files changed
Primary files are `installation-identity.ts`, its routes/migrations/tests, quota identity resolution, `DeviceIdentityStore.swift`, `APIClient.swift`, and iOS tests.

## 5. Schema and migration changes
`0012_installation_identity.sql` adds identities, rate-limit counters, and challenges. `0015_installation_principal_migration.sql` adds one-time migration audit/conflict state. Only keyed legacy/network digests are stored.

## 6. State-machine or data-flow changes
Bootstrap -> D1 identity -> export legacy quota -> deterministic apply/no-source -> tombstone -> pending credential -> one-time attestation -> replacement full-credit credential -> content-bound assertions.

## 7. Tests added or updated
Tests cover arbitrary-key rejection, idempotent bootstrap, mass-bootstrap limiting, legacy state transfer once without duplicate welcome/purchased balance, attestation replay, and path/body mismatch. Release-binary inspection confirms the test assertion seam is absent.

## 8. Commands run and exact results
Focused installation/account tests PASS: 10/10. Worker full suite PASS: 63 files / 814 tests. iOS full suite PASS: 171/171. Unsigned Release build PASS.

## 9. Security and privacy review
Raw device keys, IPs, App Attest keys/objects/assertions, installation tokens, and signatures are neither persisted in audit tables nor logged. Release code has no assertion bypass.

## 10. Backward-compatibility review
The legacy key is accepted only as signed-bootstrap migration evidence. Existing quota—including purchased balance and welcome state—is copied once; the source is then mutation-tombstoned, preventing duplicate welcome grants.

## 11. Unresolved risks
Production must configure independent token/network secrets and an App Attest verification service. Shared-network false-positive and reinstall tests require physical devices.

## 12. Rollback or disable procedure
Disable welcome grants/sensitive capabilities through fail-closed configuration. Preserve identities and migration markers; never fall back to arbitrary key trust or delete balances.

## 13. releaseDecision
`releaseDecision: HOLD`
