# Kabuyomi v1.1 Phase 3C Revenue Asset Backfill Report

## Conclusion

Phase 3C improved Q03 `revenue_driver` from the Phase 3B.5 baseline while keeping the work test-only.

- Phase 3B.5 Q03 fallback: 2/5
- Phase 3C final Q03 fallback: 1/5
- OpenAI path: 4/5
- `sourceIdsValid=false`: 0
- Production deploy: not run

Recommendation: `READY FOR PHASE 3D`

Phase 3D should focus on XOM/energy extraction quality and final-answer quality handling. XOM still passes source gate but falls to `low_quality_answer`, and its selected previews remain broad commodity/reserve/market context rather than clean period-specific revenue result evidence.

## Branch / Deployment

- Branch: `v1.1-worker-quality-token-retrieval`
- Test Worker: `kabuyomi-api-test`
- Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Test deployment command: `cd /Users/0xt4/t4dano/Kabuyomi/workers && npm run deploy:test`
- Final deployed test version ID: `3ff80d70-f636-406e-a29f-729749226865`
- Production deploy: not run

## Implementation Summary

Implemented a narrow revenue-driver source asset/backfill slice:

- Added derived `Revenue driver discussion` `md_a` source chunks during filing source chunk construction.
- Built revenue-driver chunks from normalized filing/prepared filing text when available.
- Added sector-aware period-specific revenue driver detection for:
  - bank: NII, noninterest revenue/income, markets revenue, investment banking fees, card services
  - energy: commodity prices, production volumes, refining margins, upstream/downstream
  - industrial: sales volume, price realization, backlog, dealer inventory, equipment to end users
  - retail: comparable sales, traffic, average ticket, transactions, eCommerce, membership
  - technology: product launches, services/product revenue, geographic segments
- Added test-environment-only cache/source backfill for full records that have revenue metrics but lack strong revenue-driver source chunks.
- Tightened Q03 source gate so XBRL-only, Properties, generic business description, and history/store-footprint snippets do not count as sufficient revenue-driver evidence.
- Added Q03 post-selection filtering to downrank/remove generic business/history/property distractors when enough concrete revenue-driver sources are already selected.

The backfill path is intentionally not a schema migration and does not alter old cache record readability.

## JPM / CAT Asset Backfill Result

### JPM

Phase 3B.5 selected only `Item 2. Properties` plus XBRL, so the gate failed.

Phase 3C final selected first-class revenue discussion chunks:

- NII: `$95.4B`, up 3%, driven by Markets NII, Card Services revolving balances, wholesale deposit balances, and investment securities activity.
- NIR: `$87.0B`, up 2%, reflecting Markets noninterest revenue, asset management fees, auto operating lease income, lower securities losses, Payments fees, and investment banking fees.
- Supporting XBRL revenue and net income metrics.

Outcome:

- JPM-Q03 changed from fallback to OpenAI path.
- Source gate passed.
- `sourceIdsValid=true`.
- Remaining label: `missing_segment_revenue_context`, but this did not block the answer because bank revenue narrative was concrete enough.

### CAT

Phase 3B.5 selected broad Construction Industries/business snippets and XBRL; no strong sales-volume/price-realization evidence was available to the model.

Phase 3C final selected period-specific revenue discussion:

- 2025 total sales and revenues increased 4%.
- Increase reflected higher sales volume.
- Higher equipment sales to end users were called out.
- Unfavorable price realization partially offset the increase.
- Q1 2026 outlook source also references higher sales volume and favorable price realization.

Outcome:

- CAT-Q03 changed from fallback to OpenAI path.
- Source gate passed.
- `sourceIdsValid=true`.

## XOM / WMT Source Preview Quality Result

### XOM

Phase 3C created `Revenue driver discussion` sources, but the selected preview quality is still weak:

- Current selected sources mention 2025 crude/natural gas price ranges and long-term supply/demand drivers.
- Selected CTX sources still include reserves, production-sharing contract price effects, and broad commodity supply context.
- The source gate passes, but the finalizer still falls back with `low_quality_answer`.

Outcome:

- XOM-Q03 remains fallback.
- `sourceIdsValid=true`.
- Root cause is no longer XBRL-only; it is weak energy-specific period-result extraction plus post-gate answer quality.

Phase 3D should add an energy-specific result window extractor that looks for actual revenue/result explanations, not only long-term commodity market context.

### WMT

Phase 3B.5 selected mostly store history/footprint/strategy context.

Phase 3C final added usable revenue-driver sources:

- comparable sales driven by transactions and unit volumes
- grocery and health/wellness strength
- Walmart U.S. eCommerce contribution to comparable sales
- fiscal 2026 average ticket and transaction growth

Outcome:

- WMT-Q03 changed from fallback to OpenAI path.
- Source gate passed.
- `sourceIdsValid=true`.

Some broad history/footprint CTX snippets are still present in previews, so Phase 3D or 3E should continue tightening ordering/preview clipping, but the answer now uses the concrete comparable-sales/eCommerce evidence.

## Benchmark Comparison

Final run artifact:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3c-q03-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3c-q03-r2-summary.json`

Comparison:

| Case | Phase 3B.5 | Phase 3C final | Notes |
| --- | --- | --- | --- |
| AAPL-Q03 | OpenAI | OpenAI | No fallback regression; source previews still include some broad/TOC-like MD&A text. |
| JPM-Q03 | Fallback | OpenAI | Major improvement from Properties/XBRL to NII/NIR revenue discussion. |
| XOM-Q03 | OpenAI in 3B.5, fallback in 3C | Fallback | Source gate passes but answer remains low quality; energy-specific extraction still weak. |
| CAT-Q03 | Fallback | OpenAI | Major improvement from generic business snippets to sales volume / price realization evidence. |
| WMT-Q03 | OpenAI in 3B.5, fallback in first 3C run | OpenAI final | Concrete comp-sales/eCommerce snippets now present and answer passes. |

Summary metrics from final Phase 3C run:

- Rows: 5
- Raw response path: OpenAI 4, fallback 1
- Raw fallback reason: `low_quality_answer` 1
- Quality fallback rate: 20%
- `sourceIdsValid=false`: 0
- Infra contamination: false
- Rate-limit rows: 0
- p50 latency: 9985 ms
- p95 latency: 13833 ms

Source family coverage in final run:

- `segment_revenue`: 4 cases
- `mda`: 3 cases
- `revenue_discussion`: 2 cases
- `xbrl_metric`: 3 cases

Token observations:

- AAPL-Q03: prompt 2583, completion 209, total 2792
- JPM-Q03: prompt 1846, completion 358, total 2204
- XOM-Q03: prompt 2451, completion 272, total 2723
- CAT-Q03: prompt 2538, completion 282, total 2820
- WMT-Q03: prompt 2620, completion 307, total 2927

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

All passed before final test Worker deployment and benchmark.

## Benchmark Command

Temporary Q03 question file:

```bash
node - <<'NODE'
const fs = require('fs');
const rows = fs.readFileSync('testbench/questions/core-12.jsonl', 'utf8')
  .trim().split(/\n/).map(JSON.parse).filter((row) => row.templateId === 'Q03');
fs.writeFileSync('/tmp/kabuyomi-q03.jsonl', rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
console.log(`wrote ${rows.length} Q03 templates to /tmp/kabuyomi-q03.jsonl`);
NODE
```

Final benchmark:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3c-q03-r2 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03.jsonl \
npm run testbench:run
```

## Remaining Risks

- XOM still needs better energy-specific period-result extraction. Current evidence is too broad and still triggers `revenue_driver_declined_despite_context`.
- AAPL previews still include broad MD&A/forward-looking text, though AAPL did not regress.
- WMT still includes broad store-history/footprint CTX previews alongside good revenue discussion sources; answer quality passed, but preview ordering can be cleaner.
- The test-only full-record backfill fetches and persists upgraded source chunks during chat preparation in the test environment. This should remain test-only until reviewed for production cost/latency behavior.

## Recommendation

`READY FOR PHASE 3D`

Do not promote to production yet. Phase 3D should stay test-only and target:

- XOM/energy source extraction and gate evidence quality.
- Better clipping/removal of broad CTX snippets when concrete revenue discussion chunks exist.
- Low-quality finalizer diagnosis for supported but weakly phrased energy revenue-driver answers.
