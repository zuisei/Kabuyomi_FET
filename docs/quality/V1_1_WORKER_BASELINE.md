# Kabuyomi v1.1 Worker Baseline

Date: 2026-05-06 JST

## Branch / HEAD

- Branch: `v1.1-worker-quality-token-retrieval`
- Start point: `main`
- HEAD at baseline capture: `d2dc50e` (`Repair residual English in quote translations`)
- Worktree state at branch creation: clean

## Baseline Commands

All commands were run from `workers/` unless noted.

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | pass, 47 files / 499 tests |
| `npm run dryrun:test` | pass, dry-run against `wrangler.test.toml` |
| `npm run testbench:validate` | pass, 5 default tickers / 12 question templates |

The dry run confirmed the intended test deploy target:

- Worker name: `kabuyomi-api-test`
- Test URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Config: `workers/wrangler.test.toml`
- Production config was inspected but not deployed.

## Minimal Core 60 Summary

Artifact: `workers/testbench/runs/2026-05-05-v1-safety-minimal-core-60-row-summary.json`

- Rows: 60
- Tickers: AAPL, JPM, XOM, CAT, WMT
- `sourceIdsValid=false`: 0
- Response paths: `openai=32`, `fallback=19`, `deterministic=9`
- Raw fallback total: 19
- Quality fallback total: 19
- Quality fallback rate: 31.7%
- Quality hard-intent fallback: 15
- Q03/Q04/Q06 fallback: 15
- Retry attempted: 4
- Retry wasted: 3
- Latency: p50 3365 ms, p95 6415 ms, p99 9028 ms
- Infra contaminated: false

Hard-intent baseline from the architecture brief:

- `revenue_driver`: fallback 5/5
- `driver_durability_followup`: fallback 5/5
- `margin_durability_followup`: fallback 5/5

## Production Smoke 20 Summary

Artifact: `workers/testbench/runs/2026-05-05-v1-safety-production-smoke-20-summary.json`

- Rows: 20
- Tickers: AAPL, JPM
- `sourceIdsValid=false`: 0
- Response paths: `openai=10`, `fallback=7`, `deterministic=3`
- Raw fallback total: 7
- Quality fallback total: 7
- Quality fallback rate: 35.0%
- Quality hard-intent fallback: 6
- Q03/Q04/Q06 fallback: 6
- Retry attempted: 0
- Retry wasted: 0
- Latency: p50 3053 ms, p95 5777 ms, p99 7101 ms
- Infra contaminated: false

Production smoke remains diagnostically thin because normal production `/v1/chat` responses omit the debug block. Logs have richer runtime fields, but the production JSONL artifact cannot fully prove fallback taxonomy, source-gate labels, selected-source diagnostics, or token counts per row.

## Current Source Asset Shape

Confirmed from `docs/quality/WORKER_ARCHITECTURE_BRIEF.md` and code inspection:

- First-class filing cache source chunk types are currently `md_a` and `xbrl_metric`.
- Business, Risk Factors, Segment, Revenue Note, Liquidity, Debt, and Cash Flow discussion are not persisted as first-class source families.
- Hard-intent retrieval can synthesize `CTX*` / `HARDCTX*` windows, but those are chat-time slices over existing narrative text, not stable section assets.

## Known Critical Safeguards

Keep these unchanged or stronger:

- `/v1/chat` loads the exact requested filing key; no silent latest-filing upgrade.
- Credit and quota are charged server-side; failed or non-chargeable answers refund.
- Apple consumable credits are granted only after Apple App Store Server verification.
- No client JWS or client payload is trusted as purchase authority.
- Source validation filters model-cited source IDs against the current context.
- Japanese finalizer and language guards prevent raw English/internal leakage where detected.
- No-investment-advice, no buy/sell recommendation, no target price, and no stock forecast behavior must remain enforced.

## Baseline Observability

Available today:

- Worker logs: `chat_path_decision`, `chat_quality_pipeline`, `chat_context_selection`, `llm_usage`, provider error logs.
- Test Worker debug responses: selected source IDs/labels, source-gate diagnostics, fallback taxonomy, retry fields, language guard fields, selected source char/token estimates.
- Testbench summaries: response path, fallback breakdowns, source ID validity, infra contamination, retries, latency.

Gaps before this branch:

- Production rows do not carry debug fields.
- Testbench rows did not consistently persist runtime token counts from debug responses.
- Token attribution by prompt/source/conversation/retry was not explicit.
- Source family/type diagnostics were weak because source assets are mostly `md_a` / `xbrl_metric`.
- Hard-intent fallback reasons can be counted, but required section absence is not yet first-class.

## Safe Benchmark Policy

Safe local commands:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`
- `npm run testbench:summarize -- <run.jsonl>`

Safe live commands after explicit decision:

- test Worker deploy via `npm run deploy:test` or `./node_modules/.bin/wrangler deploy --config wrangler.test.toml`
- short test Worker smoke against `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

Do not run expensive live LLM benchmarks until the branch has measurement changes deployed to the test Worker and the run is scoped by ticker/question limit, pacing, and credit strategy.

## Baseline Risks

- Hard-intent quality is limited mainly by missing first-class narrative section assets.
- Production artifact visibility is insufficient for source-gate and token investigation.
- Token costs are observable in logs but not yet first-class benchmark row data.
- Existing answer-safety review found previous critical/suspect rows; v1.1 work must not weaken finalizer or source validation while improving retrieval.
