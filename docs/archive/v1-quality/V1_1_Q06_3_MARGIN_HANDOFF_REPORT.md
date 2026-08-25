# Kabuyomi v1.1 Q06-3 Margin Follow-up Handoff Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Test Worker: `kabuyomi-api-test`

Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

Test deploy version: `e614231d-3163-4bac-9d27-73726fa7ae19`

Deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Production deployment: not run.

## Executive Summary

Q06-3 tightened margin follow-up handoff and evidence slot extraction for `margin_durability_followup`.

Main result:

- Q06 improved from 5/5 fallback in Q06-2 to 4/5 fallback in Q06-3.
- JPM-Q06 moved to OpenAI path with source-gate sufficient bank profitability evidence.
- CAT-Q06 no longer passes the source gate on generic industrial/revenue context.
- WMT-Q06 continues to reject revenue/eCommerce context as non-margin evidence.
- XOM-Q06 continues to fail safely because current-period energy margin evidence is still missing.
- `sourceIdsValid=false` remains 0.
- `rawEnglishInAnswer` remains 0.
- `rawEnglishSurfaced` remains 0.
- No malformed user-visible currency was observed.

This pass improves evidence-slot correctness and reduces one false-positive path. It does not try to force Q06 answers where margin durability evidence is still absent.

Recommendation: `READY FOR Q06-4`

## Q06-2 Baseline

Baseline artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-q06-2-q05-q06.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-2-q05-q06-summary.json`

Q06-2 summary:

- Rows: 10
- Response paths: OpenAI 4, fallback 6
- Q05: OpenAI 4/5, fallback 1/5
- Q06: fallback 5/5
- Quality fallback total: 6/10
- Quality hard-intent fallback: 5
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- Infra contaminated: false

Key Q06-2 issues:

- Q06 could not reliably recover concrete margin drivers from Q05.
- JPM bank profitability context was present but not recognized as a margin/profitability slot.
- CAT generic industrial demand / revenue context still had a source-gate pass path.
- WMT comparable-sales/eCommerce context was still too revenue-led.
- XOM selected PP&E/depletion/broad risk context rather than clean current-period energy margin evidence.

## Implementation Summary

Code changes:

- Tightened Q06 follow-up target detection so generic `利益率` plus revenue terms is not enough.
- Added explicit prior-margin-driver term recognition for:
  - margin/cost/expense terms
  - bank provision / noninterest expense / deposit margin compression
  - retail markdown / shrink / inventory / fulfillment cost
  - industrial price-cost / manufacturing cost / volume leverage
  - energy refining / chemical margin / depreciation / depletion
- Added `q06_margin_context_revenue_only` labeling when selected context is revenue/eCommerce/comparable-sales-only.
- Added `q06_margin_context_generic_industrial` labeling for CAT-like generic industrial/business snippets.
- Excluded generic margin context before creating Q06 margin driver categories.
- Added focused source-gate tests for:
  - Q06 gross-margin/cost recovery
  - revenue/eCommerce rejection as margin drivers
  - JPM bank profitability evidence
  - WMT retail margin evidence
  - CAT industrial price-cost/manufacturing cost evidence

No prompt rewrite, model change, production deploy, iOS change, billing change, or source schema migration was made.

## Tests Run

All commands were run from `/Users/0xt4/t4dano/Kabuyomi/workers`.

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
npm test -- chat-source-gate
npm test -- hard-intent
npm test -- chat-diagnostics
npm test -- chat-intent-context
npm test -- chat-context
npm test -- final-answer-language
```

Result: pass.

Full suite result after final changes:

- Test files: 48 passed
- Tests: 571 passed

## Q06-3 Benchmark

Final benchmark command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-q06-3-q05-q06-r2 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q05-q06.jsonl \
npm run testbench:run
```

Final artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-q06-3-q05-q06-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-3-q05-q06-r2-summary.json`

Summary:

- Rows: 10
- Response paths: OpenAI 5, fallback 5
- Q05: OpenAI 4/5, fallback 1/5
- Q06: OpenAI 1/5, fallback 4/5
- Quality fallback total: 5/10
- Quality hard-intent fallback: 4
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishInDiagnostics`: 0
- `rawEnglishSurfaced`: 0
- Infra contaminated: false
- Retry attempted: 1
- Retry wasted: 1
- Latency: p50 4997 ms, p95 9349 ms

Source-family distribution:

```json
{
  "xbrl_metric": 9,
  "margin_discussion": 9,
  "revenue_note": 2,
  "bank_profitability_discussion": 2,
  "energy_margin_discussion": 2,
  "cost_discussion": 3,
  "industrial_margin_discussion": 1,
  "segment_revenue": 1,
  "context_window": 1,
  "mda": 1
}
```

Source-gate failure label distribution:

```json
{
  "missing_margin_driver_evidence": 4,
  "missing_margin_durability_context": 2,
  "margin_durability_evidence_too_generic": 1,
  "q06_margin_context_revenue_only": 3,
  "source_gate_failed": 4,
  "margin_driver_slots_empty": 3,
  "sector_required_source_missing": 3,
  "fallback_slot_incomplete": 3,
  "q06_margin_context_generic_industrial": 1
}
```

Low-quality reason distribution:

```json
{
  "none": 9,
  "contextual_reasoning_metric_only": 1
}
```

## Per-Company Diagnosis and Outcome

### AAPL

Q05:

- Path: OpenAI
- Classification: `q05_margin_source_selected_but_answer_weak`
- Answer still uses iPhone/product/service revenue contribution more than margin-specific cost/profitability evidence.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `missing_margin_driver_evidence`, `missing_margin_durability_context`, `margin_durability_evidence_too_generic`, `q06_margin_context_revenue_only`, `source_gate_failed`
- Classification: `q06_margin_durability_context_missing`, `q06_correct_safe_fallback`
- The new `q06_margin_context_revenue_only` label correctly identifies that selected context remains revenue/product-led.

### JPM

Q05:

- Path: OpenAI
- Classification: `q05_has_recoverable_margin_driver`
- Answer mentions deposit margin compression, lower rates, NII/NIR mix, and profitability pressure.

Q06:

- Path: OpenAI
- Source gate: passed
- Margin driver slot count: 1
- Classification: `q06_margin_driver_slot_recovered`
- The source gate now recognizes bank profitability evidence around deposit margin compression / rate pressure as a margin/profitability driver.
- Human review note: the answer remains cautious and says structural persistence is not proven, but it still includes some NII/NIR framing. This is acceptable for Q06-3, but should be reviewed in a later Q06 human packet if Q06 becomes release-candidate.

### XOM

Q05:

- Path: OpenAI
- Classification: `q05_margin_source_selected_but_answer_weak`
- Answer refers to capital-intensive projects and depreciation-like pressure, but the source preview remains broad PP&E/depletion/risk context.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `missing_margin_durability_context`, `source_gate_failed`, `fallback_slot_incomplete`
- Classification: `q06_correct_safe_fallback`
- Q06-3 correctly does not treat broad PP&E/depletion or risk text as enough.

### CAT

Q05:

- Path: OpenAI
- Classification: `q05_has_recoverable_margin_driver`
- Answer names unfavorable price realization and manufacturing-cost pressure.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `q06_margin_context_revenue_only`, `q06_margin_context_generic_industrial`, `source_gate_failed`, `fallback_slot_incomplete`
- Classification: `q06_source_gate_false_positive_reduced`, `q06_correct_safe_fallback`
- This is the main safety improvement in Q06-3: CAT no longer passes on generic construction/product/business context.

### WMT

Q05:

- Path: fallback
- Classification: `q05_margin_source_selected_but_answer_weak`
- Low-quality reason: `contextual_reasoning_metric_only`
- Selected context still starts with broad MD&A/table-of-contents and metrics.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `q06_margin_context_revenue_only`, `source_gate_failed`, `fallback_slot_incomplete`
- Classification: `q06_revenue_driver_not_margin_driver`, `q06_correct_safe_fallback`
- The new label correctly rejects comparable-sales/eCommerce context as revenue-only rather than margin evidence.

## Critical Failure Check

- Wrong ticker: none observed.
- Wrong period: none observed.
- Material numeric/sign error: none identified in this diagnostic pass.
- Unsupported investment advice: none.
- Buy/sell recommendation: none.
- Price target / stock forecast: none.
- Hallucinated margin driver: none observed in final user-visible answers.
- Overconfident structural/persistent claim: none observed.
- `source_id_invalid`: none; `sourceIdsValid=false` is 0.
- Raw English in final answer: 0.
- Raw English surfaced to user: 0.
- Malformed user-visible currency: none observed.
- Production deploy: not run.

## What Improved

- Q06 evidence slots now distinguish margin/profitability drivers from revenue-only context.
- JPM-Q06 now has one source-backed bank profitability margin slot and reaches OpenAI path.
- CAT-Q06 false-positive source gate path is reduced; it now fails with explicit revenue-only/generic industrial labels.
- WMT-Q06 explicitly reports revenue-only context instead of silently treating eCommerce/comparable sales as margin evidence.
- XOM broad PP&E/depletion context no longer becomes a margin driver slot.

## Remaining Risks

- JPM-Q06 needs human wording review before release-candidate status because the answer still mixes NII/NIR framing with profitability language.
- AAPL still lacks clean product/services gross-margin or operating expense source assets.
- XOM needs current-period energy margin/result assets, especially refining/chemical margin, upstream/downstream earnings, and production-cost discussion.
- WMT needs retail margin source assets: gross margin rate, markdowns, shrink, inventory, fulfillment cost, wage/labor, operating expense leverage.
- CAT Q05 can now expose margin drivers, but Q06 still lacks selected durability context after the stricter gate.

## Next Recommendation

Recommendation: `READY FOR Q06-4`

Suggested Q06-4 focus:

1. Margin source asset expansion for AAPL/WMT/XOM.
2. Q06 source-pack selection so margin durability context is preferred over generic business/revenue snippets.
3. Optional Q06 finalizer/human review only after more source assets are available.
4. A full Minimal Core rerun after Q06 source-asset expansion and one human review packet for Q06 OpenAI rows.

