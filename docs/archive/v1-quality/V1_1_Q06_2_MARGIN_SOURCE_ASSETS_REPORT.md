# Kabuyomi v1.1 Q06-2 Margin Source Assets Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Test Worker: `kabuyomi-api-test`

Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

Test deploy version: `fd658e48-a8a2-40a5-adfe-50f12a73c484`

Deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Production deployment: not run.

## Executive Summary

Q06-2 implemented the first margin/cost/profitability source-family slice and changed Q05 `margin_driver` routing so margin questions can use the model path when a configured model is available.

The intended first effect is visible:

- Q05 changed from deterministic metric-only in Q06-1 r4 to OpenAI path for 4/5 tickers in Q06-2.
- Selected source families now include margin/cost/profitability families when available:
  - `margin_discussion`
  - `cost_discussion`
  - `bank_profitability_discussion`
  - `energy_margin_discussion`
  - `industrial_margin_discussion`
- Q06 remains a safe fallback for 5/5 rows.
- `sourceIdsValid=false` remains 0.
- `rawEnglishInAnswer` remains 0.
- `rawEnglishSurfaced` remains 0.
- No malformed user-visible currency was found in the new run.

This pass improves Q05 source availability and reduces metric-only deterministic answers, but it does not yet make Q06 answerable. The next slice should focus on Q06-3 handoff/source-slot extraction and stricter handling of CAT's remaining post-gate false-positive path.

Recommendation: `READY FOR Q06-3`

## Q06-1 Baseline

Baseline artifact:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06-r4.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06-r4-summary.json`

Summary:

- Rows: 10
- Q05/Q06 response paths: fallback 6, deterministic 4
- Q06 fallback: 5/5
- Quality fallback total: 6/10
- Quality hard-intent fallback: 5
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- Infra contaminated: false
- Latency: p50 1847 ms, p95 8300 ms

Baseline diagnosis:

- Q05 generally returned deterministic metric-only margin snapshots.
- Q06 lacked a recoverable concrete Q05 margin driver.
- Selected Q06 context often contained XBRL metrics, table-heavy snippets, broad business text, or revenue-driver context instead of cost/margin/profitability evidence.

## Implementation Summary

Code changes:

- Added derived margin/cost/profitability source families in `workers/src/lib/chat/source-family.ts`.
- Added sector-specific derived margin families:
  - `bank_profitability_discussion`
  - `energy_margin_discussion`
  - `retail_margin_discussion`
  - `industrial_margin_discussion`
- Changed Q05 margin context packing so `margin_profitability` no longer leads with metrics before narrative.
- Allowed model-first routing for deterministic `margin_snapshot` when a chat model is configured.
- Added a margin-specific off-intent risk filter so generic risk snippets do not outrank specific margin result discussion.
- Updated tests for source-family derivation, Q05 source-pack ordering, and route policy.

No D1 schema migration was added. Existing `md_a` / `xbrl_metric` records remain readable.

## Tests Run

All commands were run from `/Users/0xt4/t4dano/Kabuyomi/workers`.

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
npm test -- filing-source-assets
npm test -- chat-intent-context
npm test -- chat-route-policy
npm test -- chat-source-gate
npm test -- hard-intent
npm test -- chat-diagnostics
npm test -- chat-context
npm test -- final-answer-language
```

Result: pass.

## Q06-2 Benchmark

Benchmark command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-q06-2-q05-q06 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q05-q06.jsonl \
npm run testbench:run
```

Artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-q06-2-q05-q06.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-2-q05-q06-summary.json`

Summary:

- Rows: 10
- Response paths: OpenAI 4, fallback 6
- Q05: OpenAI 4/5, fallback 1/5
- Q06: fallback 5/5
- Quality fallback total: 6/10
- Quality hard-intent fallback: 5
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishInDiagnostics`: 2
- `rawEnglishSurfaced`: 0
- Infra contaminated: false
- Retry attempted: 1
- Retry wasted: 1
- Latency: p50 3970 ms, p95 8370 ms

Source-family distribution across selected sources:

```json
{
  "xbrl_metric": 10,
  "margin_discussion": 10,
  "revenue_note": 2,
  "bank_profitability_discussion": 2,
  "energy_margin_discussion": 2,
  "cost_discussion": 4,
  "industrial_margin_discussion": 2
}
```

Source-gate failure label distribution:

```json
{
  "missing_margin_driver_evidence": 4,
  "missing_margin_durability_context": 2,
  "margin_durability_evidence_too_generic": 1,
  "source_gate_failed": 4,
  "margin_driver_slots_empty": 2,
  "sector_required_source_missing": 2,
  "fallback_slot_incomplete": 2,
  "margin_context_table_heavy": 1
}
```

Low-quality reason distribution:

```json
{
  "none": 9,
  "contextual_reasoning_metric_only": 1
}
```

## Per-Company Diagnosis

### AAPL

Q05:

- Path: OpenAI
- Selected families: `xbrl_metric`, `margin_discussion`, `revenue_note`
- Improvement: no longer deterministic metric-only.
- Remaining issue: answer still leans on revenue/category growth and cost optimization; margin-specific driver extraction is not strong enough.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `missing_margin_driver_evidence`, `missing_margin_durability_context`, `margin_durability_evidence_too_generic`, `source_gate_failed`
- Diagnosis: Q06 correctly refuses to classify temporary vs structural because Q05/Q06 still lack a concrete margin driver and durability context.

### JPM

Q05:

- Path: OpenAI
- Selected families: `bank_profitability_discussion`, `xbrl_metric`, `margin_discussion`
- Improvement: bank profitability family is now present.
- Remaining issue: answer still mixes NII/NIR revenue structure with profitability; it mentions deposit margin compression and rate pressure but does not expose a clean margin/profitability driver for Q06.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `source_gate_failed`, `fallback_slot_incomplete`
- Diagnosis: bank margin/provision/noninterest expense evidence is still not being converted into margin driver slots. This is a Q06-3 handoff/source-slot issue.

### XOM

Q05:

- Path: OpenAI
- Selected families: `energy_margin_discussion`, `xbrl_metric`, `margin_discussion`
- Improvement: energy margin family appears in selected sources.
- Remaining issue: selected source preview still starts with upstream PP&E/depletion context and does not cleanly explain current-period margin movement.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `margin_context_table_heavy`, `missing_margin_driver_evidence`, `missing_margin_durability_context`, `source_gate_failed`
- Diagnosis: correct safe fallback. Energy current-period margin/result evidence still needs stronger extraction before Q06 can answer.

### CAT

Q05:

- Path: fallback
- Selected families: `cost_discussion`, `industrial_margin_discussion`, `xbrl_metric`, `margin_discussion`
- Low-quality reason: `contextual_reasoning_metric_only`
- Improvement: industrial/cost families are now present.
- Remaining issue: model/finalizer still treats the answer as too metric-only.

Q06:

- Path: fallback
- Source gate: passed
- Finalizer labels: language fallback labels
- Diagnosis: this remains a source-gate false-positive path. The selected snippets include industrial sales/price context and generic construction demand, but not enough margin durability evidence. Q06-3 should tighten slot extraction or gate quality here.

### WMT

Q05:

- Path: OpenAI
- Selected families: `cost_discussion`, `xbrl_metric`, `margin_discussion`
- Improvement: no longer deterministic metric-only.
- Remaining issue: answer still uses comparable-sales/eCommerce revenue context more than gross-margin, markdown, shrink, inventory, wage, fulfillment, or operating expense evidence.

Q06:

- Path: fallback
- Source gate: failed
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `source_gate_failed`, `fallback_slot_incomplete`
- Diagnosis: correct safe fallback. Retail margin-specific source extraction needs expansion beyond revenue/eCommerce context.

## Critical Failure Check

- Wrong ticker: none observed.
- Wrong period: none observed.
- Material numeric/sign error: none identified in this diagnostic pass.
- Unsupported investment advice: none.
- Buy/sell recommendation: none.
- Price target / stock forecast: none.
- Hallucinated structural margin claim: none.
- `source_id_invalid`: none; `sourceIdsValid=false` is 0.
- Raw English in final answer: 0.
- Raw English surfaced to user: 0.
- Malformed user-visible currency: none observed.
- Production deploy: not run.

## What Improved

- Q05 source pack now exposes margin/cost/profitability families instead of relying on XBRL-only deterministic snapshots.
- Q05 OpenAI path is now exercised for AAPL/JPM/XOM/WMT.
- Q06 continues to fail safely rather than forcing unsupported temporary/structural conclusions.
- Diagnostics now show a clearer split:
  - Q05 source family coverage improved.
  - Q06 still needs driver-slot and durability-context work.

## Remaining Risks

- Derived family classification is useful but still coarse. Some selected sources are labeled as margin-related because they contain margin/cost terms, while the preview may still be broad, table-heavy, or revenue-led.
- Q05 answer shape is model-dependent. It improved route/path behavior but does not guarantee a clean, recoverable margin driver for every ticker.
- CAT-Q06 still has a source-gate pass followed by finalizer fallback. This should be treated as a Q06-3 stabilization target.
- JPM and WMT need more precise conversion of bank/retail profitability evidence into margin driver slots.
- XOM needs stronger current-period energy margin/result assets; PP&E/depletion context is not enough.

## Next Recommendation

Recommendation: `READY FOR Q06-3`

Suggested Q06-3 focus:

1. Margin follow-up handoff and driver-slot extraction from Q05 answers.
2. Bank margin/provision/noninterest expense slot recognition for JPM.
3. Retail gross-margin/markdown/shrink/inventory/expense source expansion for WMT.
4. Industrial source-gate tightening for CAT to prevent generic sales/price context from passing margin durability gate.
5. Energy current-period margin/result extraction for XOM.

