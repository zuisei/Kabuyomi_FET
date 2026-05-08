# Kabuyomi v1.1 Model A/B Preflight Fix Report

Date: 2026-05-07

Branch: `v1.1-worker-quality-token-retrieval`

Starting HEAD: `ab996d1`

## Executive Summary

The model A/B preflight blocker is fixed.

The Worker now accepts `OPENAI_REASONING_EFFORT=none` explicitly, keeps invalid reasoning-effort values visible in diagnostics instead of silently making them look valid, and records requested/effective model config fields in debug and testbench rows.

One-row smoke succeeded for both requested configs at the configuration/API level:

- Config A: `gpt-5-nano` + `low`
- Config B: `gpt-5.4-nano` + `none`

Config B did not fail at the API/config layer. It reached the model with effective `gpt-5.4-nano` + `none`, returned token fields, and fell back via the existing quality guard (`low_quality_answer`). That is acceptable for preflight because the task was to verify that the config can be represented and measured before the full Minimal Core 60 A/B.

Recommendation: `READY FOR MINIMAL CORE 60 A/B`

## What Changed

### Reasoning effort support

Added explicit support for:

- `none`
- `minimal`
- `low`
- `medium`
- `high`

Invalid configured values now resolve to the safe default `minimal`, but the original requested value is retained in diagnostics with `reasoningEffortInvalid=true`.

### Responses API model override

The dashboard-prompt Responses API path now includes the configured model as a top-level `model` field alongside `prompt`.

This matters because the previous test showed that `reasoning.effort=none` was being evaluated against the prompt's default `gpt-5-nano` model, not the requested `gpt-5.4-nano` config. The OpenAI Responses API supports top-level `model`, `prompt`, and `reasoning` fields on response creation.

Reference: [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses)

### Effective config diagnostics

Added debug/testbench fields:

- `requestedModelName`
- `effectiveModelName`
- `requestedReasoningEffort`
- `effectiveReasoningEffort`
- `reasoningEffortInvalid`

These fields are copied into testbench rows, so future A/B runs can verify the actual config used per row.

## Smoke Commands

Both smoke runs used a temporary one-row AAPL Q03 question file to exercise the model path.

### Config A deploy

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5-nano \
  --var OPENAI_REASONING_EFFORT:low
```

Test Worker version ID:

`8ba232f9-7791-495a-b9f2-cabf294259aa`

### Config A smoke

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-07-v1-1-model-ab-smoke-gpt-5-nano-low-r2 \
KABUYOMI_TESTBENCH_TICKERS=AAPL \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-model-ab-q03-smoke.jsonl \
OPENAI_CHAT_MODEL=gpt-5-nano \
OPENAI_REASONING_EFFORT=low \
npm run testbench:run
```

Artifact:

- `workers/testbench/runs/2026-05-07-v1-1-model-ab-smoke-gpt-5-nano-low-r2.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-model-ab-smoke-gpt-5-nano-low-r2-summary.json`

### Config B deploy

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5.4-nano \
  --var OPENAI_REASONING_EFFORT:none
```

Test Worker version ID:

`6def560e-e9ae-4853-8bc8-22ab6bd56e28`

### Config B smoke

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-07-v1-1-model-ab-smoke-gpt-5-4-nano-none-r2 \
KABUYOMI_TESTBENCH_TICKERS=AAPL \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-model-ab-q03-smoke.jsonl \
OPENAI_CHAT_MODEL=gpt-5.4-nano \
OPENAI_REASONING_EFFORT=none \
npm run testbench:run
```

Artifact:

- `workers/testbench/runs/2026-05-07-v1-1-model-ab-smoke-gpt-5-4-nano-none-r2.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-model-ab-smoke-gpt-5-4-nano-none-r2-summary.json`

### Test Worker restore

After smoke, the test Worker was restored to the checked-in `wrangler.test.toml` config:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Restore version ID:

`25e0e172-7fed-48e4-9c88-e43d3d433cf8`

## Smoke Results

| Config | Case | Response path | Requested model | Effective model | Requested effort | Effective effort | Token fields | sourceIdsValid | Infra/API status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | `AAPL-Q03` | `openai` | `gpt-5-nano` | `gpt-5-nano` | `low` | `low` | present | `true` | clean |
| B | `AAPL-Q03` | `fallback` | `gpt-5.4-nano` | `gpt-5.4-nano` | `none` | `none` | present | `true` | clean API/config; quality fallback |

Config A row:

```json
{
  "responsePath": "openai",
  "requestedModelName": "gpt-5-nano",
  "effectiveModelName": "gpt-5-nano",
  "requestedReasoningEffort": "low",
  "effectiveReasoningEffort": "low",
  "promptTokenCount": 2619,
  "completionTokenCount": 552,
  "totalTokenCount": 3171,
  "sourceIdsValid": true
}
```

Config B row:

```json
{
  "responsePath": "fallback",
  "fallbackReason": "low_quality_answer",
  "lowQualityReason": "revenue_driver_declined_despite_context",
  "requestedModelName": "gpt-5.4-nano",
  "effectiveModelName": "gpt-5.4-nano",
  "requestedReasoningEffort": "none",
  "effectiveReasoningEffort": "none",
  "promptTokenCount": 2619,
  "completionTokenCount": 200,
  "totalTokenCount": 2819,
  "sourceIdsValid": true
}
```

## Tests Run

Required validation:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

Focused validation:

```bash
npm test -- openai
npm test -- benchmark-quality
npm test -- chat-diagnostics
```

Results:

- `npm run typecheck`: passed
- `npm test`: passed, 48 files / 582 tests
- `npm run dryrun:test`: passed
- `npm run testbench:validate`: passed
- focused `openai`: passed
- focused `benchmark-quality`: passed
- focused `chat-diagnostics`: passed

## Deploy Status

- Production deploy: not performed.
- Test Worker deploy: performed only against `workers/wrangler.test.toml`.
- Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Final deployed test Worker version after restore: `25e0e172-7fed-48e4-9c88-e43d3d433cf8`
- Push: not performed.

## Minimal Core 60 A/B Readiness

The Minimal Core 60 A/B can now proceed.

Important interpretation note:

- Config B is not blocked at config/API level.
- Config B's one-row smoke fell back through the existing quality guard.
- That should be evaluated in the full A/B as a model-quality outcome, not as a preflight failure.

The full A/B should still deploy/run each config separately and verify every row has matching requested/effective model config fields.

## Recommendation

`READY FOR MINIMAL CORE 60 A/B`
