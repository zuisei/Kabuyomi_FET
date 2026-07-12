# Prompt v2 Main Deploy Quality Hardening Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-05-28
Branch: `main`
Scope: Worker-side chat quality only
Status: code changes implemented locally; production deploy blocked by pre-existing out-of-scope quota tests

## Executive Summary

This pass hardened the prompt-v2 Worker chat pipeline around the visible smoke-50 failures:

- business-model answers now have a source gate and generic business-model answers are runtime-blocked;
- hybrid English/Japanese final-answer fragments are detected by the final Japanese language guard;
- important metric-only weak answers can be converted to fallback instead of surfacing as model answers;
- deterministic cash-flow answers now avoid bank templates for non-financial filings that merely mention generic SEC financial/securities wording;
- prompt v2 metric packs now include pre-rendered Japanese display strings and tell the model to copy them exactly;
- benchmark summaries now count the visible prompt-v2 quality failures directly;
- an expanded multi-sector company set was added for post-deploy smoke.

No production deploy was performed in this iteration because the required full `npm test` gate fails in rewarded-AdMob/quota tests whose promo-credit fixture dates have expired relative to 2026-05-28. Those tests are outside this task's allowed edit scope.

## End-to-End Worker Chat Pipeline Map

1. HTTP entry: `workers/src/routes/chat.ts`
   - Validates `/v1/chat` request, loads filing, resolves identity, and calls `answerChatUsecase`.

2. Usecase and billing envelope: `workers/src/lib/chat/usecase.ts`
   - Handles identity/quota preflight and post-generation charge commit.
   - Resolves follow-up context with `resolveContextualQuestion` / `summarizeFollowupContext`.
   - Calls the chat response pipeline and emits diagnostics.
   - Not changed in this pass because quota/charging was explicitly out of scope.

3. Orchestration: `workers/src/lib/chat/orchestrator.ts`
   - Chooses historical, deterministic, model, fallback, and finalization paths.
   - Applies source validation and local recovery before returning the response.

4. Follow-up handling: `workers/src/lib/chat/context.ts`
   - Rewrites contextual follow-ups using prior conversation text.
   - Current implementation is string-based; persistent structured evidence slots remain a limitation.

5. Context packaging: `workers/src/lib/chat/context-pack.ts`
   - Selects and ranks source chunks.
   - Builds factual pack, factual metrics pack, selected source metadata, and token budget diagnostics.

6. Context filtering: `workers/src/lib/chat/context-quality.ts`
   - Drops boilerplate, heading-only, table-fragment, and low-text-quality chunks.
   - It is not responsible for determining whether a question has enough intent-specific evidence.

7. Hard source gate: `workers/src/lib/chat/source-gate.ts`
   - Evaluates hard-intent evidence sufficiency.
   - Now includes `business_model`, requiring business description, segment/revenue context, and product/service/customer/revenue-mechanism evidence when available.

8. Hard retrieval diagnostics: `workers/src/lib/chat/hard-intent-retrieval.ts`
   - Plans targeted retrieval for hard-intent gaps.

9. Evidence slots and fallback: `workers/src/lib/chat/evidence-slots.ts`, `workers/src/lib/chat/evidence-fallback.ts`
   - Extracts source-backed drivers and builds honest insufficient-evidence fallbacks.

10. Model attempt control: `workers/src/lib/chat/model-attempt.ts`
    - Builds model input, applies source gate, calls provider, validates source IDs, and decides retry/fallback.

11. Prompt assembly: `workers/src/clients/gemini/prompts.ts`
    - Builds legacy prompt text and OpenAI dashboard prompt variables.
    - Now sends pre-rendered metric display strings in `factual_metrics_pack_json`.

12. Answer quality classification: `workers/src/clients/gemini/chat-quality.ts`
    - Flags weak model answers such as metric-only, missing drivers, and raw English.

13. Source validation: `workers/src/lib/chat/source-validation.ts`
    - Ensures returned `sourceIds` exist in the selected source set and repairs invalid IDs.

14. Deterministic answers: `workers/src/lib/chat/deterministic.ts`
    - Handles deterministic metric, business overview, revenue, margin, cash-flow, and stock-context answers.
    - Existing tests already cover non-bank removal and bank-specific preservation in finalization.

15. Finalization: `workers/src/lib/chat/response-finalizer.ts`, `workers/src/lib/chat/final-answer-language.ts`
    - Cleans, repairs, blocks, or falls back final answers.
    - Now blocks generic business-model answers and short hybrid English/Japanese fragments.

16. Benchmark quality: `workers/testbench/scripts/benchmark-quality.mjs`, `workers/testbench/scripts/summarize-runs.mjs`
    - Aggregates smoke metrics.
    - Now counts generic business-model answers, hybrid fragments, non-financial bank cash-flow language, metric-only important intents, lost prior driver follow-ups, suspicious numeric display, and unsupported risk/liquidity/durability conclusions.

## Files Changed

- `workers/wrangler.toml`
- `workers/wrangler.test.toml`
- `workers/src/clients/gemini/prompts.ts`
- `workers/src/lib/chat/source-gate.ts`
- `workers/src/lib/chat/deterministic.ts`
- `workers/src/lib/chat/response-finalizer.ts`
- `workers/src/lib/chat/final-answer-language.ts`
- `workers/test/chat-source-gate.test.ts`
- `workers/test/final-answer-language.test.ts`
- `workers/test/pipeline.test.ts`
- `workers/test/chat-factual-pack.test.ts`
- `workers/test/benchmark-quality.test.ts`
- `workers/testbench/scripts/benchmark-quality.mjs`
- `workers/testbench/scripts/summarize-runs.mjs`
- `workers/testbench/company-sets/prompt-v2-expanded-multisector.json`

## Validation

Passed:

```text
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality
cd workers && npm test -- benchmark-quality
```

Focused results:

- `chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality`: 6 files passed, 191 tests passed on 2026-05-28.
- `benchmark-quality`: 1 file passed, 10 tests passed.
- `typecheck`: passed.

Full suite:

```text
cd workers && npm test
```

Result on 2026-05-28: blocked by 5 failures in `test/user-quota.test.ts`; 49 files passed, 1 failed, 628 tests passed, 5 failed.

Observed failure class:

- rewarded ad promotional credits are expected to remain available, but the fixture expiry date is before 2026-05-28;
- runtime correctly reports expired rewarded-ad credits as `rewardedAdRemaining: 0`;
- affected tests are AdMob/quota behavior, which this task explicitly excluded from the allowed edit scope.

Exact fixture evidence:

- `workers/test/user-quota.test.ts:1386`, `1438`, `1477`, `1517`, and `1559` use `promoExpiresAt: "2026-05-16T00:00:00.000Z"`;
- the failed expectations at `1417`, `1458`, `1497`, `1542`, and `1582` assume those rewarded-ad credits are still active;
- because current validation ran on 2026-05-28, the existing runtime expires those credits and reports `rewardedAdRemaining: 0` or consumes purchased credits instead.

## Existing Minimal-5 Smoke Baseline

Source run:

```text
workers/testbench/runs/2026-05-26-prompt-v2-smoke-50.jsonl
```

Original summary:

- rows: 50
- tickers: AAPL, JPM, XOM, CAT, WMT
- sourceIdsValidFalse: 0
- rawEnglishSurfaced: 0
- response paths: openai=38, fallback=7, deterministic=5
- qualityFallbackRate: 14.0%
- infra/rate-limit/auth/provider/network contamination: none

Re-summarized with stricter benchmark checks after this change:

- hybridEnglishJapaneseSurfaced: 8
- genericBusinessModelAnswers: 1
- nonFinancialCashFlowBankLanguage: 4
- metricOnlyImportantIntentAnswers: 0
- durabilityFollowupLostPriorDriver: 1
- numericDisplaySuspicious: 0
- unsupportedDurabilityClassification: 0
- unsupportedRiskOrLiquidityConclusion: 0

Representative baseline issues:

- Q01 business model: `Appleは主に製品とサービスの提供を通じて収益を得ています。`
- Hybrid language: `higher brokerage expense`, `Profitability context`, `price-コスト spread discussion`, `Re資料 Industries`.
- Follow-up memory: Q04/Q06 sometimes returned generic missing-driver text even when the previous answer had a driver.
- Cash-flow: non-financial Q09 rows were detected as containing bank/financial-institution language by the stricter benchmark rule.

## Deploy and Smoke Iterations

### Iteration 0: Baseline

- Code batch: none; prior prompt-v2 smoke result supplied by user/local run.
- Deploy version ID: not applicable to this local hardening batch.
- Smoke command represented by existing run file: `testbench/runs/2026-05-26-prompt-v2-smoke-50.jsonl`.
- Diagnosis: source IDs and raw-English long excerpts were controlled, but final visible answer quality still leaked short hybrids, generic business overviews, weak follow-ups, and sector wording contamination.
- Next fix chosen: make business model gated, runtime-block generic/metric-only answers for important intents, strengthen language guard, add metric display pack, expand benchmark checks.

### Iteration 1: Local Code Hardening

- Code batch: Worker chat quality hardening and benchmark visibility updates.
- Deploy version ID: not deployed.
- Smoke command: not run post-deploy because full `npm test` is blocked by out-of-scope quota tests.
- Diagnosis from validation: in-scope Worker chat tests pass; full gate fails only in rewarded-AdMob/quota tests.
- Next action required: approve either a fixture-only quota test-date update or a deploy exception with in-scope tests passing.

## Expanded Multi-Sector Smoke

Added company set:

```text
workers/testbench/company-sets/prompt-v2-expanded-multisector.json
```

Tickers:

```text
AAPL, JPM, XOM, CAT, WMT, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, DAL
```

Intended command after deploy:

```text
cd workers
KABUYOMI_TESTBENCH_BASE_URL=<production-worker-url> \
KABUYOMI_TESTBENCH_COMPANY_SET=testbench/company-sets/prompt-v2-expanded-multisector.json \
KABUYOMI_TESTBENCH_QUESTIONS=testbench/questions/core-12.jsonl \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-26-prompt-v2-expanded-multisector \
npm run testbench:run
```

This has not been run post-change because production deploy is blocked.

## Before/After Expectations

Q01 business_model:

- Before: generic `製品とサービスで収益を得ています` style answers could pass.
- After: business-model source gate rejects XBRL-only context, and finalizer blocks generic business-model answers into `business_model_sources_missing`.

Q03/Q05 driver and margin-driver:

- Before: some metric-only or missing-driver cases were flagged but could remain on the model path.
- After: important metric-only answers are eligible for runtime blocking/fallback; benchmark counts metric-only important-intent rows explicitly.

Q04/Q06 durability follow-up:

- Before: follow-up could say the prior driver was not identified even when the previous answer had a driver.
- After: benchmark counts lost-prior-driver follow-ups. Runtime structured slot persistence remains limited to existing conversation text and evidence-slot diagnostics.

Q09 cash-flow:

- Before: non-financial rows could contain bank/financial-institution wording.
- After: deterministic cash-flow classification uses ticker/company identity instead of generic source text, non-financial templates include operating cash flow, working capital, capex/free-cash-flow/debt/shareholder-return checks, and tests verify bank language is preserved for bank filings only.

Expanded-sector examples:

- NVDA/MU/MSFT/GOOGL/AMZN/TSLA/LLY/V/KO/DAL are now available in the expanded company set.
- Post-deploy smoke is still required to collect actual before/after answer text for these sectors.

## Remaining Known Limitations

- No production deploy or post-change smoke was run because full `npm test` currently fails in out-of-scope quota tests.
- Follow-up evidence slots are still not safely persisted as structured state across requests; the current architecture relies on conversation context plus source-gate evidence diagnostics.
- Numeric consistency is improved by pre-rendered prompt metric strings, but there is not yet a full source-to-answer numeric validator.
- Expanded multi-sector smoke coverage depends on cached filing availability for the selected tickers in the target Worker environment.

## Deployment Blocker

The user requested deployment only after:

```text
npm run typecheck
npm test
focused tests
```

`npm run typecheck` and focused Worker chat tests pass. Full `npm test` does not pass due to rewarded-AdMob/quota tests. Because this task explicitly says not to touch AdMob, credits, purchase verification, quota charging, or billing, this report treats deployment as blocked until one of the following is approved:

1. fixture-only update to the expired rewarded-ad promo credit dates in `workers/test/user-quota.test.ts`; or
2. deploy exception based on passing in-scope Worker chat tests while documenting the unrelated full-suite blocker.
