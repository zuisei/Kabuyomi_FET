# Kabuyomi v1.1 Q06-4 Margin Source Pack Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Base commit: `97e1c51 Improve Q06 margin handoff slots`

Test Worker: `kabuyomi-api-test`

Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

Test deploy version: `bf3f8fa3-7fef-4848-895c-2fba53ea9366`

Deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Production deployment: not run.

## Executive Summary

Q06-4 expanded margin/cost/profitability source assets and tightened Q06 targeted source selection for `margin_durability_followup`.

Main result:

- Q06 improved from Q06-3 fallback 4/5 to Q06-4 fallback 3/5.
- JPM-Q06 stayed on the OpenAI path.
- CAT-Q06 moved to the OpenAI path, using industrial cost / price-realization context.
- AAPL, XOM, and WMT remain safe fallbacks where selected evidence is still not enough for a durable/structural margin conclusion.
- `sourceIdsValid=false` remains 0.
- `rawEnglishInAnswer` remains 0.
- `rawEnglishSurfaced` remains 0.
- No malformed user-visible currency was observed.

This pass improves source availability and retrieval preference. It does not implement Q06 finalizer repair and does not force answers when durability evidence is missing.

Recommendation: `READY FOR Q06 HUMAN REVIEW`

## Q06-3 Baseline

Baseline artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-q06-3-q05-q06-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-3-q05-q06-r2-summary.json`

Q06-3 summary:

- Rows: 10
- Q05: OpenAI 4/5, fallback 1/5
- Q06: OpenAI 1/5, fallback 4/5
- Quality fallback total: 5/10
- Quality hard-intent fallback: 4
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- Infra contaminated: false

Known Q06-3 findings:

- AAPL lacked clean product/services gross-margin or operating-expense source assets.
- XOM selected PP&E/depletion/risk context rather than current-period energy margin/result assets.
- WMT selected comparable-sales/eCommerce context rather than retail margin evidence.
- CAT Q05 exposed some margin drivers, but Q06 still lacked stable selected durability context.
- JPM-Q06 was improved and needed no regression.

## Diagnosis Before Implementation

### AAPL

Q05:

- Path: OpenAI.
- Selected families: `margin_discussion`, `xbrl_metric`, `revenue_note`.
- The Q05 answer exposed iPhone/Services and generic profitability context, but not a clean source-backed gross-margin or operating-expense driver.
- Classification: `margin_source_asset_missing`, `q05_margin_source_selected_but_answer_weak`.

Q06:

- Path: fallback.
- Selected context was tariff / FX / gross-margin hedging text plus metrics.
- Source gate labels included `missing_margin_driver_evidence` and `missing_margin_durability_context`.
- Classification: `margin_durability_context_missing`, `q06_correct_safe_fallback`.

### JPM

Q05:

- Path: OpenAI.
- Selected families: `margin_discussion`, `bank_profitability_discussion`, `xbrl_metric`.
- The answer exposed bank profitability drivers around NII, deposit margin compression, noninterest expense, and compensation expense.
- Classification: `q05_has_recoverable_margin_driver`.

Q06:

- Path: OpenAI.
- Source gate passed with bank profitability evidence.
- Classification: `q06_ready_for_human_review`.

### XOM

Q05:

- Path: OpenAI.
- Selected families: `energy_margin_discussion`, `xbrl_metric`, `margin_discussion`.
- The selected preview was still PP&E/depletion and risk/project context rather than current-period refining/chemical margin or upstream/downstream earnings context.
- Classification: `margin_source_selected_but_too_generic`.

Q06:

- Path: fallback.
- Source gate labels included `missing_margin_driver_evidence` and `missing_margin_durability_context`.
- Classification: `margin_source_asset_missing`, `q06_correct_safe_fallback`.

### CAT

Q05:

- Path: fallback in Q06-3, but selected families already included `cost_discussion` and `industrial_margin_discussion`.
- The source previews showed revenue and industrial context, but not enough stable Q06 durability context.
- Classification: `margin_source_present_but_not_selected`, `margin_durability_context_missing`.

Q06:

- Path: fallback in Q06-3.
- CAT no longer passed the gate on purely generic industrial/revenue context.
- Classification: `q06_correct_safe_fallback` before Q06-4.

### WMT

Q05:

- Path: fallback.
- Selected sources were table-of-contents / business description / revenue metrics / generic omnichannel text.
- Classification: `margin_source_asset_missing`, `q05_metric_only_margin_answer`.

Q06:

- Path: fallback.
- Selected comparable-sales/eCommerce context was correctly rejected as revenue-only.
- Classification: `q06_source_pack_wrong_family`, `q06_correct_safe_fallback`.

## Implementation Summary

Code changes:

- Added margin/cost/profitability source asset extraction in `buildSourceChunks`.
- Added bounded synthetic section title: `Margin and profitability discussion`.
- Added strong margin-source detection for current-period, non-table, non-generic margin/cost/profitability paragraphs.
- Added test-environment-only margin source backfill for cached full-content filings.
- Kept production untouched: margin backfill is called only when `KABUYOMI_ENV` / `ENVIRONMENT` is `test`.
- Added Q06 targeted retrieval scoring for margin durability:
  - boosts margin/cost/profitability evidence,
  - boosts durability/temporary/uncertainty language,
  - boosts sector-specific AAPL/XOM/WMT/CAT/JPM margin signals,
  - downranks revenue-only and table-only context.
- Adjusted source-family priority so CAT-like `dealer inventory` industrial text is not misclassified as retail inventory.

No prompt rewrite, model change, production deploy, iOS change, billing change, or finalizer repair was made.

## Tests Run

All commands were run from `/Users/0xt4/t4dano/Kabuyomi/workers`.

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
npm test -- filing-source-assets
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
- Tests: 577 passed

## Q06-4 Benchmark

Command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-q06-4-q05-q06 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q05-q06.jsonl \
npm run testbench:run
```

Artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-q06-4-q05-q06.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-4-q05-q06-summary.json`

Summary:

- Rows: 10
- Q05: OpenAI 3/5, fallback 2/5
- Q06: OpenAI 2/5, fallback 3/5
- Quality fallback total: 5/10
- Quality hard-intent fallback: 3
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishInDiagnostics`: 0
- `rawEnglishSurfaced`: 0
- Infra contaminated: false
- Retry attempted: 3
- Retry wasted: 2
- Latency p50: 5037 ms
- Latency p95: 17701 ms

Source-family distribution:

```json
{
  "margin_discussion": 10,
  "xbrl_metric": 10,
  "revenue_note": 1,
  "bank_profitability_discussion": 2,
  "energy_margin_discussion": 2,
  "cost_discussion": 3,
  "industrial_margin_discussion": 2,
  "mda": 1
}
```

Q06 source-gate failure label distribution:

```json
{
  "margin_driver_slots_empty": 3,
  "sector_required_source_missing": 3,
  "missing_margin_driver_evidence": 3,
  "source_gate_failed": 3,
  "fallback_slot_incomplete": 3,
  "missing_margin_durability_context": 1,
  "q06_margin_context_revenue_only": 1
}
```

Low-quality reason distribution:

```json
{
  "none": 8,
  "contextual_reasoning_metric_only": 2
}
```

## Per-Company Outcome

### AAPL

Q05:

- Path: OpenAI.
- Source families include `margin_discussion`.
- Selected previews improved toward gross-margin / tariff / FX context, but do not expose a concrete Products/Services gross-margin driver strongly enough.

Q06:

- Path: fallback.
- Source gate failed.
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `source_gate_failed`, `fallback_slot_incomplete`.
- Verdict: safe fallback. More AAPL-specific product/services gross-margin extraction is still needed before answering.

### JPM

Q05:

- Path: OpenAI.
- Source families: `margin_discussion`, `bank_profitability_discussion`, `xbrl_metric`.
- Driver context includes NII, deposit margin compression, noninterest expense, and compensation expense.

Q06:

- Path: OpenAI.
- Source gate passed.
- Verdict: no regression; ready for human review.

### XOM

Q05:

- Path: OpenAI.
- Source families include `energy_margin_discussion`, but preview quality remains broad PP&E/depletion/risk/project context.

Q06:

- Path: fallback.
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `missing_margin_durability_context`, `source_gate_failed`, `fallback_slot_incomplete`.
- Verdict: correct safe fallback. More current-period refining / chemical margin / upstream-downstream earnings extraction is needed.

### CAT

Q05:

- Path: fallback.
- Source families include `cost_discussion`, `industrial_margin_discussion`, `margin_discussion`.
- Low-quality reason: `contextual_reasoning_metric_only`.

Q06:

- Path: OpenAI.
- Source gate passed.
- Selected evidence includes sales volume / price realization plus profitability/cost context.
- Verdict: improved, but needs human review because the answer still includes some revenue-driver language and English financial terms such as `price realization` and `cost`.

### WMT

Q05:

- Path: fallback.
- Selected sources still include business description / TOC / omnichannel and revenue metrics.
- Low-quality reason: `contextual_reasoning_metric_only`.

Q06:

- Path: fallback.
- Labels: `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `q06_margin_context_revenue_only`, `source_gate_failed`, `fallback_slot_incomplete`.
- Verdict: correct safe fallback. Retail margin assets around gross margin rate, markdowns, shrink, inventory, fulfillment cost, and operating expense leverage are still missing from selected previews.

## Safety Check

- Wrong ticker: not observed.
- Wrong period: not observed.
- `sourceIdsValid=false`: 0.
- Raw English in final answer: 0 by benchmark summary.
- Raw English in diagnostics: 0 by benchmark summary.
- Malformed visible currency: not observed.
- Unsupported investment advice: not observed.
- Overconfident structural margin claim: not observed.
- Q03/Q04 regression: not directly rerun in this Q06-only benchmark; shared focused tests passed.

## Remaining Risks

- AAPL still needs better product/services gross-margin or operating-expense extraction.
- XOM still needs current-period energy margin/result assets, not PP&E/depletion/risk context.
- WMT still needs retail margin-specific assets; current selected source pack remains revenue/omnichannel-heavy.
- CAT improved to OpenAI, but the final answer should receive human review because it mixes revenue driver language with margin durability wording.
- The margin source backfill is intentionally test-environment-only. Production must not be rolled forward until human review and a broader Minimal Core rerun are complete.

## Recommended Next Step

Recommendation: `READY FOR Q06 HUMAN REVIEW`

Rationale:

- Q06 source pack quality improved enough to create a human-reviewable CAT/JPM OpenAI pair.
- Safety gates still fallback for AAPL/XOM/WMT when evidence is not strong enough.
- No source ID, raw-English, malformed-currency, or advice regression appeared.
- The next phase should review JPM/CAT wording and decide whether AAPL/XOM/WMT need deeper source extraction or whether safe fallback is acceptable for v1.1.
