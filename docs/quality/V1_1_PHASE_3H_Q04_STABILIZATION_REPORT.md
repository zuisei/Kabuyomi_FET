# Kabuyomi v1.1 Phase 3H Q04 Stabilization Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Base commit before this slice: `348e9da Improve AAPL Q04 driver handoff`

## Conclusion

Phase 3H tightened the Q04 `driver_durability_followup` source gate so that table-heavy or metric-only context no longer passes as sufficient durability evidence.

The main safety improvement is visible on AAPL-Q04: in Phase 3G run 2, AAPL passed source gate and then fell to `contextual_reasoning_metric_only`; in Phase 3H both runs fail source gate earlier with explicit labels:

- `q04_table_heavy_context`
- `q04_driver_evidence_too_generic`
- `durability_context_missing`
- `q04_durability_evidence_too_generic`
- `source_gate_failed`

This avoids sending weak gross-margin/product-table context to the model as if it were supported durability evidence.

However, Q04 is not fully stable yet. CAT and WMT still vary after source gate passes: run 1 produced OpenAI answers for CAT/WMT, while run 2 fell back with `low_quality_answer` despite relevant source previews. This looks like post-gate model/finalizer instability, not an AAPL handoff bug.

Recommendation: `NEEDS FOLLOWUP SOURCE REDESIGN`

## Diagnosis Summary

### AAPL-Q04

Phase 3G showed two behaviors:

- Run 1: OpenAI path.
- Run 2: source gate passed, then final answer fell back with `contextual_reasoning_metric_only`.

Phase 3H artifact inspection showed the selected AAPL previews were not strong durability evidence:

- gross margin Products/Services table
- operating expense table
- product introduction paragraph
- repeated Item 2 forward-looking boilerplate
- broad macro/tariff/FX context not tied cleanly to the recovered revenue driver

Classification:

- `source_gate_too_permissive`
- `selected_sources_metric_or_table_heavy`
- `selected_sources_lack_durability_context`
- `model_answer_metric_only`

After Phase 3H, AAPL-Q04 fails before model call in both benchmark runs, which is the desired safe behavior until better AAPL durability source assets are available.

### CAT-Q04

CAT source previews are generally relevant:

- sales and revenues increased
- higher sales volume
- unfavorable/favorable price realization
- expectation of stronger sales
- dealer inventory context

Run 1 remained OpenAI. Run 2 fell back after source gate passed. The fallback answer remained cautious and Japanese, but the path still reports `low_quality_answer` / `source_insufficient`.

Classification:

- `model_answer_metric_only` or finalizer-side post-gate instability in run 2
- not a clear source gate insufficiency
- not a raw-English regression

### WMT-Q04

WMT source previews include relevant retail durability signals:

- comparable sales driven by transactions, average ticket, unit volume
- eCommerce contribution
- continued strength in customer and Walmart+ member engagement
- omnichannel offerings

Run 1 remained OpenAI. Run 2 fell back after source gate passed. Some selected previews still include generic history/strategy snippets, so the source pack is mixed even though strong snippets are present.

Classification:

- `selected_sources_lack_durability_context` for some CTX slots
- post-gate model/finalizer variability
- source pack should prefer the strong comparable-sales/eCommerce/member-engagement snippets over history/strategy snippets

### XOM-Q04

XOM remains a correct fallback. Q03 still lacks a supported current-period energy revenue driver, so Q04 does not have a reliable follow-up target.

Classification:

- `missing_followup_target_driver`
- `correct_safe_fallback`

## Implementation Summary

Changed:

- `workers/src/lib/chat/source-gate.ts`
- `workers/test/chat-source-gate.test.ts`

The Q04 source gate now analyzes `driver_durability_followup` source quality separately from basic driver detection.

New Q04 source-quality checks:

- rejects metric-only context
- flags table-heavy source packs
- rejects gross-margin/product tables as driver durability evidence
- rejects generic macro/forward-looking boilerplate unless tied to revenue/driver terms
- requires at least one strong driver source
- requires at least one specific durability/outlook/risk/continuation signal

New or reinforced labels:

- `q04_metric_only_context`
- `q04_table_heavy_context`
- `q04_driver_evidence_too_generic`
- `durability_context_missing`
- `q04_durability_evidence_too_generic`

Added tests:

- Q04 with recovered driver plus only XBRL/product/gross-margin table context fails.
- Q04 with recovered driver plus generic macro text fails unless source-backed durability evidence exists.

No prompt rewrite, model change, production deploy, billing, iOS, legal, or Q06 work was done.

## Tests Run

Local validation passed before deploy:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
npm test -- chat-source-gate
npm test -- hard-intent
npm test -- chat-diagnostics
npm test -- chat-intent-context
npm test -- final-answer-language
npm test -- chat-context
```

Focused `chat-source-gate` result after changes:

- 38 tests passed.

Full Worker test result:

- 48 files passed.
- 550 tests passed.

## Test Worker Deploy Result

Production was not deployed.

Test deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Resolved deploy script:

```bash
npm run check:test-config && wrangler deploy --config wrangler.test.toml
```

Test Worker:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `d031319a-c3af-401d-9a01-0bd44f3f65e5`

## Benchmark Comparison

Benchmark command shape:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=<run-id> \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03-q04.jsonl \
npm run testbench:run
```

Question subset:

- Q03 revenue driver
- Q04 driver durability follow-up
- AAPL, JPM, XOM, CAT, WMT
- 10 rows per run

Phase 3G baseline artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3g-q03-q04.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3g-q03-q04-r2.jsonl`

Phase 3H artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3h-q03-q04.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3h-q03-q04-summary.json`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3h-q03-q04-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3h-q03-q04-r2-summary.json`

### Summary Metrics

| Run | Rows | OpenAI | Fallback | sourceIdsValid=false | rawEnglishSurfaced |
|---|---:|---:|---:|---:|---:|
| Phase 3G run 1 | 10 | 5 | 5 | 0 | 0 |
| Phase 3G run 2 | 10 | 6 | 4 | 0 | 1 |
| Phase 3H run 1 | 10 | 7 | 3 | 0 | 0 |
| Phase 3H run 2 | 10 | 5 | 5 | 0 | 1 |

### Q04 Outcomes

| Case | Phase 3G run 1 | Phase 3G run 2 | Phase 3H run 1 | Phase 3H run 2 |
|---|---|---|---|---|
| AAPL-Q04 | OpenAI | fallback after gate pass, `contextual_reasoning_metric_only` | fallback before model, table/generic labels | fallback before model, table/generic labels |
| JPM-Q04 | OpenAI | OpenAI | OpenAI | OpenAI |
| XOM-Q04 | correct fallback | correct fallback | correct fallback | correct fallback |
| CAT-Q04 | OpenAI | fallback after gate pass | OpenAI | fallback after gate pass |
| WMT-Q04 | fallback, missing follow-up target | OpenAI | OpenAI | fallback after gate pass |

### Token Notes

Phase 3H run 1 Q04 token counts:

- JPM-Q04: prompt 1871, completion 403, total 2274
- CAT-Q04: prompt 2563, completion 216, total 2779
- WMT-Q04: prompt 2648, completion 304, total 2952

Phase 3H run 2 Q04 token counts:

- JPM-Q04: prompt 1875, completion 276, total 2151
- CAT-Q04: prompt 2566, completion 205, total 2771
- WMT-Q04: prompt 2648, completion 245, total 2893

AAPL-Q04 and XOM-Q04 failed before model, so model token fields are null for those rows.

## Run-to-Run Variability

Phase 3H stabilized AAPL-Q04 specifically:

- Both Phase 3H runs fail source gate before model.
- Both runs use the same explicit source-quality labels.
- No metric-only AAPL model answer is accepted.

But Q04 overall still varies:

- CAT-Q04: OpenAI in run 1, fallback in run 2.
- WMT-Q04: OpenAI in run 1, fallback in run 2.

This suggests the next Q04 work should focus on follow-up source pack quality and/or finalizer behavior for cases where source gate passes with genuinely relevant durability evidence.

## Remaining Risks

- CAT/WMT post-gate instability remains.
- WMT selected source pack still includes generic history/strategy snippets alongside good comparable-sales/eCommerce evidence.
- CAT selected source pack includes one broad financial-subsidiary/competitive context snippet alongside strong sales-volume/price-realization evidence.
- The source gate now correctly blocks AAPL weak packs, but AAPL still needs better durability-specific source assets before it can answer Q04 safely.
- Phase 3H did not address Q06 and did not implement a broader follow-up source redesign.

## Recommendation

`NEEDS FOLLOWUP SOURCE REDESIGN`

Do not move to production. Keep this on the test Worker only.

Before Q06, the next safe Q04 slice should improve follow-up source pack construction so CAT/WMT prefer the strongest durability snippets and AAPL can surface real Services/installed-base/product-cycle durability evidence only when it exists in the filing.
