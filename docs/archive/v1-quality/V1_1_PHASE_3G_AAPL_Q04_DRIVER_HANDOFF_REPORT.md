# Kabuyomi v1.1 Phase 3G AAPL Q04 Driver Handoff Report

Date: 2026-05-06
Branch: `v1.1-worker-quality-token-retrieval`
Scope: AAPL Q04 `driver_durability_followup` handoff only
Test Worker: `kabuyomi-api-test`
Test URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
Test deploy version: `ed7175a5-9266-4a5c-a5ea-8d0f25378e58`

## Conclusion

Phase 3G improves the AAPL Q04 handoff path, but does not make AAPL Q04 stable enough to move on confidently.

The concrete fix is successful at the handoff layer: AAPL Q04 no longer becomes a margin/profitability follow-up because the previous answer mentioned `gross margin` or generic price wording. The rewrite now preserves revenue-driver terms such as `Services`, `product mix`, `foreign exchange`, `demand`, and `tariff`, and runtime intent stays `yoy_change`.

Live results are still variable after the handoff fix. One run produced AAPL-Q04 on the OpenAI path; a second run recovered the driver but still fell back after source gate passed because the selected AAPL source previews remain weak and table/margin-heavy. This should stay test-only.

Recommendation: `KEEP ON TEST ONLY`.

## AAPL-Q04 Diagnosis

Phase 3F AAPL-Q04 showed the core issue:

- AAPL-Q03 answer did mention Apple-like revenue drivers, but in a loose shape: product/services mix, Services, macro, tariff, FX.
- Q04 rewrite extracted `gross margin` and `pricing`.
- That made the runtime intent `margin_profitability`, even though the user asked a revenue-driver durability follow-up.

Diagnosis classification:

- Fixed in this phase: `q04_driver_extractor_misses_aapl_terms`
- Fixed in this phase: Q04 rewrite could drift into margin wording
- Still present: selected AAPL evidence can be table/margin-heavy and not strong period-specific revenue-driver evidence
- Still present: model/finalizer variance after source gate passes

Phase 3G live rows:

- Run `2026-05-06-v1-1-phase-3g-q03-q04`
  - AAPL-Q04: OpenAI
  - rewrite: `前問で挙げた売上高の要因（Services、tariff）は一時的ですか？...`
  - runtime intent: `yoy_change`
- Run `2026-05-06-v1-1-phase-3g-q03-q04-r2`
  - AAPL-Q04: fallback
  - rewrite: same `Services、tariff` handoff
  - source gate: passed
  - low-quality reason: `contextual_reasoning_metric_only`
  - fallback text said segment/product/category detail was still insufficient

This means the handoff is improved, but AAPL source preview quality and low-quality recovery are still not fully solved.

## Implementation Summary

- Updated revenue follow-up context extraction so revenue-anchored Q04 handoff does not treat `gross margin` as a prior revenue driver.
- Restricted generic `価格` extraction for revenue follow-ups; `価格実現` / `price realization` remains recoverable.
- Added AAPL-like revenue handoff signals:
  - `iPhone`
  - `Mac`
  - `iPad`
  - `Wearables`
  - `Services`
  - `product mix`
  - `foreign exchange`
  - `installed base`
  - `product introductions`
  - `demand`
  - `tariff`
- Added an explicit intent rule so revenue-driver durability rewrites remain `yoy_change` unless they are truly margin/profitability questions.
- Added focused tests for AAPL-like handoff, generic revenue movement fallback, intent preservation, and source-gate behavior.

## Tests Run

All required local checks passed:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`
- `npm test -- chat-source-gate`
- `npm test -- hard-intent`
- `npm test -- chat-diagnostics`
- `npm test -- chat-intent-context`
- `npm test -- final-answer-language`
- `npm test -- chat-context`

Focused coverage added:

- AAPL-like Q03 answer with `Services` / product mix / FX / demand is recoverable
- generic AAPL revenue movement without supported driver stays unresolved
- revenue-driver durability rewrite does not become `margin_profitability`
- source gate keeps AAPL-like Q04 as `driver_durability_followup`

## Test Worker Deploy Result

Deployed only to the test Worker.

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Command: `npm run deploy:test`
- Version ID: `ed7175a5-9266-4a5c-a5ea-8d0f25378e58`
- Production deploy: not run

## Benchmark Comparison

Artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3g-q03-q04.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3g-q03-q04-summary.json`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3g-q03-q04-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3g-q03-q04-r2-summary.json`

Command:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3g-q03-q04 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03-q04.jsonl \
npm run testbench:run
```

Run 1:

- Rows: `10`
- Q03 fallback: `3/5`
- Q04 fallback: `2/5`
- AAPL-Q04: OpenAI
- JPM-Q04: OpenAI
- CAT-Q04: OpenAI
- WMT-Q04: fallback because WMT-Q03 did not expose a recoverable driver in that run
- XOM-Q04: correct fallback
- `sourceIdsValid=false`: `0`

Run 2:

- Rows: `10`
- Q03 fallback: `1/5`
- Q04 fallback: `3/5`
- AAPL-Q04: fallback after source gate passed
- JPM-Q04: OpenAI
- CAT-Q04: fallback path with source-backed Japanese repair text
- WMT-Q04: OpenAI
- XOM-Q04: correct fallback
- `sourceIdsValid=false`: `0`

An attempted third run encountered provider/server 503s and aborted before writing artifacts; it is not used for quality comparison.

## Remaining Risks

- AAPL Q04 handoff is improved, but AAPL source evidence is still weak: selected previews can be gross-margin/product-service tables plus product introduction and macro/tariff context rather than clean product or Services revenue-driver paragraphs.
- AAPL Q04 can still fall back after source gate passes because the final answer is judged metric-only or insufficiently driver-specific.
- Benchmark variance is material. Q03 answer shape still affects Q04 handoff for WMT/CAT/AAPL, so one clean subset run is not enough to claim Q04 is solved.
- The Phase 3F language repair can produce safe Japanese text while the benchmark summary still counts raw-English labels from the repaired original answer; inspect user-facing answer text, not only the summary's `rawEnglishSurfaced` count.
- There is an unrelated dirty iOS settings file in the worktree. It was not modified or staged for this phase.

## Recommendation

`KEEP ON TEST ONLY`

Do not start Q06 from this state. The next slice should either improve AAPL source asset quality for Services/product revenue discussion, or add a narrow source-backed low-quality recovery for Q04 cases where source gate passes but the model returns a metric-only/segment-insufficient answer.
