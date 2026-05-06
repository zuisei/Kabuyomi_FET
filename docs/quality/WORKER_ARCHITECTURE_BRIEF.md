# Worker Architecture Brief

## 1. Executive summary

- The Worker entrypoint is `workers/src/index.ts`. It loads remote config on every request, serves a small pre-maintenance route set first, blocks most API routes when `maintenanceMode=true`, then dispatches normal API routes.
- The current `/v1/chat` pipeline is: strict request parse -> exact requested filing load -> identity/quota/credit charge -> short follow-up rewrite -> historical fast path -> deterministic fast path -> intent-aware context pack -> source sufficiency gate -> remote model or local fallback -> source validation/repair -> final grounding/language cleanup -> response/logging.
- The main retrieval constraint is asset shape, not just ranking. The primary filing cache only stores two first-class source chunk types: `md_a` paragraphs and `xbrl_metric` rows. Business, risk, segment, liquidity, and debt evidence are inferred from those chunks or synthesized as `CTX*` / `HARDCTX*` windows, not stored as first-class section assets.
- Current prod/test config points chat to OpenAI, not Gemini. `wrangler.toml` and `wrangler.test.toml` both set `LLM_PROVIDER=openai`, `OPENAI_CHAT_MODEL=gpt-5-nano`, `OPENAI_PROMPT_ID`, `OPENAI_PROMPT_VERSION=1`, `OPENAI_REASONING_EFFORT=minimal`, and `OPENAI_MAX_COMPLETION_TOKENS=1800`.
- Rich chat diagnostics exist, but they are split across two surfaces:
  - Worker logs are strong: `chat_path_decision`, `chat_quality_pipeline`, `chat_context_selection`, `llm_usage`, provider error logs.
  - HTTP responses are weak in production: `/v1/chat` only returns `debug` in test environments, so production smoke artifacts miss runtime `questionIntent`, token counts, source-gate results, and fallback taxonomy.
- Latest local artifacts show the same structural theme:
  - Minimal Core 60 (`appVersion=9723362`) has `sourceIdsValid=false` count `0`, but all hard-intent rows still fall back: revenue driver `5/5`, durability follow-up `5/5`, margin durability `5/5`.
  - Production smoke 20 (`appVersion=9723362`) is clean on source-id safety and rate limits, but it is observability-thin because prod responses omit `debug`; every fallback row shows `fallbackKind=none` in the artifact even though runtime finalizer/model-quality-control clearly support richer labels.

## 2. Route map

### 2.1 HTTP routes

| Path | Method | File / function | Purpose | Auth / device requirement | Affects credits / quota | Calls LLM | v1 public surface | Internal / test only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/legal/privacy` | `GET`, `HEAD` | `workers/src/routes/legal.ts` `handleLegalRoute` | API-hosted fallback legal copy | None | No | No | Public fallback page, but static legal site is preferred | No |
| `/legal/terms` | `GET`, `HEAD` | `workers/src/routes/legal.ts` `handleLegalRoute` | Terms fallback page | None | No | No | Public fallback page | No |
| `/legal/tokushoho` | `GET`, `HEAD` | `workers/src/routes/legal.ts` `handleLegalRoute` | Tokushoho fallback page | None | No | No | Public fallback page | No |
| `/legal/support` | `GET`, `HEAD` | `workers/src/routes/legal.ts` `handleLegalRoute` | Support page | None | No | No | Public fallback page | No |
| `/v1/search` | `GET` | `workers/src/routes/search.ts` `handleSearchRoute` | Search tickers from cached SEC snapshot | None | No | No | Yes | No |
| `/v1/company/:ticker` | `GET` | `workers/src/routes/company.ts` `handleCompanyRoute` -> `loadCompanyUsecase` | Load current company filing payload, summary, metrics, historicalOverview | `x-device-key` required | No direct stock/chat charge | No | Yes | No |
| `/v1/company/:ticker/refresh` | `POST` | `workers/src/routes/company.ts` `handleCompanyRoute` -> `refreshCompanyUsecase` | Force remote latest-filing check, with stale fallback on retryable SEC failures | `x-device-key` required | No direct stock/chat charge | No | Yes | No |
| `/v1/watchlist/add` | `POST` | `workers/src/routes/watchlist-add.ts` `handleWatchlistAddRoute` -> `addWatchlistTickerUsecase` | Save ticker and prepare latest filing, optionally async | `x-device-key` required | Yes, stock quota mutation/refund | No | Yes | No |
| `/v1/watchlist/remove` | `POST` | `workers/src/routes/watchlist-remove.ts` `handleWatchlistRemoveRoute` | Remove saved ticker / aliases | `x-device-key` required | Yes, stock quota mutation | No | Yes | No |
| `/v1/filing-prep/jobs/:id` | `GET` | `workers/src/routes/filing-prep-job.ts` `handleFilingPrepJobRoute` | Poll async filing preparation job | `x-device-key` required and must own job | No | No | Yes | No |
| `/v1/chat` | `POST` | `workers/src/routes/chat.ts` `handleChatRoute` -> `answerChatUsecase` | Filing-grounded Q&A | `x-device-key` required | Yes, 2 credits when credit billing is enabled, otherwise chat quota | Yes | Yes | No |
| `/v1/translate-quote` | `POST` | `workers/src/routes/translate-quote.ts` `handleTranslateQuoteRoute` | Translate short filing excerpts to Japanese | `x-device-key` required | Yes, 1 credit when credit billing is enabled | Yes | Public app route, but not part of the route list requested for the quality pass | No |
| `/v1/usage` | `GET` | `workers/src/routes/usage.ts` `handleUsageRoute` | Return quota/credit balances and saved tickers | `x-device-key` required | No mutation, but ensures monthly grant is applied | No | Yes | No |
| `/v1/ios/purchases/credits/complete` | `POST` | `workers/src/routes/credit-purchase-grant.ts` `handleCreditPurchaseGrantRoute` | Server-verify Apple consumable purchase and grant credits | `x-device-key` required, valid signed transaction required | Yes, purchased credit grant | No | Yes | No |
| `/v1/credits/purchase-grant` | `POST` | `workers/src/routes/credit-purchase-grant.ts` `handleCreditPurchaseGrantRoute` | Legacy alias for the same credit grant flow | `x-device-key` required | Yes, purchased credit grant | No | Backward-compatible public alias | No |
| `/v1/admob/reward-intents` | `POST` | `workers/src/routes/admob-rewards.ts` `handleAdMobRewardRoutes` | Create reward intent + custom data for rewarded ads | `x-device-key` required | Not immediately; eventual ad-credit grant | No | Worker-exposed, but rewarded UI is deferred in v1.0 | Not callback-only |
| `/v1/admob/reward-status` | `GET` | `workers/src/routes/admob-rewards.ts` `handleAdMobRewardRoutes` | Poll reward intent status | `x-device-key` required and must own intent | Reads ad-credit usage | No | Worker-exposed, but rewarded UI is deferred in v1.0 | No |
| `/v1/admob/ssv` | `GET` | `workers/src/routes/admob-rewards.ts` `handleAdMobRewardRoutes` | Google AdMob SSV callback verifier and grant path | Signature-verified callback; no device header on callback itself | Yes, grants promotional ad credits | No | Not intended as user-facing v1 surface | Callback-only |
| `/v1/billing/sync` | `POST` | `workers/src/routes/billing-sync.ts` `handleBillingSyncRoute` | Sync subscription entitlement from Apple transaction state | `x-device-key` required, billing payload required | Indirectly affects plan/quota identity, not chat credits directly | No | App-private operational surface; not a visible paid path in v1 | No |
| `/v1/internal/backfill/history` | `POST` | `workers/src/routes/internal-backfill-history.ts` `handleInternalBackfillHistoryRoute` | Backfill historical filings into D1/R2 archive | `x-internal-token` shared secret | No end-user credits | No | No | Yes |
| `/v1/internal/cleanup/filings` | `POST` | `workers/src/routes/internal-cleanup-filings.ts` `handleInternalCleanupFilingsRoute` | Cleanup archived filing storage and indexes | `x-internal-token` shared secret | No | No | No | Yes |
| `/v1/internal/credits/purchase-grant` | `POST` | `workers/src/routes/internal-credit-purchase-grant.ts` `handleInternalCreditPurchaseGrantRoute` | Internal purchased-credit grant path, optionally by `quotaSubject` | `x-internal-token` shared secret | Yes | No | No | Yes |
| `/v1/internal/eval/credits/grant` | `POST` | `workers/src/routes/internal-eval-credit-grant.ts` `handleInternalEvalCreditGrantRoute` | Grant eval credits to an `eval-*` device key | `x-eval-token` shared secret | Yes | No | No | Yes |

### 2.2 Route-level architecture notes

- `workers/src/index.ts` splits routes into:
  - `preMaintenanceRoutes`: legal + internal maintenance routes that remain reachable even when `maintenanceMode=true`
  - `apiRoutes`: normal public/app routes blocked by maintenance mode
- There is no router framework. Matching is manual and exact.
- The Worker does not generate request IDs today.

### 2.3 Scheduled work

- `workers/src/index.ts` `scheduled()` runs one cron (`0 18 * * *` in `wrangler.toml`).
- Scheduled tasks:
  - `refreshTickerSnapshot(env)` refreshes ticker search snapshot from the SEC fetcher.
  - `refreshTrackedFilings(env, config)` refreshes tracked filings.
- This is not part of the public HTTP surface, but it changes search freshness and available cached filings.

## 3. Chat pipeline map

| Step | Main code | Input -> output | Important config / env | Logs emitted | Common failure modes |
| --- | --- | --- | --- | --- | --- |
| 1. Request validation | `workers/src/routes/chat.ts` `handleChatRoute`; `workers/src/lib/request.ts` `parseJsonBody`; `workers/src/lib/contracts.ts` `ChatRequestSchema` | JSON body -> `{ filingKey, question, conversationContext?, operationId? }` | Max body `4096` bytes; `conversationContext` max `6`; message content max `420`; question max `1000` | None at parse time | `400` invalid payload, `413` too large, `415` wrong `Content-Type` |
| 2. Exact filing lookup | `workers/src/routes/chat.ts`; `workers/src/lib/filings/cache.ts` `loadFilingByKey`, `isCurrentCacheRecord` | `filingKey` -> exact archived `FilingCacheRecord` | Request must use current `extractorVersion` and `promptVersion`; no silent latest-filing substitution | None | `404` `Filing cache not found` when key missing/stale |
| 3. Identity resolution | `workers/src/lib/chat/usecase.ts` `answerChatUsecase`; `workers/src/lib/quota.ts` `readQuotaIdentity` | Request headers -> `quotaSubject`, `plan`, `identityKind` | Requires `x-device-key`; may resolve detached dev access or synced entitlement instead of free device identity | None directly | `400` missing device key; entitlement/device-binding lookup issues |
| 4. Filing preparation | `workers/src/lib/chat/usecase.ts` `prepareFilingForChat`; `workers/src/lib/filings/content-upgrade.ts` | Filing -> full-content record if possible, else metrics-only record plus background upgrade | If latest filing was ingested with `contentMode=metrics_only`, chat tries `upgradeMetricsOnlyRecord()` once and then `waitUntil(enqueueContentUpgrade)` | `chat_metrics_only_upgrade_failed` on upgrade failure | Metrics-only chat context, background upgrade lag |
| 5. Charge quota / credits | `workers/src/lib/chat/usecase.ts` `chargeChat`; `workers/src/lib/credit-operation.ts`; `workers/src/lib/quota.ts` | Identity -> chat quota mutation or billable credit mutation | `CHAT_CREDIT_COST=2`; `creditBillingEnabled` from remote config, overridden on detached `dev_unlimited` access | `credit_consume`, `quota_denial` | `402 insufficient_credits`; DO/D1 failures during quota mutation |
| 6. Follow-up rewrite | `workers/src/lib/chat/usecase.ts`; `workers/src/lib/chat/context.ts` `resolveContextualQuestion` | `question + conversationContext` -> rewritten standalone question or original question | No raw conversation is sent to the model; only the rewritten question survives | Logged later as `rewrittenQuestion`/`contextApplied` in `chat_quality_pipeline` | No anchor found; short follow-up remains ambiguous |
| 7. Intent classification | `workers/src/lib/chat/orchestrator.ts`; `workers/src/lib/chat/intent.ts` `classifyQuestionIntent` | Rewritten question -> one of the chat intents | Regex/keyword based | Logged in `chat_path_decision` and `chat_quality_pipeline` | Misclassification on vague or cross-intent questions |
| 8. Historical fast path | `workers/src/lib/chat/historical.ts`; `workers/src/lib/history-store.ts` | Historical question -> archive-backed comparison answer, degrade answer, or `null` | Uses D1+R2 archive; up to 3 years; background hydration when `executionContext` exists; autohydration timeout `6000ms` | `chat_historical_*` events, `chat_path_selected` on success | No bindings, no comparable prior filings, hydration timeout/failure, still-insufficient history |
| 9. Deterministic fast path | `workers/src/lib/chat/orchestrator.ts`; `workers/src/lib/chat/deterministic.ts` | Filing + question -> deterministic answer for supported heuristics | Business overview and revenue-driver answers let the model try first when a remote model is configured; margin/cash/change overviews often stay deterministic | `chat_path_selected`, `chat_path_decision` | No matching heuristic, insufficient metric/source support, overly metric-only results |
| 10. Context pack construction | `workers/src/lib/chat/model-attempt.ts`; `workers/src/lib/chat/context-pack.ts`; `context-profile.ts`; `context-factual-pack.ts` | Filing + intent -> `ChatContextPack { metrics, factualPack, sourceChunks, tokenBudget, diagnostics }` | Intent-specific token budgets `6000-10000`; expanded retry adds `+2000`; compact mode caps at `5500`; source excerpt caps `900-1800` chars | `chat_context_selection` | XBRL-heavy pack, weak narrative quality, no risk/business/liquidity windows |
| 11. Source sufficiency gate | `workers/src/lib/chat/source-gate.ts`; `workers/src/lib/chat/evidence-slots.ts` | Selected sources -> `SourceGateResult` + extracted evidence slots | Applied only to hard intents: `revenue_driver`, `driver_durability_followup`, `margin_durability_followup` | Captured in `chat_quality_pipeline` and debug fields | `driver_slots_empty`, `margin_driver_slots_empty`, `sector_required_source_missing`, `followup_target_empty`, `source_relevance_low` |
| 12. Hard-intent retrieval retry | `workers/src/lib/chat/model-attempt.ts`; `workers/src/lib/chat/hard-intent-retrieval.ts` | Insufficient hard-intent pack -> maybe expanded context with `CTX*` / `HARDCTX*` sources | `HARD_INTENT_TARGETED_RETRIEVAL_MODE` = `diagnostic` in current env; active mode can add up to `3` sources and `3000` chars | Additional `chat_context_selection`; hard retrieval fields in debug/log payloads | In current env it is mostly observability only; even in active mode it can only re-slice existing `mdaText`/source chunks |
| 13. Model call | `workers/src/lib/chat/model-attempt.ts` -> `workers/src/clients/llm/provider.ts` -> OpenAI or Gemini client | Context pack -> `GeminiChatAnswer`-shaped model response | Current env: `LLM_PROVIDER=openai`; prompt is shared prompt string; OpenAI may use dashboard prompt ID/version; `OPENAI_REASONING_EFFORT=minimal`; `OPENAI_MAX_COMPLETION_TOKENS=1800` | `openai_request_*` or `gemini_request_*`; `llm_usage` later | Timeout, rate limit, auth error, schema-invalid JSON, weak grounded answer |
| 14. High-level retry | `workers/src/lib/chat/model-attempt.ts`; `workers/src/lib/chat/model-retry.ts`; `workers/src/lib/chat/route-policy.ts` | First model response -> optional one retry with expanded/standard/compact context | Max one retry; disabled for hard intents; disabled for timeout/API/metrics-only cases | `chat_model_retry`, retry fields in `chat_quality_pipeline` | Retry wasted, blocked, or still falls back |
| 15. Source validation / repair | `workers/src/lib/chat/source-validation.ts`; `workers/src/lib/chat/orchestrator.ts` | Model `sourceIds` -> approved source list or guarded fallback | Model may cite only IDs present in current context pack or local filing fallback set | `chat_grounding_repair_used` | Invalid source IDs, no approved IDs, weak-model-source recovery |
| 16. Local / evidence fallback | `workers/src/lib/chat/fallback-response.ts`; `workers/src/lib/chat/evidence-fallback.ts`; `workers/src/lib/chat/orchestrator.ts` | Failure/insufficiency -> filing-grounded fallback answer when possible | Hard-intent insufficient path prefers evidence-slot fallback; schema/API failures can use local Gemini-style fallback with `GEMINI_API_KEY` removed | `openai_fallback_used` / `gemini_fallback_used`, `chat_path_selected` | Generic wording, empty driver slots, source-insufficient caveats |
| 17. Final grounding, cleanup, response | `workers/src/lib/chat/response-finalizer.ts`; `workers/src/lib/chat/final-answer-language.ts`; `workers/src/lib/chat/usecase.ts` | Chat payload -> final HTTP body | Web supplement branch exists but `webSupplementEnabled=false` by default; test env only exposes `debug` block | `chat_request`, `chat_quality_pipeline`; earlier `chat_path_decision`/`llm_usage` already fired | `502` if no filing-grounded source survives; language-guard fallback on English leakage; refund on non-chargeable path or generation failure |

### 3.1 Response payload shape

Successful `/v1/chat` returns:

```json
{
  "answer": "string",
  "sources": [],
  "responsePath": "deterministic | fallback | historical | gemini | openai",
  "modelName": "string | null",
  "usage": {
    "...": "quota and credit balances",
    "creditBillingEnabled": true
  },
  "creditsCharged": 0,
  "creditsRemaining": 0
}
```

Notes:

- `debug` is only attached in test environments (`env.KABUYOMI_ENV === "test"` or `env.ENVIRONMENT === "test"`).
- In production, token/debug fields are logs-only, not response fields.

## 4. Retrieval / source selection map

### 4.1 Source asset types in the current Worker

- First-class filing cache chunk types (`workers/src/env.ts`, `workers/src/lib/filings/ingest.ts`):
  - `md_a`
  - `xbrl_metric`
- Chat response source kinds (`workers/src/lib/chat/grounding.ts`):
  - `sec_filing`
  - `historical_filing`
  - `web_supplement`
- Synthetic chat-only chunks:
  - `CTX*`: supplemental context windows created during context-pack expansion
  - `HARDCTX*`: targeted MD&A windows created by hard-intent retrieval

### 4.2 Where filings and source material come from

- Ticker search and ticker lookup use a cached SEC snapshot in KV, refreshed by cron.
- Filing metadata and assets come through the external SEC fetcher service:
  - `/internal/sec/submissions`
  - `/internal/sec/metrics`
  - `/internal/sec/filing`
  - `/internal/sec/filing-assets`
  - `/internal/sec/prepared-filing`
- Ingest path:
  1. `ensureLatestFiling()` picks the latest supported `10-K` / `10-Q`.
  2. `ingestFiling()` loads either:
     - a prepared filing from the fetcher with precomputed `mdaText`, or
     - raw HTML plus metrics, then runs local MD&A extraction.
  3. `buildSourceChunks()` turns the filing into up to 8 MD&A chunks plus one XBRL chunk per metric.

### 4.3 Are MD&A / Risk / Business / XBRL represented separately?

- `MD&A`: yes, as first-class `md_a` chunks and `filing.mdaText`.
- `XBRL`: yes, as first-class `xbrl_metric` chunks and `filing.metrics`.
- `Business`: no first-class section asset. Business answers depend on:
  - `factualPack` extraction
  - MD&A chunks
  - synthesized segment/revenue context windows
- `Risk Factors`: no first-class section asset in `FilingCacheRecord`. Risk answers depend on:
  - MD&A chunks
  - synthesized `CTX*` risk windows when available
  - factual-pack heuristics
- `Segment Information`, `Revenue Note`, `Liquidity MD&A`, `Debt Note`: also not first-class stored section families today.

### 4.4 How section labels are determined

- `buildSourceChunks()` assigns:
  - MD&A chunks: `10-K Item 7, filed <date>` or `10-Q Part I Item 2, filed <date>`
  - XBRL chunks: `XBRL <metricLabel> (<tagUsed>)`
- Supplemental context builders create human-readable labels like:
  - `10-Q Segment and revenue context, filed ...`
  - `10-Q Risk factors context, filed ...`
  - `10-K hard-intent targeted MD&A context, filed ...`

### 4.5 How sources are ranked and selected

- The context pack algorithm is strongly intent-aware:
  1. derive `contextProfile(intent, mode)` for token/source caps
  2. select intent metrics
  3. build `factualPack`
  4. rank narrative/XBRL candidates with `intentSourceScore()`
  5. filter weak or off-intent narratives with text-quality heuristics
  6. add supplemental windows when needed
  7. guarantee at least one MD&A narrative when possible
  8. trim to token budget using `chars / 4` estimation

- Selection budgets in standard mode:
  - `risk_factors`: `tokenBudget=10000`, `minSources=5`, `maxSources=7`
  - `mda_summary`: `9000`, `4`, `7`
  - `segment_analysis`: `8000`, `4`, `7`
  - `business_overview`: `7000`, `5`, `7`
  - `revenue_breakdown`: `7000`, `3`, `7`
  - `yoy_change`: `8000`, `4`, `7`
  - `margin_profitability`, `cash_flow`, `historical_comparison`, `unknown`: `6000`, `2`, `6`

- Ingest-time caps:
  - MD&A paragraphs are truncated to `900` chars each.
  - At most `8` MD&A chunks are stored.
  - Fallback paragraph splitter uses up to `1100` chars per fallback chunk.

### 4.6 How previous-filing sources are selected

- Explicit broader historical questions go through the archive path first:
  - `history-store.ts` detects historical questions.
  - It loads D1/R2 archived metrics and highlights for up to `3` years.
  - For `10-K`, it uses the prior annual filings.
  - For `10-Q`, it looks for same-quarter matches within `45` days.
- If history is missing and `executionContext` exists, background autohydration is enqueued and the user can get a non-chargeable degrade answer.
- If historical fast path returns `null`, the normal model/deterministic path still runs against the current filing only.

### 4.7 How specific question families are handled

#### How the Worker decides to include MD&A

- MD&A is preferred for `yoy_change` and `mda_summary`.
- If no narrative source has been selected, `buildChatContextPack()` explicitly backfills the first non-off-intent `md_a` chunk before falling back to generic source filling.
- For hard intents, targeted retrieval can synthesize extra MD&A windows from `filing.mdaText` as `HARDCTX*`.

#### Revenue driver questions

- Runtime intent usually becomes `yoy_change`.
- `shouldLeadWithDriverNarrative()` makes MD&A-style narrative lead over pure metrics.
- `source-gate.ts` reinterprets these as hard intent `revenue_driver`.
- Source sufficiency requires:
  - some metric movement
  - at least one company-specific driver
- If that fails, the system records sector-specific missing source types and usually falls back to evidence-slot wording.

#### Margin questions

- Directional margin questions are often handled deterministically from XBRL revenue + profit metrics.
- Durability follow-ups (`一時要因? 構造的?`) are treated as hard intent `margin_durability_followup`.
- That path needs explicit profitability/cost/mix/provision-style narrative evidence; otherwise it degrades to a guarded fallback that states the driver is not sufficiently identified.

#### Risk questions

- `risk_factors` gets the largest context budget.
- Ranking looks for `Item 1A`, `risk factors`, and risk-pattern text.
- There is a `risk_secondary` strategy when no primary ranked risk source is found.
- Because risk is not a first-class stored section family, answer quality depends heavily on whether synthetic `CTX*` windows actually capture substantive risk text.

#### Liquidity / cash-flow questions

- Cash-flow questions are usually classified as `cash_flow`, which leads with metrics and liquidity/capital-resources patterns.
- There is no dedicated runtime `liquidity_debt` intent; that name exists in the benchmark taxonomy, not the runtime classifier.
- Final cleanup has a dedicated `cleanLiquidityDebtAnswer()` guard that refuses to overstate solvency if the answer lacks cash / debt / liquidity evidence.

#### Prior filing comparison

- Best-case path: historical archive route, using D1/R2 historical rows and optional segment highlights.
- Common fallback path: the current filing’s XBRL comparison values or current-filing narrative only, if historical archive coverage is missing or insufficient.
- This means “prior filing comparison” quality currently depends on whether historical artifacts already exist, not only on prompt quality.

#### Follow-up questions like `その要因は？`

- Conversation context is not sent verbatim to the model.
- Instead, `resolveContextualQuestion()` rewrites short follow-ups using:
  - anchor detection from recent user/assistant messages
  - limited driver extraction from the last assistant answer
- Example rewrites:
  - `なぜ？` -> `営業CFが変化した理由は？`
  - durability follow-up -> a fuller sentence that includes the prior driver when recoverable
- If prior driver extraction fails, hard-intent follow-up gating deliberately returns a limitation instead of hallucinating a durability classification.

### 4.8 Known code-level retrieval weaknesses

- The filing cache does not preserve first-class Business / Risk Factors / Segment / Liquidity / Debt sections.
- Hard-intent retrieval is bounded to the existing filing asset pool. It cannot fetch section-indexed assets that were never stored.
- Production smoke rows show many fallback answers with selected sources that are still mostly XBRL-only for hard-intent cases.
- Risk answers can depend on synthetic context windows rather than canonical risk sections.
- Runtime intent-aware diagnostics exist, but current production smoke artifacts cannot see them.

## 5. Prompt / model / token map

### 5.1 Provider and model selection

- Provider switch: `workers/src/clients/llm/provider.ts` `resolveLlmProvider()`
  - `openai`
  - `gemini-legacy`
  - `disabled`
  - `"gemini"` is normalized to `"gemini-legacy"`
- Current checked-in env:
  - `workers/wrangler.toml`: `LLM_PROVIDER="openai"`, `OPENAI_CHAT_MODEL="gpt-5-nano"`
  - `workers/wrangler.test.toml`: same
- Gemini legacy models remain available for fallback/local paths:
  - chat default: `gemma-4-31b-it`
  - translation default: `gemma-4-26b-a4b-it`

### 5.2 Prompt construction

- Chat prompt builder: `workers/src/clients/gemini/prompts.ts` `buildChatPrompt()`
- OpenAI uses the same prompt content as Gemini.
- Prompt style today:
  - no separate system/developer message layering at API-call time
  - one long policy-heavy prompt string
  - JSON-only answer contract: `{ answer, sourceIds }`
- OpenAI dashboard prompt support:
  - `OPENAI_PROMPT_ID`
  - `OPENAI_PROMPT_VERSION`
  - variables built by `buildChatPromptTemplateVariables()`
  - if prompt ID is set, OpenAI uses `/v1/responses`; otherwise it uses `/v1/chat/completions`

### 5.3 What gets sent to the model

- Filing metadata JSON
- `Factual metrics pack` JSON
- `Factual pack` JSON
- `Sources` JSON from the context pack
- Rewritten standalone question
- Intent-specific answer format instruction
- Optional retry instruction

Important design detail:

- Raw conversation history is not sent to the model.
- Only the rewritten question, produced before orchestration, survives into the prompt.

### 5.4 Token estimation and actual token logging

- Preflight estimates are approximate:
  - context estimates use `chars / 4`
  - provider-error diagnostics also store `prompt.length / 4`
- Ingest-time `mdaTokenCount` comes from MD&A extraction, not from the model provider.
- Actual provider usage:
  - OpenAI chat/completions: `prompt_tokens`, `completion_tokens`, `total_tokens`
  - OpenAI responses API: `input_tokens`, `output_tokens`, `total_tokens`
  - Gemini legacy: `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`
- Actual token fields are logged in:
  - `workers/src/lib/llm-usage.ts` `logLlmUsage()` -> `llm_usage`
  - `workers/src/lib/chat/decision-log.ts` `logChatPathDecision()` -> `chat_path_decision`

Current observability gap:

- `chat_quality_pipeline` does not include actual provider token counts.
- `run-benchmark.mjs` has fields for them, but the API response does not expose them, so latest row artifacts keep them `null`.
- If a later reviewer wants token counts in benchmark rows without log scraping, the first place to extend is `workers/src/lib/chat/diagnostics.ts` `buildChatQualityPipelinePayload()`.

### 5.5 Timeouts, retries, and max output

- OpenAI:
  - env timeout in checked-in Wrangler config: `OPENAI_TIMEOUT_MS=20000`
  - code fallback default: `12000ms`
  - `OPENAI_REASONING_EFFORT=minimal`
  - `OPENAI_MAX_COMPLETION_TOKENS=1800`
  - no internal network retry loop in the OpenAI request layer
- Gemini legacy:
  - generic timeout default `12000ms`
  - chat timeout env in checked-in config `7000ms`
  - schema attempt then no-schema attempt for chat
- Higher-level model retry:
  - max one retry
  - disabled for hard intents
  - disabled for timeout / API-error / metrics-only reasons

### 5.6 Fallback naming note

- Even on the OpenAI path, compatibility naming still uses legacy reason strings like `gemini_timeout` and `gemini_api_error`.
- This is deliberate compatibility behavior, but it is confusing for new reviewers.

## 6. Fallback / deterministic paths

| Path | Trigger | Main code | Grounding behavior | User-visible format | Risk level | Common labels / reasons |
| --- | --- | --- | --- | --- | --- | --- |
| Historical | Historical question with archive coverage | `historical.ts`, `history-store.ts` | Uses archived historical filing sources | Comparative answer with historical sources | Low if archive exists | `historical`, `chargeable=false` on degrade path |
| Deterministic metric/business/cash/change | Pattern-matched question with enough filing facts | `deterministic.ts` | Filing-grounded from XBRL and/or factual pack / MD&A chunks | Natural Japanese short answer | Medium when only metrics exist | `deterministic`, strategy-specific |
| Primary remote model | Normal model path with valid cited source IDs | `model-attempt.ts` + provider client | Uses selected context pack and validated source IDs | Natural Japanese model answer | Medium | `openai` or `gemini` responsePath |
| Deterministic business-overview repair | Remote answer is weak/generic for business overview | `orchestrator.ts` | Replaces weak model answer with deterministic business answer | Direct business summary | Low-medium | `deterministic_repair`, `weak_business_overview_answer` |
| Evidence-slot fallback | Hard-intent source gate fails or driver slots are empty | `model-attempt.ts`, `evidence-fallback.ts` | Uses filing metrics + extracted evidence slots only | Structured “what is known / what is missing” style fallback | Medium, but safest hard-intent fallback today | `evidence_slot`, `source_gate_failed`, `driver_slots_empty`, `margin_driver_slots_empty` |
| Local fallback after provider/schema failure | Provider timeout/API/schema/local path | `fallback-response.ts`; provider clients’ local fallback helpers | Filing-grounded local answer, then source validation | General fallback answer | Medium-high if source pack is thin | `schema_invalid`, `json_parse_failed`, `gemini_timeout`, `gemini_api_error`, `low_quality_answer` |
| Invalid source-id guarded fallback | Model cites invalid IDs | `orchestrator.ts` + `source-validation.ts` | Filters IDs, then either local fallback or reduced safe source list | Explicit switch to safer answer | Low | `invalid_source_id`, `filtered_invalid_source_ids` |
| Context-unavailable fallback | No usable cited sources, or explicit unavailable answer | `orchestrator.ts`, `response-finalizer.ts` | May recover to local fallback, else returns guarded unavailable wording | “Cannot confirm from this filing context” wording | Low | `no_sources`, `metrics_only_insufficient`, `context_unavailable` |
| Weak-grounding fallback | Model answer grounded only by weak/boilerplate narrative | `orchestrator.ts`, `deterministic.ts` | Local fallback or guarded source-insufficient answer | Safer but less specific | Medium | `weak_grounding` |
| Low-quality fallback | Remote answer generic / wrong lead / banned pattern | provider clients + finalizer + cleanup guards | Replaces weak model answer with filing-first fallback | Safer but sometimes template-like | Medium | `low_quality_answer`, `answer_too_metric_only`, `language_guard` |
| Language-guard fallback | Final answer leaks English/raw excerpt/banned wording | `final-answer-language.ts`, `response-finalizer.ts` | Rewrites to Japanese guardrail answer; keeps filing sources | Explicit Japanese limitation statement | Low | `language_guard_fallback`, `final_answer_language_violation`, `raw_english_excerpt` |

Specific guardrails requested in the discovery prompt are present:

- Source sufficiency fallback: yes, mainly via evidence-slot and finalizer cleanup guards.
- Schema/validation fallback: yes, provider schema mismatch and invalid-source repair.
- Timeout/rate-limit fallback: yes, provider errors route to local fallback/evidence fallback.
- Low-quality answer fallback: yes, both provider client and finalizer side.
- Final Japanese-only guard: yes, `checkFinalAnswerJapaneseOnly()` and `buildJapaneseLanguageGuardFallback()`.
- Source ID invalid handling: yes, `validateModelSources()` plus orchestrator repair.
- Raw English suppression: yes, finalizer + language guard.

## 7. Quality / testbench system

### 7.1 Current benchmark layers

- Newer benchmark harness:
  - `workers/testbench/`
  - default company set: `workers/testbench/company-sets/minimal-5.json`
  - default question set: `workers/testbench/questions/core-12.jsonl`
- Older eval harness still present:
  - dataset: `workers/eval/chat-quality-v1.jsonl`
  - validator: `workers/scripts/validate-chat-eval.mjs`
  - archived runs: `workers/eval/runs/*.jsonl`

### 7.2 How Minimal Core 60 is defined

- Default company set: 5 tickers
  - `AAPL`
  - `JPM`
  - `XOM`
  - `CAT`
  - `WMT`
- Default question set: 12 templates (`Q01`-`Q12`)
- Cross product:
  - `5 tickers x 12 questions = 60 rows`

### 7.3 How Production Smoke 20 is defined

- There is no separate checked-in “smoke 20” question-set file.
- From the saved artifact shape, the current `production-smoke-20` run looks like the first 20 rows of the same `minimal-5 x core-12` cross product, limited to `AAPL` and `JPM`.
- This is an inference from the artifact, not a checked-in benchmark contract.

### 7.4 Testbench runner and summary flow

- Validate benchmark contract:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run testbench:validate
```

- Run benchmark against test Worker:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
KABUYOMI_TESTBENCH_DETACHED_ACCESS=dev_unlimited \
npm run testbench:run
```

- Summarize a saved run:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run testbench:summarize -- ./testbench/runs/<run-id>.jsonl
```

### 7.5 What each benchmark row captures

- Bench metadata:
  - `runId`, `appVersion`, `ticker`, `filingKey`, `caseId`, `templateId`
- Prompt/question metadata:
  - benchmark `intent`
  - `question`
  - `conversationContext`
  - `expectedSourceSections`
  - `goldChecklist`
  - `mustAvoid`
- Worker output:
  - `answer`
  - `sources`
  - `responsePath`
  - `fallbackReason`
  - `modelName`
  - `usage`
  - `creditsCharged`, `creditsRemaining`
- Debug-derived fields when available:
  - `selectedSourceIds`, `selectedSourceLabels`, `selectedSourceCount`, `estimatedContextTokens`
  - source-gate, retry, hard-retrieval, language-guard fields
- Benchmark execution fields:
  - `latencyMs`
  - infra contamination flags
  - rate-limit retry counts
- Human review fields:
  - `answerRating`
  - `failureLabelsObserved`
  - `notes`

### 7.6 How source ID validation and failure labels work

- Runtime source ID validation:
  - `workers/src/lib/chat/source-validation.ts`
  - exposed to benchmark rows through `payload.debug?.sourceIdsValid` when debug is available
- Summary-side auto labels:
  - `workers/testbench/scripts/summarize-runs.mjs`
  - combines manual `failureLabelsObserved` with auto heuristics
- Benchmark-level contamination logic:
  - `workers/testbench/scripts/benchmark-quality.mjs`
  - separates infra errors from quality-evaluable rows

### 7.7 Current artifact types

- Testbench row files: `workers/testbench/runs/*.jsonl`
- Testbench summary JSON: `workers/testbench/runs/*-summary.json`
- Handwritten run reports: `workers/testbench/reports/*.md`
- Older eval runs: `workers/eval/runs/*.jsonl`

### 7.8 Token fields, selected-source fields, human ratings

- Token fields exist in the schema/harness, but latest saved testbench artifacts do not populate them.
- Selected source IDs/labels are present in current latest artifacts.
- `selectedSourceCount` depends on debug availability:
  - present in the latest test-worker 60-row artifact
  - absent in the latest production smoke 20 artifact
- Human rating fields exist, but current latest testbench artifacts leave them empty.

## 8. Latest artifact inventory

### 8.1 Current local artifacts worth using

- `workers/testbench/runs/2026-05-05-v1-safety-minimal-core-60-row.jsonl`
- `workers/testbench/runs/2026-05-05-v1-safety-minimal-core-60-row-summary.json`
- `workers/testbench/runs/2026-05-05-v1-safety-production-smoke-20.jsonl`
- `workers/testbench/runs/2026-05-05-v1-safety-production-smoke-20-summary.json`
- `workers/testbench/reports/2026-05-02-pr4-hard-intent-retrieval.md`
- `workers/testbench/reports/2026-05-02-pr4b-benchmark-rate-limit-control.md`

### 8.2 Minimal Core 60 summary

Artifact:

- `workers/testbench/runs/2026-05-05-v1-safety-minimal-core-60-row.jsonl`
- `workers/testbench/runs/2026-05-05-v1-safety-minimal-core-60-row-summary.json`
- `appVersion=9723362`

Inventory summary:

- rows: `60`
- sourceIdsValid false: `0`
- responsePath:
  - `openai: 32`
  - `fallback: 19`
  - `deterministic: 9`
- fallback reasons:
  - `low_quality_answer: 17`
  - `weak_grounding: 2`
- fallback kinds:
  - `evidence_slot: 15`
  - `weak_grounding: 2`
  - `low_quality: 1`
  - `language_guard_fallback: 1`
- retry:
  - `retryAttempted: 4`
  - `retryWasted: 3`
- latency:
  - `p50: 3365ms`
  - `p95: 6415ms`
  - `p99: 9028ms`

Field availability:

- token fields populated: `0/60`
  - `promptTokenCount`
  - `modelRequestEstimatedTokens`
  - `geminiRequestEstimatedTokens`
- selected-source fields:
  - `selectedSourceLabels`: `60/60`
  - `selectedSourceIds`: `60/60`
  - `selectedSourceCount`: `51/60`

Intent-level weakness pattern:

- `revenue_driver`: `5/5` fallback
- `driver_durability_followup`: `5/5` fallback
- `margin_durability_followup`: `5/5` fallback
- `risk_summary`: `2/5` fallback, including one language-guard case
- `liquidity_debt`: `1/5` fallback

Most useful suspect-row cluster:

- `AAPL-Q03/Q04/Q06`
- `JPM-Q03/Q04/Q06`
- `XOM-Q03/Q04/Q06`
- plus additional risk/liquidity/segment cases such as `XOM-Q10`, `AAPL-Q08`

What the suspect rows point to:

- hard-intent rows still collapse into “driver not sufficiently identified” language
- selected sources in those rows are often dominated by XBRL plus thin narrative context
- source-gate and evidence-slot fallbacks are behaving as designed, but the upstream evidence asset is still too thin

### 8.3 Production Smoke 20 summary

Artifact:

- `workers/testbench/runs/2026-05-05-v1-safety-production-smoke-20.jsonl`
- `workers/testbench/runs/2026-05-05-v1-safety-production-smoke-20-summary.json`
- `appVersion=9723362`

Inventory summary:

- rows: `20`
- tickers: `AAPL`, `JPM`
- sourceIdsValid false: `0`
- responsePath:
  - `openai: 10`
  - `fallback: 7`
  - `deterministic: 3`
- raw fallback total: `7`
- infra contamination: `false`
- latency:
  - `p50: 3053ms`
  - `p95: 5777ms`
  - `p99: 7101ms`

Fallback rows are:

- `AAPL-Q03` `revenue_driver`
- `AAPL-Q04` `driver_durability_followup`
- `AAPL-Q06` `margin_durability_followup`
- `AAPL-Q08` `segment_driver`
- `JPM-Q03` `revenue_driver`
- `JPM-Q04` `driver_durability_followup`
- `JPM-Q06` `margin_durability_followup`

Field availability gap:

- `fallbackKind none on fallback rows: 7`
- `fallbackReason`: empty for all 20 rows
- `sourceIdsValid`: empty for all 20 rows
- `selectedSourceCount`: empty for all 20 rows
- token fields: empty for all 20 rows
- cause: production `/v1/chat` response does not include `debug`, so the benchmark cannot persist runtime diagnostics from the HTTP payload alone

Interpretation:

- This smoke file is useful as a release-surface sanity check.
- It is not sufficient for detailed quality diagnosis because the most important debug fields are missing.
- `sourceIdsValid false = 0` in this artifact should therefore be read cautiously; it mostly reflects absent debug fields, not a positive confirmation that every row carried validated source-ID telemetry.

### 8.4 Older report files

- The latest Markdown reports under `workers/testbench/reports/` are from `2026-05-02`, not `2026-05-05`.
- They are still useful for architecture context, but they describe earlier test-worker runs and should not be treated as current-head truth without cross-checking the newer `2026-05-05` artifacts.

### 8.5 Older eval artifacts

- `workers/eval/chat-quality-v1.jsonl` is a separate 50-row static dataset:
  - 5 tickers: `AAPL`, `MSFT`, `NVDA`, `AMZN`, `GOOGL`
  - 10 questions each
- `npm run eval:chat:validate` validates that dataset only.
- Useful as an older fixed rubric, but it is not the same as the newer 60-row testbench contract.

## 9. Credit / billing interaction

### 9.1 Chat credit consume/refund order

For `/v1/chat`:

1. Resolve identity with `readQuotaIdentity()`
2. Decide `creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity)`
3. If billing is off:
   - call `consumeChatQuota()`
4. If billing is on:
   - call `consumeBillableCredits()` with `creditsRequired=2`
   - reference `{ type: "chat", id: filingKey }`
5. Run the chat pipeline
6. Refund conditions:
   - generation throws -> refund via `refundChat()`
   - final response has `chargeable === false` -> refund via `refundChat()`

### 9.2 Which chat answers still consume credits

- Normal successful answers: yes
  - remote OpenAI answers
  - deterministic answers
  - most fallback answers
- Non-chargeable answers: only when the response explicitly sets `chargeable === false`
  - current code does this on historical degrade responses when history prep is unavailable/incomplete
- Answer failures that throw after charge: refunded

### 9.3 Usage endpoint behavior

- `/v1/usage` calls `loadUsage()`
- `loadUsage()` currently means `ensureMonthlyCreditGrant()`
- Returned credit buckets include:
  - `monthlyRemaining`
  - `monthlyLimit`
  - `rewardedAdRemaining`
  - `rewardedAdExpiresAt`
  - `purchasedRemaining`
  - `totalRemaining`
- Route adds `creditBillingEnabled` to the payload

### 9.4 Purchased / free / ad credit split

- Monthly/free-plan or subscription-plan credits:
  - tracked as monthly balance
- Purchased credits:
  - tracked separately as purchased balance
- Rewarded ad credits:
  - tracked separately with expiry metadata
- `totalRemaining = monthly + purchased + rewardedAd`

### 9.5 Billing-related logs

- `credit_consume`
- `credit_refund`
- `credit_purchase_grant`
- `credit_eval_grant`
- `rewarded_ad_credit_granted`
- `credit_monthly_grant`
- `quota_denial`
- `chat_non_chargeable_refunded`
- `chat_quota_refund_failed`
- `chat_non_chargeable_refund_failed`

## 10. Observability / logging fields

### 10.1 Fields that already exist

| Field | Where it exists today | Notes |
| --- | --- | --- |
| `ticker` | `chat_request`, `chat_context_selection`, `chat_path_decision`, `chat_quality_pipeline`, `llm_usage` | Good coverage |
| `filingKey` | same as above | Good coverage |
| `rewrittenQuestion` | `chat_quality_pipeline` | Not returned in prod response |
| `questionIntent` | `chat_path_decision`, `chat_quality_pipeline` | Not persisted into current benchmark row schema as a runtime field |
| `selectedSourceCount` | `chat_context_selection`, `chat_path_decision`, `chat_quality_pipeline`, test-worker `debug` | Missing in prod smoke payloads |
| `selectedSourceCharCount` | same | Missing in prod smoke payloads |
| `estimatedContextTokens` | same | Approximate only |
| `promptTokenCount` | `llm_usage`, `chat_path_decision` | Not present in `chat_quality_pipeline` |
| `candidatesTokenCount` | `llm_usage`, `chat_path_decision` | Same |
| `totalTokenCount` | `llm_usage`, `chat_path_decision` | Same |
| `latencyMs` | `chat_request`, `chat_quality_pipeline`, `chat_path_decision`, `llm_usage` | Good coverage |
| `fallbackReason` | `chat_path_decision`, `chat_quality_pipeline`, debug | Missing in prod smoke artifact |
| `responsePath` | response body, `chat_path_decision`, `chat_quality_pipeline` | Good |
| `sourceIdsValid` | `chat_path_decision`, `chat_quality_pipeline`, debug | Good in test-worker artifacts |
| Failure labels | `answerQualityFlags`, `sourceGateFailureLabels`, `fallbackCategory`, `fallbackUserReason` in `chat_quality_pipeline` | Not exposed in prod response |
| Provider errors | `openai_request_failed`, `gemini_request_failed`, provider error diagnostics in debug | Good in logs |
| Retry fields | `chat_model_retry`, `chat_quality_pipeline`, `chat_path_decision` | Good in logs/test-worker debug |

### 10.2 Fields that are missing or weak

| Gap | Best place to add later |
| --- | --- |
| Request ID / correlation ID | Add at HTTP entry in `workers/src/index.ts` `fetch()` and thread through `answerChatUsecase()` / `logEvent()` payloads |
| Runtime `questionIntent` in benchmark rows | Add to `workers/testbench/scripts/run-benchmark.mjs` from `payload.debug?.questionIntent` when using the test worker |
| Actual provider token counts in `chat_quality_pipeline` | Extend `workers/src/lib/chat/diagnostics.ts` `buildChatQualityPipelinePayload()` |
| Production-smoke access to source-gate/fallback taxonomy | Either add a log-export step keyed by request/run metadata, or create a smoke-only debug surfacing mode; current prod response omits these fields by design in `workers/src/lib/chat/usecase.ts` |
| Retry count + token cost together in a single row artifact | Join `chat_model_retry`, `llm_usage`, and `chat_path_decision`, or emit a richer quality-pipeline payload |

## 11. Known weak spots

1. Hard-intent driver questions are still asset-limited. The latest 60-row artifact shows complete fallback on all revenue-driver and durability follow-up rows.
2. Business, risk, segment, liquidity, and debt evidence are not first-class stored source families. They are reconstructed from MD&A/XBRL or synthetic windows.
3. Production benchmark artifacts are missing the most valuable debug fields because `/v1/chat` only exposes `debug` in test environments.
4. Conversation follow-up handling is heuristic and text-based. It depends on anchor detection and weak driver extraction from the previous assistant answer.
5. Historical comparison quality depends on whether D1/R2 historical artifacts already exist. Without them, the user gets a degrade answer or a current-filing-only path.
6. OpenAI paths still reuse legacy `gemini_*` fallback naming. This preserves compatibility but complicates analysis.
7. Current testbench rows do not store the runtime classifier result, only the benchmark template intent.
8. `webSupplementEnabled` is `false` by default, so the current v1 architecture is effectively filing-only even though the codebase still contains a web supplement branch.

## 12. Suggested next audit / test pass

Recommended next review task for a stronger GPT Pro / Opus pass:

1. Stay read-only and use the `2026-05-05` artifacts plus Worker logs for `appVersion=9723362`.
2. For every hard-intent failure row (`Q03`, `Q04`, `Q06`), classify the miss as one of:
   - source asset absent
   - source asset present but ranking failed
   - source asset present and selected, but prompt/model synthesis failed
3. Correlate three log families for the same run:
   - `chat_context_selection`
   - `chat_path_decision`
   - `llm_usage`
4. Explicitly compare:
   - benchmark template intent
   - runtime `questionIntent`
   - selected source labels / source-gate missing source types
   - token totals when available in logs
5. Decide whether the next quality pass should start with:
   - source-asset widening
   - retrieval/ranking changes
   - prompt-only cleanup

Most likely conclusion, based on current code and artifacts:

- Do source-asset availability analysis before prompt-only tuning.
- The dominant current bottleneck is not obvious prompt wording alone; it is the limited shape of filing evidence preserved into the chat asset pool.

## 13. Files / functions index

### HTTP entry and routing

- `workers/src/index.ts`
- `workers/src/routes/chat.ts`
- `workers/src/routes/company.ts`
- `workers/src/routes/search.ts`
- `workers/src/routes/usage.ts`
- `workers/src/routes/credit-purchase-grant.ts`
- `workers/src/routes/admob-rewards.ts`
- `workers/src/routes/billing-sync.ts`
- `workers/src/routes/legal.ts`

### Chat orchestration

- `workers/src/lib/chat/usecase.ts`
- `workers/src/lib/chat/orchestrator.ts`
- `workers/src/lib/chat/model-attempt.ts`
- `workers/src/lib/chat/model-retry.ts`
- `workers/src/lib/chat/response-finalizer.ts`
- `workers/src/lib/chat/grounding.ts`
- `workers/src/lib/chat/diagnostics.ts`
- `workers/src/lib/chat/decision-log.ts`

### Intent / context / retrieval

- `workers/src/lib/chat/intent.ts`
- `workers/src/lib/chat/context.ts`
- `workers/src/lib/chat/context-pack.ts`
- `workers/src/lib/chat/context-profile.ts`
- `workers/src/lib/chat/context-factual-pack.ts`
- `workers/src/lib/chat/source-gate.ts`
- `workers/src/lib/chat/hard-intent-retrieval.ts`
- `workers/src/lib/chat/evidence-slots.ts`
- `workers/src/lib/chat/evidence-fallback.ts`
- `workers/src/lib/chat/source-validation.ts`
- `workers/src/lib/chat/historical.ts`

### Deterministic / local fallback

- `workers/src/lib/chat/deterministic.ts`
- `workers/src/lib/chat/deterministic/common.ts`
- `workers/src/lib/chat/deterministic/margin.ts`
- `workers/src/lib/chat/fallback-response.ts`
- `workers/src/lib/chat/final-answer-language.ts`

### Model providers

- `workers/src/clients/llm/provider.ts`
- `workers/src/clients/llm/providers/openai/client.ts`
- `workers/src/clients/llm/providers/openai/request.ts`
- `workers/src/clients/gemini.ts`
- `workers/src/clients/gemini/request.ts`
- `workers/src/clients/gemini/prompts.ts`
- `workers/src/clients/gemini/types.ts`

### Filing ingestion / storage / SEC fetch path

- `workers/src/clients/sec.ts`
- `workers/src/clients/sec-fetcher.ts`
- `workers/src/extractors/mda.ts`
- `workers/src/lib/filings/latest.ts`
- `workers/src/lib/filings/ingest.ts`
- `workers/src/lib/filings/cache.ts`
- `workers/src/lib/filings/content-upgrade.ts`
- `workers/src/lib/history-store.ts`
- `workers/src/lib/history-autohydration.ts`

### Billing / quota / entitlement

- `workers/src/lib/quota.ts`
- `workers/src/lib/credit-operation.ts`
- `workers/src/lib/remote-config.ts`
- `workers/src/lib/entitlements.ts`
- `workers/src/lib/apple-store-server.ts`

### Quality / testbench / eval

- `workers/testbench/README.md`
- `workers/testbench/company-sets/minimal-5.json`
- `workers/testbench/questions/core-12.jsonl`
- `workers/testbench/failure-labels.md`
- `workers/testbench/scripts/validate-testbench.mjs`
- `workers/testbench/scripts/run-benchmark.mjs`
- `workers/testbench/scripts/summarize-runs.mjs`
- `workers/testbench/scripts/benchmark-quality.mjs`
- `workers/eval/chat-quality-v1.jsonl`
- `workers/scripts/validate-chat-eval.mjs`
