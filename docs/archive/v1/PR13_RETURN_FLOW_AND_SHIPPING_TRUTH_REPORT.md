# PR-13 Return Flow and Shipping Truth Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion

The company drawer now renders Recent and opens the selected ticker. Dead inline-search inputs and callbacks were removed; search remains the dedicated Search surface. Current shipping truth, README reset behavior, legal copy, and App Review notes are aligned with the safe product state.

## 2. Audit-claim verification table

| Claim | Result | Evidence |
|---|---|---|
| KBY-P2-01 dead Recent/search | Remediated locally | visible Recent plus removed dead search state |
| KBY-P2-02 reset contradiction | Remediated | README matches preserved identity |
| KBY-P2-03 truth conflicts | Remediated for current docs | `CURRENT_SHIPPING_TRUTH.md` authoritative; old release truth marked historical |

## 3. Implementation summary

Added Recent rows and selection/filling behavior, removed drawer search plumbing, and rewrote current release/app-review/legal truth around welcome credits, hidden ads, and hidden consumables.

## 4. Files changed

`CompanyLibraryDrawer.swift`, `CompanyView.swift`, README, current/release truth, App Store notes, and legal pages.

## 5. Schema and migration changes

None.

## 6. State-machine or data-flow changes

Recent ticker selection reuses the normal company/conversation open flow. Dedicated Search remains the only search flow.

## 7. Tests added or updated

iOS full tests cover Recent persistence/opening behavior indirectly through AppModel recent/watchlist/conversation tests. Legal validation checks current pages.

## 8. Commands run and exact results

iOS PASS after consolidation: 171/171; unsigned Release build PASS; legal validation PASS.

## 9. Security and privacy review

Recent state remains local; documents do not disclose private identifiers or unsupported production claims.

## 10. Backward-compatibility review

Saved/current/older filing navigation is unchanged; removed inputs were not rendered.

## 11. Unresolved risks

Manual Release-screen verification of Recent/search return flow is still required in PR-14.

## 12. Rollback or disable procedure

Revert the drawer section as one UI unit; keep current shipping truth authoritative and do not restore stale claims.

## 13. releaseDecision

`releaseDecision: HOLD — PR-14 full gate required.`
