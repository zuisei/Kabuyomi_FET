# Kabuyomi v1.1 Phase 3A Revenue Driver Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Test Worker: `kabuyomi-api-test`

Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

Final test deploy version ID: `e2ef83a4-6384-48b2-af74-d6167f2962ed`

Production deploy: not run.

## Scope

Phase 3A was limited to Q03 / `revenue_driver` diagnostics and source sufficiency. It did not add the full first-class section asset model, did not change billing, IAP, legal, AdMob, iOS, production deploy configuration, model provider, or broad prompt text.

## Implementation Summary

- Added a backward-compatible source-family classifier for selected source diagnostics.
- Added selected source family/type debug fields from the runtime context pack.
- Added the exact `sourceGatePassed` alias while preserving `sourceGateSufficient`.
- Narrowed revenue-driver source-gate coverage labels:
  - missing `revenue metric`
  - missing `MD&A revenue discussion`
  - missing `segment/revenue context`
  - existing sector-specific missing-source labels remain preserved.
- Kept revenue-driver sufficiency conservative:
  - requires a revenue metric.
  - requires concrete revenue-driver evidence.
  - keeps XBRL-only source packs on fallback.
  - does not treat generic SEC/website/table-of-contents boilerplate as sufficient.
- Tightened the technology revenue-driver signal after the first test Worker run showed AAPL could otherwise pass on weak context and then hit the invalid-source repair path.

## Files Changed

- `workers/src/lib/chat/source-family.ts`
- `workers/src/lib/chat/diagnostics.ts`
- `workers/src/lib/chat/grounding.ts`
- `workers/src/lib/chat/source-gate.ts`
- `workers/test/chat-diagnostics.test.ts`
- `workers/test/chat-source-gate.test.ts`
- `workers/testbench/scripts/run-benchmark.mjs`
- `docs/archive/v1-quality/V1_1_PHASE_3A_REVENUE_DRIVER_REPORT.md`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03-summary.json`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03-r2-summary.json`

## Commands Run

Initial focused/local checks:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm test -- chat-source-gate
npm test -- chat-diagnostics
npm run typecheck
npm test -- hard-intent
npm test -- context-pack
npm test -- chat-intent-context
npm run testbench:validate
npm test
npm run dryrun:test
```

Note: `npm test -- context-pack` has no matching test file in this repo and exited with "No test files found"; `npm test -- chat-intent-context` was run as the actual context-pack coverage.

Test Worker deploy commands:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Final focused Q03 benchmark command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3a-q03-r2 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03.jsonl \
npm run testbench:run
```

## Test Results

- `npm run typecheck`: pass.
- `npm test`: pass, 47 test files / 507 tests.
- `npm run dryrun:test`: pass.
- `npm run testbench:validate`: pass.
- Focused tests:
  - `npm test -- chat-source-gate`: pass.
  - `npm test -- hard-intent`: pass.
  - `npm test -- chat-diagnostics`: pass.
  - `npm test -- chat-intent-context`: pass.

## Test Worker Reachability

- `/v1/search?q=AAPL`: HTTP 200.
- `/v1/usage` with documented test device key `1e5200e1-9b6e-4970-a232-9ac542bb0827`: HTTP 200.

## Benchmark Artifacts

Final artifact:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03-r2.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03-r2-summary.json`

Superseded artifact retained for audit:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3a-q03-summary.json`

The superseded run caught an AAPL `invalid_source_id` repair path after the first deploy. The final `r2` run was produced after tightening the technology revenue-driver signal.

## Before / After

Baseline Q03 from `2026-05-06-v1-1-diagnostics-minimal-core-60.jsonl`:

- Rows: 5.
- Fallback: 5/5.
- `sourceIdsValid=false`: 0.
- Selected source families recorded: `xbrl_metric` only, because runtime debug did not yet expose source families.
- Exact token fields populated for Q03: 0/5.

Phase 3A Q03 final run:

- Rows: 5.
- Fallback: 4/5.
- OpenAI/model path: 1/5 (`AAPL-Q03`).
- `sourceIdsValid=false`: 0.
- Exact `sourceGatePassed` alias: present.
- Selected source families recorded:
  - `xbrl_metric`: 5 rows.
  - `context_window`: 3 rows.
  - `mda`: 3 rows.
  - `segment_revenue`: 1 row.
  - `revenue_discussion`: 1 row.
- Token fields:
  - populated for the 1 model-path row.
  - AAPL-Q03 prompt/completion/total: `1746 / 197 / 1943`.
  - fallback rows do not have model token counts, as expected.
- Diagnostic wrinkle:
  - AAPL-Q03 used `responsePath=openai` with `fallbackReason=null`, but still carried `fallbackCategory=sanitation_guard`, `fallbackUserReason=malformed_currency_detected`, and `guardLabels=["malformed_currency_detected"]`.
  - The rendered amount `1,437.6億ドル` matches the selected XBRL value `143,756,000,000 USD`; treat this as an observability/sanitation-label follow-up, not as production readiness.

## Q03 Final Run Details

| Case | Path | Gate | Source Families | sourceIdsValid | Token Total |
| --- | --- | --- | --- | --- | --- |
| AAPL-Q03 | `openai` | passed | `segment_revenue`, `context_window`, `revenue_discussion`, `xbrl_metric` | true | 1943 |
| JPM-Q03 | `fallback` | failed | `context_window`, `xbrl_metric` | true | null |
| XOM-Q03 | `fallback` | failed | `mda`, `xbrl_metric` | true | null |
| CAT-Q03 | `fallback` | failed | `context_window`, `mda`, `xbrl_metric` | true | null |
| WMT-Q03 | `fallback` | failed | `mda`, `xbrl_metric` | true | null |

## Critical Findings

- No `sourceIdsValid=false` regression appeared in the final Q03 run.
- XBRL-only or driver-empty rows still fallback safely.
- Q03 fallback improved from 5/5 to 4/5, but only AAPL improved in this narrow slice.
- JPM, XOM, CAT, and WMT still need better first-class section extraction/source assets. The current cache surfaces labels like MD&A/context, but the selected snippets still do not provide enough concrete driver evidence for the gate.
- The AAPL model-path answer is source-valid, but it remains a cautious Phase 3A improvement rather than a full quality solution. It names filing-stated factor classes and explicitly says additional product/geography detail is needed.
- AAPL also exposed a likely stale/over-eager `malformed_currency_detected` debug label on a non-fallback answer. This should be inspected in Phase 3B or the observability cleanup path before any production candidate.

## Recommendation

`READY FOR PHASE 3B`

Reason: Phase 3A improves Q03 fallback from 5/5 to 4/5, preserves `sourceIdsValid=false = 0`, keeps XBRL-only rows on safe fallback, and makes source-family diagnostics measurable. Continue on test only; the remaining Q03 failures need actual first-class revenue/segment section assets rather than broader gate loosening.
