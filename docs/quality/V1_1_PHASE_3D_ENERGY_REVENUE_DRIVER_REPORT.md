# Kabuyomi v1.1 Phase 3D Energy Revenue Driver Report

## Conclusion

Phase 3D tightened energy-sector Q03 `revenue_driver` evidence quality and made the remaining XOM failure more honest.

- Phase 3C Q03 fallback: 1/5
- Phase 3D Q03 fallback: 1/5
- OpenAI path: 4/5
- `sourceIdsValid=false`: 0
- Production deploy: not run

Recommendation: `READY FOR Q04 PHASE`

XOM did not become OpenAI path because the available selected evidence is still broad energy market/reserve context, not current-period revenue/result driver evidence. That is the correct safe behavior: the source gate now fails with specific energy labels rather than passing weak context through to the model.

## Branch / Deployment

- Branch: `v1.1-worker-quality-token-retrieval`
- Test Worker: `kabuyomi-api-test`
- Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Test deployment command: `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm run deploy:test`
- Test deployment version ID: `39109155-5ea3-48df-88e1-a3c99acf3310`
- Production deploy: not run

## XOM Diagnosis

Phase 3C XOM row:

- `responsePath`: fallback
- `fallbackReason`: `low_quality_answer`
- `sourceGatePassed`: true
- `lowQualityReason`: `revenue_driver_declined_despite_context`
- Model raw preview explicitly said the selected excerpts did not directly contain the revenue-decrease cause.

Classification:

- `energy_source_too_broad`
- `source_selected_but_ignored`
- not a finalizer false positive
- not a safe synthesis target

The selected Phase 3C excerpts were:

- long-term crude/natural gas supply-demand context
- proved reserves and reserve-development context
- production-sharing contract mechanics
- generic oil/gas price environment text
- XBRL revenue metric

These are useful background, but they are not strong current-period revenue/result driver evidence.

## Implementation Summary

Implemented a narrow energy/Q03 evidence-quality refinement:

- Energy revenue-driver detection now requires a current-period revenue, sales, earnings, or operating-results tie.
- Broad energy snippets are rejected or downranked when they only discuss:
  - long-term supply/demand outlook
  - proved reserves / reserve disclosures
  - production-sharing contract mechanics
  - generic energy transition / market outlook / risk context
- Added energy-specific source gate labels:
  - `energy_revenue_driver_context_too_broad`
  - `missing_energy_period_result_driver`
  - `energy_xbrl_only`
  - `energy_reserve_context_not_revenue_driver`
- Preserved Phase 3C non-energy behavior for JPM/CAT/WMT.
- Added synthetic tests for:
  - crude/gas price and production-volume current-period evidence
  - refining/downstream margin current-period evidence
  - long-term commodity outlook rejection
  - reserves disclosure rejection
  - production-sharing mechanics rejection
  - XBRL-only fallback safety

No prompt, model provider, billing, iOS, legal, or production deployment changes were made.

## Benchmark Comparison

Final Phase 3D artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3d-q03.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3d-q03-summary.json`

Comparison:

| Case | Phase 3C final | Phase 3D | Notes |
| --- | --- | --- | --- |
| AAPL-Q03 | OpenAI | OpenAI | No fallback regression. |
| JPM-Q03 | OpenAI | OpenAI | NII/NIR evidence remains selected. |
| XOM-Q03 | Fallback, gate passed | Fallback, gate failed | Better safety: weak broad energy context no longer passes as sufficient. |
| CAT-Q03 | OpenAI | OpenAI | Sales volume / price realization evidence remains selected. |
| WMT-Q03 | OpenAI | OpenAI | Comparable sales / eCommerce evidence remains selected. |

Final summary:

- Rows: 5
- Raw response path: OpenAI 4, fallback 1
- Quality fallback rate: 20%
- `sourceIdsValid=false`: 0
- Infra contamination: false
- Rate-limit rows: 0
- p50 latency: 6459 ms
- p95 latency: 7680 ms

## XOM Final Source Quality

Phase 3D XOM:

- `sourceGatePassed`: false
- `sourceIdsValid`: true
- `fallbackKind`: `evidence_slot`
- `finalizerGuardLabels`: `source_insufficient`
- `lowQualityReason`: none
- token fields: null because no remote model call was made after source gate failure

Selected source previews still include:

- crude/natural gas price range and long-term supply/demand context
- reserves / support infrastructure text
- raw materials / seasonality / regulatory context
- XBRL revenue and net income metrics

New failure labels:

- `driver_slots_empty`
- `sector_required_source_missing`
- `revenue_driver_evidence_too_generic`
- `missing_revenue_driver_narrative`
- `energy_reserve_context_not_revenue_driver`
- `energy_revenue_driver_context_too_broad`
- `missing_energy_period_result_driver`
- `source_gate_failed`
- `fallback_slot_incomplete`

This is safer than Phase 3C: broad energy context is no longer treated as strong revenue-driver evidence.

## Source Family Distribution

Final run source family coverage:

- `segment_revenue`: 4 cases
- `mda`: 3 cases
- `revenue_discussion`: 2 cases
- `xbrl_metric`: 3 cases

## Token Changes

Phase 3D final run:

- AAPL-Q03: prompt 2583, completion 187, total 2770
- JPM-Q03: prompt 1846, completion 281, total 2127
- XOM-Q03: no model token fields because source gate fallback occurred before remote model call
- CAT-Q03: prompt 2538, completion 265, total 2803
- WMT-Q03: prompt 2620, completion 79, total 2699

Compared with Phase 3C, XOM avoids a wasted remote model call when only weak broad energy evidence is available.

## Tests Run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`
- `npm test -- filing-source-assets`
- `npm test -- chat-source-gate`
- `npm test -- hard-intent`
- `npm test -- chat-diagnostics`
- `npm test -- chat-intent-context`

All passed before test Worker deployment and benchmark.

## Benchmark Command

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3d-q03 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03.jsonl \
npm run testbench:run
```

## Remaining Risks

- XOM still lacks strong current-period revenue/result driver source assets. A broader ingestion redesign may eventually be needed for energy filings if the source text exists outside the current MD&A/source windows.
- AAPL/WMT still include some broad source previews, though they did not regress.
- The test-only source backfill path remains test-only and should not be promoted until latency/cost behavior is reviewed.

## Recommendation

`READY FOR Q04 PHASE`

Phase 3D achieved the safer outcome for Q03: weak XOM energy context no longer passes source sufficiency. Q03 fallback remains 1/5, but the remaining failure is now correctly classified as missing current-period energy result evidence rather than a model/finalizer failure.
