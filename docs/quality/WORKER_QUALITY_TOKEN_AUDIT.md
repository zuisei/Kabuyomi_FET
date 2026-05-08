# Worker Quality Token Audit

Date: 2026-05-06 JST

## Current State

The Worker already logs model token usage through `llm_usage` and route/path diagnostics. Before this branch, benchmark rows could capture only limited token data and did not distinguish exact model usage from estimated context/source cost.

## Added Row Fields

Future testbench rows now reserve/persist:

- Exact token counts when the test Worker debug payload exposes them:
  - `promptTokenCount`
  - `completionTokenCount`
  - `totalTokenCount`
  - `modelCallLatencyMs`
- Source diagnostics:
  - `selectedSourceTypes`
  - `selectedSourceSectionFamilies`
- Follow-up/runtime diagnostics:
  - `runtimeQuestionIntent`
  - `rewrittenQuestion`
  - `contextApplied`
- Hard-intent retrieval aliases:
  - `hardIntentRetrievalMode`
  - `hardIntentRetrievalAddedSourceCount`
- `tokenAttribution`, with exact counts separated from estimates.

## Exact vs Estimated

Exact:

- `promptTokenCount`, `completionTokenCount`, and `totalTokenCount` are exact only when supplied by the provider usage payload and surfaced by test Worker debug metadata.

Estimated:

- `sourceChunkTokens` uses `selectedSourceCharCount / 4`.
- `conversationFollowupContextTokens` uses conversation context character count / 4.
- `systemPolicyPromptTokens` is an approximation from model request prompt chars minus selected source chars when available.
- `filingMetadataTokens` is a small row metadata estimate.
- `factualMetricsPackTokens` and `factualNarrativePackTokens` remain `null` until the context pack exposes those components separately.

## Production Gap

Normal production responses still omit debug fields. This branch does not leak debug data to normal users. Production token/source attribution should come from Worker logs or test Worker debug payloads, not the public production API response body.

## Next Audit Step

After test deployment, run a limited hard-intent subset against the test Worker and compare:

- fallback rate
- selected source family distribution
- XBRL vs narrative token share
- retry token cost
- p50/p95 latency
