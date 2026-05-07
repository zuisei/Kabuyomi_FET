# Kabuyomi v1.1 Minimal Core 60 Model A/B Preflight Report

Date: 2026-05-07

Branch: `v1.1-worker-quality-token-retrieval`

HEAD: `818387b`

## Executive Summary

The controlled Minimal Core 60 A/B benchmark was not run.

Config B, `gpt-5.4-nano` with reasoning effort `none`, failed preflight because the current Worker OpenAI configuration does not accept `none` as an effective reasoning effort. The Worker currently accepts only:

- `minimal`
- `low`
- `medium`
- `high`

Any other `OPENAI_REASONING_EFFORT` value resolves to `minimal`. Running Config B now would therefore compare `gpt-5.4-nano` with effective `minimal`, not the requested `none`.

Recommendation: `INCONCLUSIVE: CONFIG FAILED PREFLIGHT`

## Requested Configs

| Label | Requested model | Requested reasoning effort | Preflight status |
| --- | --- | --- | --- |
| `gpt-5-nano-low` | `gpt-5-nano` | `low` | Configurable through test Worker vars |
| `gpt-5.4-nano-none` | `gpt-5.4-nano` | `none` | Blocked: Worker would silently resolve `none` to `minimal` |

## Git / Worktree Status

- Branch: `v1.1-worker-quality-token-retrieval`
- HEAD: `818387b`
- Worktree: dirty before this task, with unrelated iOS/legal-site files and older untracked benchmark artifacts already present.

Unrelated dirty files were not modified or staged by this task.

## Validation Commands

Run from `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

Result:

- `npm run typecheck`: passed
- `npm test`: passed, 48 test files / 579 tests
- `npm run dryrun:test`: passed
- `npm run testbench:validate`: passed

## Model Config Verification

Inspected:

- `workers/wrangler.test.toml`
- `workers/wrangler.toml`
- `workers/src/env.ts`
- `workers/src/clients/llm/providers/openai/request.ts`
- `workers/test/openai.test.ts`
- `workers/testbench/scripts/**`
- `workers/package.json`

The test Worker config is separate from production:

- Test Worker name: `kabuyomi-api-test`
- Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Test config file: `workers/wrangler.test.toml`
- Production config file: `workers/wrangler.toml`

`workers/wrangler.test.toml` currently sets:

```toml
OPENAI_CHAT_MODEL = "gpt-5-nano"
OPENAI_REASONING_EFFORT = "minimal"
```

Wrangler dry-run confirmed test-only var injection is mechanically possible:

```bash
./node_modules/.bin/wrangler deploy --config wrangler.test.toml --dry-run \
  --var OPENAI_CHAT_MODEL:gpt-5-nano \
  --var OPENAI_REASONING_EFFORT:low
```

```bash
./node_modules/.bin/wrangler deploy --config wrangler.test.toml --dry-run \
  --var OPENAI_CHAT_MODEL:gpt-5.4-nano \
  --var OPENAI_REASONING_EFFORT:none
```

Both commands were dry-runs only. No Worker was deployed.

However, Worker code rejects `none` at config resolution time:

```ts
function resolveOpenAIReasoningEffort(env: Env): "minimal" | "low" | "medium" | "high" {
  const raw = env.OPENAI_REASONING_EFFORT?.trim();
  return raw === "low" || raw === "medium" || raw === "high" || raw === "minimal" ? raw : "minimal";
}
```

The `Env` type also does not include `none`:

```ts
OPENAI_REASONING_EFFORT?: "minimal" | "low" | "medium" | "high";
```

Because of this, Config B would be silently ignored as requested and would become effective `minimal`.

## Benchmark Commands

The requested full-run commands were not executed:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-minimal-core-60-gpt-5-nano-low \
OPENAI_CHAT_MODEL=gpt-5-nano \
OPENAI_REASONING_EFFORT=low \
npm run testbench:run
```

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-minimal-core-60-gpt-5-4-nano-none \
OPENAI_CHAT_MODEL=gpt-5.4-nano \
OPENAI_REASONING_EFFORT=none \
npm run testbench:run
```

Reason: the remote Worker reads deployed Worker vars, and the current Worker cannot represent effective `none` reasoning effort. Running the benchmark would produce an invalid A/B.

## Token Comparison

Not available. No 60-row benchmark was run.

## Estimated Cost Comparison

Not available. No 60-row benchmark was run.

Reference prices requested for the future rerun:

| Model | Input / 1M | Cached input / 1M | Output / 1M |
| --- | ---: | ---: | ---: |
| `gpt-5-nano` | `$0.05` | `$0.005` | `$0.40` |
| `gpt-5.4-nano` | `$0.20` | `$0.02` | `$1.25` |

Cost comparison should not be computed until both effective model/reasoning configs are captured in run rows.

## Latency Comparison

Not available. No 60-row benchmark was run.

## Quality Comparison

Not available. No 60-row benchmark was run.

Quality comparison was intentionally blocked because an invalid Config B run would contaminate fallback, source, and final-answer safety comparisons.

## Q03 / Q04 / Q06 Comparison

Not available. No 60-row benchmark was run.

The latest known pre-A/B state remains the Q06-6 readiness context:

- Q03 revenue-driver work complete enough for Minimal Core rerun.
- Q04 driver-durability work complete enough for Minimal Core rerun.
- Q06 CAT wording/unit cleanup complete enough for Minimal Core rerun.
- Production was not deployed.

## Critical Safety Findings

No new runtime safety failures were observed because no live benchmark rows were generated.

Preflight safety finding:

- Config B cannot currently be verified as `gpt-5.4-nano` + `none`.
- Running it would create misleading benchmark artifacts.
- The current resolver would silently map `none` to `minimal`.

## Deployment Status

- Production deploy: not performed.
- Test Worker deploy: not performed.
- Wrangler dry-run only: performed against `workers/wrangler.test.toml`.

## Output Artifacts

Created:

- `docs/quality/V1_1_MODEL_AB_MINIMAL_CORE_60_REPORT.md`
- `docs/quality/V1_1_MODEL_AB_HUMAN_REVIEW_PACKET.md`
- `workers/testbench/reports/model-ab-minimal-core-60-comparison.json`

Not created because the full A/B was blocked:

- `workers/testbench/runs/2026-05-06-v1-1-minimal-core-60-gpt-5-nano-low.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-minimal-core-60-gpt-5-nano-low-summary.json`
- `workers/testbench/runs/2026-05-06-v1-1-minimal-core-60-gpt-5-4-nano-none.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-minimal-core-60-gpt-5-4-nano-none-summary.json`

## Required Next Step

Before the A/B can be run, choose one of these paths:

1. Add explicit test-only support for `OPENAI_REASONING_EFFORT=none`, including tests and effective reasoning-effort diagnostics in testbench rows.
2. Confirm that the intended `none` value should be represented differently in the OpenAI request contract, then update the benchmark spec.
3. If `none` is not supported for the selected API/model, choose a supported reasoning effort and rename Config B accordingly.

After that, run one-row smoke for both configs and only then run Minimal Core 60.

## Recommendation

`INCONCLUSIVE: CONFIG FAILED PREFLIGHT`
