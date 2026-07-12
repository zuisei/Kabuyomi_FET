# PR-08 Quality Gate Redesign Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion

The gate now evaluates structural validity, deterministic claim alignment, and judge scores separately. Critical numeric/sign/period/unit, source-ID, and investment-advice failures are zero-tolerance; known keywords no longer auto-pass claims, and sector classification prefers filing metadata.

## 2. Audit-claim verification table

| Claim | Result | Evidence |
|---|---|---|
| KBY-P1-01 phrase/ticker heuristic gate | Remediated in code | layered summary and release thresholds |
| Out-of-sample release evidence | Open external gate | no live rotating/Standard/oracle run in this session |

## 3. Implementation summary

Expanded benchmark summaries, explicit critical failures, score thresholds, numeric labels, advice detection, modes, and a reproducible human-review packet generator.

## 4. Files changed

`benchmark-quality.mjs`, benchmark tests, `testbench/modes.json`, `human-review-packet.mjs`, and package scripts.

## 5. Schema and migration changes

None.

## 6. State-machine or data-flow changes

Run rows -> structural checks -> deterministic claim/source checks -> judge scores -> critical/threshold aggregation -> release gate.

## 7. Tests added or updated

Tests cover unseen tickers, unsupported concrete answers, exact mismatch, metadata-based bank classification, advice, and threshold enforcement.

## 8. Commands run and exact results

Quality-gate unit PASS: 25/25. Fixture validation PASS. 15-ticker/150-row full-smoke preflight PASS check-only; no network run or scores were produced.

## 9. Security and privacy review

Human-review tooling operates on controlled artifacts; reports must not contain private conversation content.

## 10. Backward-compatibility review

Historical artifacts remain readable; missing new fields fail conservatively at release-gate time.

## 11. Unresolved risks

Minimal 60, Standard 150, rotating out-of-sample, oracle differential, latency thresholds, and required human review are not complete.

## 12. Rollback or disable procedure

Do not revert to phrase-only gates. If judge infrastructure fails, retain deterministic critical gates and keep release HOLD.

## 13. releaseDecision

`releaseDecision: HOLD`
