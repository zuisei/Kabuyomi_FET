# PR-07 Verified Financial Facts and Numeric Alignment Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion

Material numeric claims now pass through typed verified facts and a semantic alignment validator before display. Unsupported magnitude, unit/currency, sign, percentage, period, and current/prior claims are repaired from deterministic facts or blocked.

## 2. Audit-claim verification table

| Claim | Result | Evidence |
|---|---|---|
| KBY-P0-01 missing reconciliation | Remediated locally | `verified-financial-facts.ts` plus `numeric-alignment.ts` |
| r54 AAPL magnitude defect | Regression-covered | 143,756,000,000 USD maps to approved Japanese display, not `143.8億` |

## 3. Implementation summary

Added typed fact IDs, semantic labels, canonical values/units, period and role metadata, deterministic display aliases, material-claim extraction, and response-path diagnostics.

## 4. Files changed

Primary files: `verified-financial-facts.ts`, `financial-number-format.ts`, `material-numeric-claims.ts`, `numeric-alignment.ts`, chat context/grounding/finalizer/usecase code, prompts, metrics, and tests.

## 5. Schema and migration changes

No persistent schema migration; typed facts are derived from filing/XBRL records.

## 6. State-machine or data-flow changes

Selected source facts -> canonical fact pack -> model/deterministic answer -> claim extraction -> semantic match -> pass, repair, or block -> diagnostics.

## 7. Tests added or updated

Numeric matrix covers magnitude, rounding, floating tolerance, unanchored market percentages, unit mismatch, current/prior semantics, and AAPL-Q05 regression.

## 8. Commands run and exact results

Worker full PASS after consolidation: 814/814. Numeric alignment PASS: 5/5. Quality-gate unit PASS: 25/25.

## 9. Security and privacy review

Diagnostics contain fact/source IDs and labels, not raw questions or source excerpts.

## 10. Backward-compatibility review

Existing response schemas remain; unsafe answer text may now be conservatively repaired or blocked.

## 11. Unresolved risks

Live unseen-sector and oracle-context evaluations remain part of PR-14 and were not replaced by unit tests.

## 12. Rollback or disable procedure

If false positives occur, route to deterministic factual fallback; do not bypass numeric validation for remote answers.

## 13. releaseDecision

`releaseDecision: READY_FOR_NEXT_PHASE`
