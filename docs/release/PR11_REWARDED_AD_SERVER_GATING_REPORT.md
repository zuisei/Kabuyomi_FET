# PR-11 Rewarded Ad Server Gating Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion
Reward actions preserve the released visible surface when a fresh trusted legacy config enables ads, while explicit capability fields can independently disable rewards. The configured production ad unit plus the verifier's built-in Google public-key URL satisfy SSV readiness. Intent creation and SSV grant both recheck environment, emergency, and daily-cap authority; only a verified SSV callback can grant credit.

## 2. Audit-claim verification table
| Claim | Result | Evidence |
|---|---|---|
| KBY-P1-05 unsafe compile-time visibility | Closed locally | server capability controls Release UI |
| Duplicate/cap bypass | Closed locally | D1/DO idempotency and serialized cap |

## 3. Implementation summary
Added complete capability payloads, iOS decoding, intent environment/ad-unit binding, in-flight kill-switch checks, +2 server grant, three/day cap, and 30-day promotional expiry.

## 4. Files changed
AdMob routes, usage/config/env, Swift API/models/UI, legal/current truth, and tests.

## 5. Schema and migration changes
Uses existing intent/transaction storage; no PR11-specific migration.

## 6. State-machine or data-flow changes
Disabled -> no UI/intent. Enabled -> pending intent -> verified SSV -> atomic grant or duplicate no-op. Emergency/cap checks can terminally refuse.

## 7. Tests added or updated
Tests cover malformed/valid SSV, unit/environment mismatch, duplicate/concurrent callbacks, daily cap, emergency controls, and audit repair.

## 8. Commands run and exact results
Worker full suite PASS: 63 files / 817 tests; iOS full suite PASS: 171/171.

## 9. Security and privacy review
Identifiers are suffix/digest redacted. No client-completion route grants reward credit.

## 10. Backward-compatibility review
Existing reward balances remain spendable. Missing newly introduced fields in a trusted legacy config do not hide the released earning surface; explicit disables or untrusted configuration stop new earning.

## 11. Unresolved risks
Production AdMob console callback and physical Release UI evidence remain open.

## 12. Rollback or disable procedure
Turn off any ads/reward/SSV capability or emergency-disable rewards; UI and server fail closed together.

## 13. releaseDecision
`releaseDecision: HOLD`
