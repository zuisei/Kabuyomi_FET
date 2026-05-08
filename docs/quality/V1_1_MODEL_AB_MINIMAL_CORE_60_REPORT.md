# Kabuyomi v1.1 Minimal Core 60 Model A/B Report

Date: 2026-05-07

Branch: `v1.1-worker-quality-token-retrieval`

HEAD at run start: `ce53df0`

## Executive Summary

The full controlled Minimal Core 60 A/B benchmark was run against the test Worker only.

Recommendation: `KEEP GPT-5-NANO LOW`

Why:

- Both configs completed the same 60 cases.
- Both configs recorded requested/effective model config fields.
- No production deploy was performed.
- `sourceIdsValid=false`: `0` for both.
- `rawEnglishInAnswer`: `0` for both.
- Config B (`gpt-5.4-nano` + `none`) was faster and used fewer output/total tokens, but it was more expensive in estimated dollars.
- Config B regressed hard-intent Q03 behavior: XOM-Q03 and WMT-Q03 fell back, while Config A answered all Q03 rows.
- Side-by-side classifier: A better `8`, B better `6`, tie `36`, both safe fallback `9`, infra-contaminated comparison `1`.

Config B is valid at API/config level, but this run does not justify switching the default model config.

## Deploy / Config Verification

Test Worker URL:

- `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

Temporary test-only deployments:

| Step | Config | Version ID |
| --- | --- | --- |
| Config A deploy | `OPENAI_CHAT_MODEL=gpt-5-nano`, `OPENAI_REASONING_EFFORT=low` | `1925b096-5c7a-4027-8398-fffb92c7e770` |
| Config B deploy | `OPENAI_CHAT_MODEL=gpt-5.4-nano`, `OPENAI_REASONING_EFFORT=none` | `24b56ff9-5936-4f6a-bf9f-444ac157ccfe` |
| Restore checked-in test config | `workers/wrangler.test.toml` | `8599cd7a-9c6e-44ab-ad3f-6b3b3abf5f1b` |

Production deploy: not performed.

Config field validation:

| Config | Rows | Missing config fields | Requested mismatches | Model-attempt effective mismatches | Note |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 60 | 0 | 0 | 0 | Pre-model fallback/deterministic rows have `effectiveModelName=null`, with requested config still recorded. |
| B | 60 | 0 | 0 | 0 | Pre-model fallback/deterministic rows have `effectiveModelName=null`, with requested config still recorded. |

Validated effective model-attempt configs:

- Config A model-attempt rows: `gpt-5-nano` / `low`
- Config B model-attempt rows: `gpt-5.4-nano` / `none`
- `reasoningEffortInvalid=false` on all rows.

## Benchmark Commands

Validation:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

Config A deploy:

```bash
./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5-nano \
  --var OPENAI_REASONING_EFFORT:low
```

Config A run:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-07-v1-1-minimal-core-60-gpt-5-nano-low \
OPENAI_CHAT_MODEL=gpt-5-nano \
OPENAI_REASONING_EFFORT=low \
npm run testbench:run
```

Config B deploy:

```bash
./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5.4-nano \
  --var OPENAI_REASONING_EFFORT:none
```

Config B run:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-07-v1-1-minimal-core-60-gpt-5-4-nano-none \
OPENAI_CHAT_MODEL=gpt-5.4-nano \
OPENAI_REASONING_EFFORT=none \
npm run testbench:run
```

Restore:

```bash
npm run deploy:test
```

## Token Comparison

| Metric | Config A: `gpt-5-nano low` | Config B: `gpt-5.4-nano none` | Readout |
| --- | ---: | ---: | --- |
| Model-attempt rows | 48 | 51 | B attempted model on three additional rows. |
| Prompt tokens sum | 115,420 | 115,948 | Roughly equal. |
| Prompt tokens mean | 2,404.6 | 2,273.5 | B slightly lower. |
| Prompt tokens p95 | 5,663 | 4,187 | B lower. |
| Completion tokens sum | 39,796 | 13,537 | B much lower. |
| Completion tokens mean | 829.1 | 265.4 | B much lower. |
| Completion tokens p95 | 1,489 | 457 | B much lower. |
| Total tokens sum | 155,216 | 129,485 | B lower. |
| Total tokens mean | 3,233.7 | 2,538.9 | B lower. |
| Total tokens p95 | 6,673 | 4,756 | B lower. |
| Cached input tokens | not exposed | not exposed | No cached-token field available. |
| Reasoning tokens | not exposed | not exposed | No reasoning-token field available. |

Token-only conclusion: Config B is lighter on completion and total tokens.

## Estimated Cost Comparison

Pricing used:

| Model | Input / 1M | Cached input / 1M | Output / 1M |
| --- | ---: | ---: | ---: |
| `gpt-5-nano` | `$0.05` | `$0.005` | `$0.40` |
| `gpt-5.4-nano` | `$0.20` | `$0.02` | `$1.25` |

Estimated cost:

| Metric | Config A | Config B |
| --- | ---: | ---: |
| Input cost | `$0.00577100` | `$0.02318960` |
| Cached input cost | `$0.00000000` | `$0.00000000` |
| Output cost | `$0.01591840` | `$0.01692125` |
| Total estimated model cost | `$0.02168940` | `$0.04011085` |
| Cost per all 60 rows | `$0.00036149` | `$0.00066851` |
| Cost per OpenAI answer | `$0.00050440` | `$0.00093281` |

Cost conclusion: Config B used fewer tokens but cost about `1.85x` Config A because its per-token price is higher.

## Latency Comparison

| Metric | Config A | Config B |
| --- | ---: | ---: |
| `modelCallLatencyMs` p50 | 8,695 ms | 3,169 ms |
| `modelCallLatencyMs` p95 | 16,760 ms | 6,791 ms |
| `modelCallLatencyMs` p99 | 17,210 ms | 7,228 ms |
| row `latencyMs` p50 | 8,671 ms | 4,260 ms |
| row `latencyMs` p95 | 18,291 ms | 7,919 ms |
| row `latencyMs` p99 | 21,235 ms | 8,711 ms |

Latency conclusion: Config B is clearly faster.

## Quality Comparison

| Metric | Config A | Config B |
| --- | ---: | ---: |
| Rows | 60 | 60 |
| OpenAI | 43 | 43 |
| Fallback | 12 | 12 |
| Deterministic | 5 | 5 |
| Quality rows excluded | 1 | 0 |
| Provider/server error rows | 1 | 0 |
| Rate-limit rows | 0 | 0 |
| `sourceIdsValid=false` | 0 | 0 |
| `rawEnglishInAnswer` | 0 | 0 |
| `rawEnglishSurfaced` | 0 | 0 |
| Visible malformed currency | 0 | 0 |
| Malformed-currency detector warnings | 1 | 0 |
| Retry attempted | 7 | 6 |
| Retry wasted | 3 | 4 |
| Hard-intent fallback | 7 | 8 |

Response path is superficially tied, but hard-intent behavior favors Config A.

The one Config A provider/server error was AAPL-Q01 and was excluded from quality comparison for that row.

## Q03 / Q04 / Q06 Comparison

| Scope | Config A | Config B | Readout |
| --- | --- | --- | --- |
| Q03 revenue_driver | 5 OpenAI / 0 fallback | 3 OpenAI / 2 fallback | Config A clearly better. B fell back on XOM-Q03 and WMT-Q03. |
| Q04 driver_durability_followup | 3 OpenAI / 2 fallback | 3 OpenAI / 2 fallback | Tie. AAPL/XOM safe fallback; JPM/CAT/WMT OpenAI. |
| Q06 margin_durability_followup | 0 OpenAI / 5 fallback | 1 OpenAI / 4 fallback | B answered AAPL-Q06, but this needs human review because AAPL-Q06 had previously been accepted as safe fallback when evidence was weak. |

Hard-intent row notes:

- AAPL-Q03: both answered; A is slightly cleaner and more compact.
- AAPL-Q04: both safe fallback.
- AAPL-Q06: A safe fallback; B answers with margin/tariff/FX discussion. Marked for human review, not automatic acceptance.
- JPM-Q03/Q04: both answered.
- JPM-Q06: both safe fallback.
- XOM-Q03: A answered; B fell back with `revenue_driver_declined_despite_context`.
- XOM-Q04/Q06: both safe fallback.
- CAT-Q03/Q04: both answered.
- CAT-Q06: both safe fallback.
- WMT-Q03: A answered; B fell back with `contextual_reasoning_metric_only`.
- WMT-Q04: both answered.
- WMT-Q06: both safe fallback.

## Side-by-Side Classification

| Classification | Rows |
| --- | ---: |
| `tie` | 36 |
| `both_safe_fallback` | 9 |
| `A_better` | 8 |
| `B_better` | 6 |
| `cannot_compare_due_to_infra` | 1 |

Important row-level differences:

| Row | Classification | Reason |
| --- | --- | --- |
| AAPL-Q01 | `cannot_compare_due_to_infra` | Config A hit provider/server fallback; Config B answered. |
| AAPL-Q06 | `B_better` by path | Needs human review because answer vs safe fallback changes accepted Q06 behavior. |
| WMT-Q03 | `A_better` | Config A answered; Config B fell back. |
| XOM-Q03 | `A_better` | Config A answered; Config B fell back. |
| WMT-Q05 | `A_better` | Config A answered; Config B fell back. |
| WMT-Q11 | `B_better` | Config B answered; Config A fell back. |

## Critical Safety Findings

No release-critical safety failure was observed in either completed run:

- Wrong ticker: not observed in benchmark diagnostics.
- Wrong period: not observed in benchmark diagnostics.
- `sourceIdsValid=false`: 0.
- Raw English in final answer: 0.
- Raw English surfaced: 0.
- User-visible malformed currency: 0.
- Rate-limit contamination: 0.
- Production deploy: not performed.

Quality caveats:

- Config A had one provider/server-error row: AAPL-Q01.
- Config A had one malformed-currency detector warning on AAPL-Q05, but no visible malformed-currency label was present.
- Config B had hard-intent Q03 regressions on XOM-Q03 and WMT-Q03.
- Config B's AAPL-Q06 OpenAI answer should be human-reviewed before treating it as quality improvement.

## Human Review Packet

Created/updated:

- `docs/quality/V1_1_MODEL_AB_HUMAN_REVIEW_PACKET.md`

The review packet includes:

- all Q03 rows
- all Q04 rows
- all Q06 rows
- rows where one config answered and the other fallbacked
- rows where token difference exceeded 25%
- rows with critical-looking or diagnostic-warning labels
- rows where comparison could not be made because of infra

Review queue count: 24 rows.

## Output Artifacts

Created/updated:

- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-nano-low.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-nano-low-summary.json`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-4-nano-none.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-4-nano-none-summary.json`
- `workers/testbench/reports/model-ab-minimal-core-60-comparison.json`
- `docs/quality/V1_1_MODEL_AB_MINIMAL_CORE_60_REPORT.md`
- `docs/quality/V1_1_MODEL_AB_HUMAN_REVIEW_PACKET.md`

## Final Recommendation

`KEEP GPT-5-NANO LOW`

Config B is promising for latency, but it is not cheaper in dollars and it regressed the most important hard-intent Q03 behavior. Keep Config A for now and use Config B only for further targeted experiments if latency becomes the dominant constraint.
