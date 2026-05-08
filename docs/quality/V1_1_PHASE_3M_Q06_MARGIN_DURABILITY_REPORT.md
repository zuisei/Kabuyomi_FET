# Kabuyomi v1.1 Phase 3M Q06 Margin Durability Report

Date: 2026-05-06
Branch: `v1.1-worker-quality-token-retrieval`
Scope: Q06 `margin_durability_followup` baseline and first narrow source-gate fix

## Conclusion

Phase 3M established the first Q05/Q06 diagnostics baseline and isolated the first Q06 failure class.

The baseline showed that Q06 was still weak:

- Q05 usually produced deterministic metric-only margin answers, not concrete margin drivers.
- Q06 often received selected sources that were revenue, table, XBRL, or generic business context rather than margin-driver and durability context.
- AAPL-Q06 and CAT-Q06 could pass source gate on weak context and then fall back later.
- XOM-Q06 reached the OpenAI path in the baseline, but the selected sources were broad PP&E / depletion / risk context rather than a clean current-period margin durability explanation.

The implemented first fix is intentionally conservative:

- Tighten Q06 `margin_durability_followup` source gate.
- Require concrete margin-driver evidence plus explicit durability / one-time / structural context.
- Treat XBRL-only, table-heavy, generic business-description, and revenue-driver-only packs as insufficient for Q06.
- Add diagnostic failure labels so future runs show why Q06 did not proceed.

After the fix, Q06 fallback is 5/5. This is a safe regression in answer quantity but an improvement in evidence discipline: weak context now fails earlier instead of producing unstable model/finalizer behavior.

Production was not deployed. Only the test Worker was deployed.

## Branch / Commit

- Branch: `v1.1-worker-quality-token-retrieval`
- Starting HEAD for this phase: `2b695d6`
- Local commit: Phase 3M commit in this branch

## Q06 Baseline Diagnosis

Baseline run:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06-baseline.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06-baseline-summary.json`

Baseline summary:

- Rows: 10
- Response paths: fallback 5, deterministic 4, OpenAI 1
- Q06 fallback: 4/5
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- Infra/provider contamination: false

Per-company Q06 baseline:

| Ticker | Baseline Q05 | Baseline Q06 | Diagnosis |
| --- | --- | --- | --- |
| AAPL | Deterministic metric-only margin answer; no concrete driver | Fallback after source gate passed | Source gate too permissive; selected XBRL plus product/seasonality/tariff context, not margin durability evidence |
| JPM | Deterministic metric-only net-margin decline | Safe fallback before model | Bank margin/provision/expense source assets missing; NII/NIR revenue context is not enough for margin durability |
| XOM | Deterministic metric-only net-margin decline | OpenAI | Source gate passed on PP&E, depreciation/depletion, upstream spending and risk context; evidence was relevant but broad/table-heavy |
| CAT | Deterministic metric-only margin decline | Fallback after source gate passed and language guard repaired | Source gate too permissive; selected generic demand/product portfolio and revenue-driver context, not margin durability evidence |
| WMT | Fallback, metric-only | Safe fallback before model | Q05 did not identify a margin driver; selected comparable-sales/eCommerce revenue context, not margin/cost evidence |

## Implementation Summary

Changed:

- `workers/src/lib/chat/source-gate.ts`
  - Added Q06-specific source quality analysis for `margin_durability_followup`.
  - Added labels:
    - `missing_margin_driver_evidence`
    - `missing_margin_durability_context`
    - `margin_context_xbrl_only`
    - `margin_context_table_heavy`
    - `margin_durability_evidence_too_generic`
  - Required Q06 source sufficiency to have:
    - recovered follow-up target
    - margin driver slot
    - durability context
    - concrete margin-driver source
    - concrete durability / one-time / structural source
    - no table-heavy selected pack
  - Kept energy depreciation/depletion/upstream spending as a possible Q06 signal, but table-heavy live packs now fail safely.
  - Stopped treating revenue-only `price realization` as sufficient Q06 durability evidence by itself.
  - Downranked industrial business-description text such as product portfolio, broad construction-machinery demand, and lifetime owning/operating-cost explanations.
- `workers/test/chat-source-gate.test.ts`
  - Added focused Q06 tests for:
    - XBRL/table-only margin context fails.
    - generic CAT-like industrial business context fails.
    - CAT-like revenue-driver context without margin durability fails.
    - XOM-like energy margin evidence can still pass when it contains concrete upstream spending and depreciation/depletion evidence.

No prompt, retrieval broad refactor, model provider, billing, iOS, legal, or production deploy changes were made.

## Tests Run

All commands ran from `/Users/0xt4/t4dano/Kabuyomi/workers`.

- `npm run typecheck`
- `npm test -- chat-source-gate`
- `npm test -- hard-intent`
- `npm test -- chat-diagnostics`
- `npm test -- chat-intent-context`
- `npm test -- chat-context`
- `npm test -- final-answer-language`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`

Final local validation status:

- Typecheck: passed
- Full test suite: passed, 48 files / 564 tests
- Dry-run test deploy: passed
- Testbench validation: passed

## Test Worker Deploy Result

Production deploy: not performed.

Test deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Final test Worker deploy:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `6731af23-390b-4d1d-9c16-ece73d827b6d`

## Benchmark Comparison

Baseline benchmark command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3m-q05-q06-baseline \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q05-q06.jsonl \
npm run testbench:run
```

Final after-fix benchmark command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3m-q05-q06-r4 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q05-q06.jsonl \
npm run testbench:run
```

Final after-fix artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06-r4.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06-r4-summary.json`

| Metric | Baseline | Phase 3M r4 |
| --- | ---: | ---: |
| Rows | 10 | 10 |
| Q06 fallback | 4/5 | 5/5 |
| OpenAI rows | 1 | 0 |
| `sourceIdsValid=false` | 0 | 0 |
| `rawEnglishInAnswer` | 0 | 0 |
| `rawEnglishSurfaced` | 0 | 0 |
| Infra/provider contaminated | false | false |
| p50 latency | 2280 ms | 1847 ms |
| p95 latency | 8644 ms | 8300 ms |

Interpretation:

- The fallback count did not improve. It intentionally increased because the gate now rejects weak Q06 evidence earlier.
- This is the correct first safety move: Q06 should not answer temporary-vs-structural margin durability from metric-only, table-heavy, or revenue-driver-only context.
- The next quality gain requires better margin/cost/profitability source assets and Q05 margin-driver extraction, not prompt or finalizer broadening.

## Per-Company Q06 Outcome

| Ticker | Phase 3M r4 outcome | Source gate labels | Assessment |
| --- | --- | --- | --- |
| AAPL | Safe fallback | `missing_margin_driver_evidence`, `missing_margin_durability_context`, `margin_durability_evidence_too_generic`, `source_gate_failed` | Correct fallback; selected pack has XBRL plus revenue/product/tariff context but not margin-driver durability evidence |
| JPM | Safe fallback | `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `source_gate_failed`, `fallback_slot_incomplete` | Correct fallback; needs bank margin/provision/noninterest expense/segment profitability assets |
| XOM | Safe fallback | `margin_context_table_heavy`, `source_gate_failed` | Safer than baseline OpenAI; current PP&E/depletion/upstream context is broad/table-heavy and not enough for a confident durability answer |
| CAT | Fallback after source gate passed | none | Still not fully fixed; selected generic business/revenue context leads to language-guard fallback. Needs better margin/cost source assets and possibly another CAT-specific gate pass |
| WMT | Safe fallback | `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `source_gate_failed`, `fallback_slot_incomplete` | Correct fallback; selected comparable-sales/eCommerce context is revenue evidence, not margin durability evidence |

## Remaining Risks

- CAT-Q06 still has a source-gate false-positive path in the live artifact. The final answer is safe, but the gate should eventually fail earlier once CAT margin/cost source assets are available.
- Q05 is still mostly deterministic and metric-only, so Q06 often lacks a concrete recovered margin driver.
- Existing selected packs are dominated by XBRL, revenue discussion, table fragments, and generic business context. Q06 needs first-class margin/cost/profitability discussion assets.
- XOM energy evidence needs cleaner current-period margin/result context; broad PP&E and risk context should not be used for structural-vs-temporary answers.
- The current fix improves safety/diagnostics, not answer coverage.

## Recommendation

`NEEDS MARGIN SOURCE ASSETS`

Recommended next phase:

1. Add or backfill first-class margin/cost/profitability discussion assets.
2. Improve Q05 `margin_driver` so Q06 receives a concrete source-backed margin driver.
3. Re-run Q05/Q06 after the asset work before adding any Q06 finalizer repair.
