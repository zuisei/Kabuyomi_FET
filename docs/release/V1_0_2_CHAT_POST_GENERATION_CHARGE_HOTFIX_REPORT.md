# V1.0.2 Chat Post-Generation Charge Hotfix Report

## Executive summary

Implemented the minimal Worker-side Option B hotfix from `docs/release/V1_0_2_WORKER_CPU_CREDIT_AUDIT.md`.

The `/v1/chat` credit lifecycle now performs a cheap affordability preflight before generation, generates the answer, and commits the 2-credit chat charge only after a successful chargeable answer is ready. If generation fails or the Worker is terminated before the final charge point, no chat credit consume operation has run yet, so there is no pre-generation credit loss path.

Production chat diagnostics are now compact by default. Verbose `chat_quality_pipeline` payloads remain available only in test/debug-style environments.

No deploy, push, commit, iOS change, filing retrieval change, answer-quality logic change, model-config change, StoreKit safety change, or AdMob SSV change was performed.

## Root cause confirmed

The audit confirmed the dangerous previous shape:

```text
answerChatUsecase
  -> chargeChat
  -> buildChatResponseWithRefund
  -> refund only if JS catches a normal thrown error
```

Observed production tail evidence showed `/v1/chat` returning Cloudflare `exceededCpu` / HTTP 503 after `credit_consume` logs. CPU termination can stop execution before refund logic runs. That made pre-generation charging unsafe.

## Credit lifecycle before/after

Before:

```text
answerChatUsecase
  -> consume chat credit/quota
  -> generate answer
  -> refund on normal generation error or non-chargeable answer
  -> return answer
```

After:

```text
answerChatUsecase
  -> read identity
  -> prepare filing
  -> preflight chat affordability
  -> generate answer
  -> if answer.chargeable === false: return without charge
  -> commit final chat charge
  -> log compact production diagnostics
  -> return answer
```

## Preflight behavior

Credit billing path:

- Uses `loadUsage(...)` as the cheap credit state read.
- Checks `usage.credits.totalRemaining >= 2`.
- Throws `InsufficientCreditsError(2, remaining)` before generation if insufficient.
- Does not call `consumeCredit(...)` during preflight.

Legacy quota path:

- Uses `ensureChatQuotaAvailable(...)` before generation.
- Does not call `consumeChatQuota(...)` until after successful chargeable generation.

## Final charge behavior

For chargeable answers:

- Credit billing commits through `consumeBillableCredits(...)` after generation.
- Legacy quota commits through `consumeChatQuota(...)` after generation.
- Existing operationId idempotency is preserved because the same `operationId` is still passed to the final credit consume.
- Successful chargeable answers still consume exactly 2 credits in the credit billing path.

For generation failures:

- `chat_generation_failed_before_charge` is logged.
- No `consumeCredit(...)` or `consumeChatQuota(...)` call is made.
- No refund is needed because no charge has happened yet.

## Final charge 402 behavior

If final credit consume fails with `InsufficientCreditsError` after generation:

- Worker returns the existing 402 insufficient-credit response shape.
- The generated answer is not returned.
- The generated answer is not logged by the chat route because final charge happens before answer/quality logs.

Response shape remains:

```json
{
  "error": "insufficient_credits",
  "creditsRequired": 2,
  "creditsRemaining": 0
}
```

## Non-chargeable answer behavior

`answer.chargeable === false` responses now skip final charge entirely.

This replaces the old consume-then-refund behavior for historical-preparation style responses. The response returns with `creditsCharged: 0` and the preflight usage state.

## Production diagnostics compacting

Added compact production chat diagnostics through `buildCompactChatQualityPipelinePayload(...)`.

Production/default `chat_quality_pipeline` no longer includes:

- `originalQuestion`
- `rewrittenQuestion`
- full conversation context
- `selectedSourceExcerpts`
- `selectedSourceTextPreview`
- `sourceGateEvidenceSlots`
- hard retrieval query text arrays
- raw source text previews

Compact production logs retain counts and operational fields such as:

- `diagnosticsLevel`
- `responsePath`
- `fallbackReason`
- `selectedSourceCount`
- `selectedSourceCharCount`
- `conversationContextCount`
- `conversationContextCharCount`
- `hardRetrievalMode`
- `hardRetrievalQueryCount`
- `chargeStage`
- `charged`
- `creditsRemaining`
- `latencyMs`

Verbose diagnostics remain available when `KABUYOMI_ENV=test`, `ENVIRONMENT=test`, or `CHAT_DIAGNOSTICS_LEVEL=verbose`.

## Hard-intent diagnostic behavior

No model config was changed.

`HARD_INTENT_TARGETED_RETRIEVAL_MODE` remains `diagnostic` in both `workers/wrangler.toml` and `workers/wrangler.test.toml`. This hotfix does not change filing retrieval or answer-quality behavior. It only prevents production chat quality logs from emitting large diagnostic arrays.

Separately, `Cloudflare [limits] cpu_ms = 30000` is still recommended as an infrastructure safety setting, but it was not applied in this task.

## Files changed

Worker source:

- `workers/src/lib/chat/usecase.ts`
- `workers/src/lib/chat/diagnostics.ts`

Worker tests:

- `workers/test/chat-route.test.ts`

Report:

- `docs/release/V1_0_2_CHAT_POST_GENERATION_CHARGE_HOTFIX_REPORT.md`

Pre-existing unrelated dirty iOS files were not modified by this Worker hotfix.

## Tests added/updated

Updated `workers/test/chat-route.test.ts` to cover:

- Generation failure before final charge does not consume legacy chat quota.
- Generation failure before final charge does not consume credits.
- Simulated CPU-risk failure before final charge does not consume credits.
- Successful chargeable answer consumes exactly 2 credits after generation.
- Duplicate `operationId` uses the same final consume idempotency key and does not require a second mutation.
- Preflight insufficient credits returns 402 without generation.
- Final charge insufficient credits returns 402 without returning generated answer.
- Non-chargeable historical-preparation responses do not charge or refund.
- Production chat diagnostics are compact and omit raw question/source preview fields.
- Verbose diagnostics remain available in the test environment.

Existing purchase, StoreKit, AdMob SSV, credit ledger, and quota regression tests still pass.

## Commands run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
npm test -- chat-route
npm test -- user-quota credit-quota
npm test
npm run dryrun:test
npm test -- admob-rewards apple-store-server
```

From `/Users/0xt4/t4dano/Kabuyomi`:

```bash
git diff --check
rg "selectedSourceExcerpts|selectedSourceTextPreview|sourceGateEvidenceSlots|originalQuestion|rewrittenQuestion|signedTransactionInfo|transactionId|deviceKey" workers/src workers/test
```

## Failed commands, if any

None.

## Validation results

- `npm run typecheck`: passed.
- `npm test -- chat-route`: passed, 26 tests.
- `npm test -- user-quota credit-quota`: passed, 42 tests.
- `npm test`: passed, 48 files / 603 tests.
- `npm run dryrun:test`: passed, Wrangler test dry-run completed.
- `npm test -- admob-rewards apple-store-server`: passed, 37 tests.
- `git diff --check`: passed.
- Redaction search: expected references remain in tests and non-chat purchase/AdMob/Apple code. Production chat quality logs now use compact payloads by default and tests verify omission of raw question/source-preview fields.

## Remaining risks

- This patch prevents new chat credit loss before the final charge point, but it does not make an already CPU-heavy generation path faster by itself.
- A Worker can still return 503 if generation/logical processing exceeds Cloudflare CPU limits before the final charge point; the difference is that chat credits should not be consumed in that pre-charge failure case.
- `loadUsage(...)` may ensure the monthly credit grant as part of reading usage, matching existing usage behavior. It does not consume chat credits.
- Some non-chat logs still contain transaction IDs in existing purchase/AdMob/Apple surfaces. Those were outside the scoped chat CPU hotfix and were not changed.
- Cloudflare `[limits] cpu_ms = 30000` remains a separate recommended config change for production capacity. It was not applied here.

## Release decision

releaseDecision: HOLD until TestFlight smoke passes.

The Worker hotfix is locally validated, but production deploy and real-device smoke were intentionally not performed in this task.
