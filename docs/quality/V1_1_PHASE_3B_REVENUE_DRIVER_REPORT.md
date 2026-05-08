# Kabuyomi v1.1 Phase 3B Revenue Driver Report

Date: 2026-05-06
Branch: `v1.1-worker-quality-token-retrieval`
Base before work: `f8710d1`

## Conclusion

Phase 3B improved revenue-driver source selection mechanics and source-family coverage, but it did not reduce the live Q03 fallback rate beyond Phase 3A.

Recommendation: `KEEP ON TEST ONLY`

The slice is safe enough to keep on the v1.1 test branch, but Q03 is not ready to move to Q04/Q06 quality work yet. The next slice should focus on cached filing asset upgrade/backfill and final-answer quality recovery for source-gate-passing revenue-driver rows.

## Commands

Validation:

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
```

Test deploy:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Q03 diagnostics benchmark:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
node - <<'NODE'
const fs = require('fs');
const rows = fs.readFileSync('testbench/questions/core-12.jsonl', 'utf8')
  .trim()
  .split(/\n/)
  .map((line) => JSON.parse(line))
  .filter((row) => row.templateId === 'Q03');
fs.writeFileSync('/tmp/kabuyomi-q03.jsonl', rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
console.log(`wrote ${rows.length} Q03 templates to /tmp/kabuyomi-q03.jsonl`);
NODE
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3b-q03 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03.jsonl \
npm run testbench:run
```

Production deploy was not run.

## Test Worker Deploy

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `b3e06f58-2f32-4628-9790-049eda11e881`
- Command: `npm run deploy:test`

## Implementation Summary

Phase 3B stayed within the revenue-driver/source-diagnostics scope:

- Added revenue-driver priority window matching for late MD&A evidence.
- Expanded Q03 supplemental scanning from the first 24 generic matches to a larger revenue-driver-aware candidate set.
- Added focused window extraction so matches such as net interest income, commodity/refining context, sales volume, price realization, backlog, and comparable sales remain near the selected excerpt.
- Added concrete revenue-driver filtering so generic revenue/demand boilerplate is rejected.
- Changed Q03 supplemental labels to `Segment and revenue context`.
- Preserved existing source IDs and old `md_a` / `xbrl_metric` compatibility.
- Extended source-family derivation so Phase 3B CTX windows classify as `segment_revenue`.
- Added sector-focused tests for JPM, XOM, CAT, and WMT evidence patterns.

## Remaining Q03 Fallback Diagnosis

Phase 3A baseline:

- Q03 fallback: 4/5
- OpenAI path: 1/5
- `sourceIdsValid=false`: 0

Phase 3B run:

- Q03 fallback: 4/5
- OpenAI path: 1/5
- `sourceIdsValid=false`: 0
- Infra contamination: none

Per company:

| Case | Phase 3B path | Gate | Diagnosis |
| --- | --- | --- | --- |
| AAPL-Q03 | `openai` | passed | No regression. Selected families include `segment_revenue`, `revenue_note`, `revenue_discussion`, and `xbrl_metric`. |
| JPM-Q03 | `fallback` | failed | Live selected sources are still `S2` plus XBRL metrics. The exposed cached source chunks are properties/table fragments, not bank revenue discussion. Evidence exists in the filing text, but the live cached assets do not expose a usable MD&A revenue window to the Q03 pack. |
| XOM-Q03 | `fallback` | passed | Source selection improved: selected `segment_revenue` CTX windows plus XBRL, and source gate passed with commodity/upstream hits. Final answer still fell back as `low_quality_answer`, so this moved from retrieval failure to answer-quality/finalizer failure. |
| CAT-Q03 | `fallback` | failed | One `segment_revenue` CTX window was selected, but gate still reported missing segment results and industrial KPI window. The selected live evidence is not specific enough for sales volume / price realization / backlog driver slots. |
| WMT-Q03 | `fallback` | passed | Source selection improved: selected `segment_revenue` CTX windows plus XBRL, and source gate passed with comparable sales, traffic, eCommerce, and membership hits. Final answer still fell back as `low_quality_answer`, so this moved from retrieval failure to answer-quality/finalizer failure. |

Selected-source text was not persisted in the Q03 row artifact, so the detailed live diagnosis used row diagnostics plus `/v1/company` exposed cached source chunks. `/v1/company` does not expose `mdaText`, which remains an observability gap for this phase.

## Benchmark Comparison

Artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3b-q03.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3b-q03-summary.json`

Summary:

| Metric | Phase 3A | Phase 3B |
| --- | ---: | ---: |
| Q03 rows | 5 | 5 |
| OpenAI path | 1 | 1 |
| Fallback | 4 | 4 |
| `sourceIdsValid=false` | 0 | 0 |
| Source gate passed | 1/5 observed in Phase 3A live outcome | 3/5 |
| Token field coverage | 1/5+ from OpenAI rows | 3/5 |

Phase 3B did improve source gate pass coverage for XOM and WMT, but the benchmark success metric remains blocked because their final answers still triggered `low_quality_answer` fallback.

## Source Family Distribution

Across the Phase 3B Q03 rows:

- `segment_revenue`: 4 rows
- `xbrl_metric`: 5 rows
- `revenue_discussion`: 1 row
- `revenue_note`: 1 row
- `mda`: 1 row

This confirms the new CTX classification is visible in testbench artifacts.

## Failure Labels

Phase 3B source-gate failure labels:

- `driver_slots_empty`: 2
- `sector_required_source_missing`: 2
- `source_gate_failed`: 2
- `fallback_slot_incomplete`: 2
- `source_relevance_low`: 1

JPM and CAT remain true source/gate failures. XOM and WMT are now source-gate-passing rows that still fail at final-answer quality.

## Token Summary

Token fields were populated on rows that reached the remote model:

- AAPL-Q03: prompt 2528, completion 246, total 2774
- XOM-Q03: prompt 1669, completion 63, total 1732
- WMT-Q03: prompt 1542, completion 218, total 1760

JPM and CAT did not call the remote model after source-gate failure, so token fields are null as expected.

## Risks

- The code improves future/available MD&A window selection, but older cached filing assets can still be too thin.
- JPM and CAT likely require a filing cache/content-upgrade slice, not only context ranking.
- XOM and WMT show a new next-layer issue: source evidence can pass the gate, but the final answer can still be rejected as low quality.
- Selected source text/excerpts are still not persisted in benchmark rows, making live diagnosis weaker than it should be.

## Next Recommendation

Keep Phase 3B on the test branch only.

Recommended Phase 3C:

- Add or trigger test-only content upgrade/backfill for revenue-driver MD&A windows.
- Persist selected source excerpts in diagnostics artifacts for test Worker runs.
- Investigate why XOM and WMT source-gate-passing rows still hit `low_quality_answer`.
- Do not move to Q04/Q06 until Q03 fallback improves with sourceIdsValid still at 0 false rows.
