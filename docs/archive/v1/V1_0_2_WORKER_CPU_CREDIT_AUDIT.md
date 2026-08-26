# V1.0.2 Worker CPU / Credit Safety Audit

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Executive summary

The observed `/v1/chat` HTTP 503 is a Worker CPU limit failure, not an insufficient-credit failure.

The local Worker tail evidence shows `/v1/chat` invocations ending with:

- `outcome: exceededCpu`
- exception message: `Worker exceeded CPU time limit.`
- response status: `503`

The same failed invocations log `credit_consume` before termination, with `delta: -2` and remaining balances moving through `34`, `32`, and `30`. Current code charges chat credits before response generation, then relies on normal exception handling to refund on generation failure. A Cloudflare CPU termination can stop execution before the refund path runs, so the current order can lose credits when the Worker is killed.

Recommended release posture: `HOLD` until the v1.0.2 patch at least fixes credit safety and reduces production diagnostics on the hot path. Moving to Workers Paid / `[limits] cpu_ms = 30000` can reduce immediate 503s, but it does not fix the charge-before-fatal-failure risk.

## 2. Branch and repo state

Current branch:

```text
v1.0.2-subscription-rewarded-credits
```

Repo state observed before this report:

```text
 M ios/Kabuyomi/App/AppModel.swift
 M ios/Kabuyomi/App/AppRootView.swift
 M ios/Kabuyomi/Features/Company/CompanyComposer.swift
 M ios/Kabuyomi/Features/Company/CompanyView.swift
 M ios/Kabuyomi/Features/Settings/CreditView.swift
 M ios/Kabuyomi/Services/RewardedAdService.swift
 M ios/KabuyomiTests/AppModelTests.swift
?? docs/archive/v1/V1_0_2_INSUFFICIENT_CREDIT_RECOVERY_REPORT.md
?? docs/archive/v1/V1_0_2_REWARDED_AD_RETURN_NAVIGATION_FIX_REPORT.md
?? docs/archive/v1/V1_0_2_REWARDED_AD_SMOKE_HANDOFF_FOR_CHATGPT.md
?? tmp/kabuyomi-worker-tail-503.jsonl
```

This audit only adds this report file. Existing dirty iOS/docs/log files were not modified by this audit.

## 3. Cloudflare / Wrangler configuration findings

`workers/wrangler.toml` does not currently define `[limits] cpu_ms`.

Production config:

- Worker name: `kabuyomi-api`
- No `[limits]` block found.
- `HARD_INTENT_TARGETED_RETRIEVAL_MODE = "diagnostic"`
- `LLM_PROVIDER = "openai"`
- `OPENAI_CHAT_MODEL = "gpt-5-nano"`
- `OPENAI_REASONING_EFFORT = "low"`
- `OPENAI_MAX_COMPLETION_TOKENS = "1800"`
- observability logs are enabled with `persist = true`.

Test config:

- Worker name: `kabuyomi-api-test`
- No `[limits]` block found.
- `HARD_INTENT_TARGETED_RETRIEVAL_MODE = "diagnostic"`
- `OPENAI_REASONING_EFFORT = "minimal"`
- test AdMob and Apple sandbox config are separate from production.

The local tail evidence is consistent with the Worker running under a low CPU ceiling. If the account is still on Workers Free or the deployed Worker has a low CPU limit, the current chat hot path can exceed it. The recommended config to evaluate, but not apply in this audit, is:

```toml
[limits]
cpu_ms = 30000
```

Do not use `300000` as the default for v1.0.2 without further proof. `30000` is a more reasonable first paid-compatible ceiling.

## 4. Current /v1/chat call graph

Current call graph from `workers/src/routes/chat.ts` and `workers/src/lib/chat/usecase.ts`:

```text
handleChatRoute
  -> match POST /v1/chat
  -> parseJsonBody(ChatRequestSchema, max 4096 bytes)
  -> loadFilingByKey(payload.filingKey)
  -> isCurrentCacheRecord(...)
  -> answerChatUsecase
       -> readQuotaIdentity(requireDeviceKey: true)
       -> prepareFilingForChat
       -> creditOperationId = payload.operationId ?? crypto.randomUUID()
       -> isCreditBillingEnabledForIdentity(...)
       -> chargeChat
            -> consumeChatQuota when legacy quota path
            -> consumeBillableCredits -> consumeCredit when credit billing enabled
       -> resolveContextualQuestion(...)
       -> summarizeFollowupContext(...)
       -> buildChatResponseWithRefund
            -> buildChatResponse(...)
            -> catch normal thrown errors
                 -> refundAfterChatGenerationFailure
                      -> refundChat
                           -> refundChatQuota or refundBillableCredits -> refundCredit
                 -> rethrow original error
       -> if answer.chargeable === false
            -> refundChat(...)
       -> logEvent("chat_request", ...)
       -> logEvent("chat_quality_pipeline", buildChatQualityPipelinePayload(...))
       -> return answer body with usage/credits metadata
  -> json(body)
```

The route catches `InsufficientCreditsError` and returns `402` with `creditsRequired` and `creditsRemaining`. Other errors are logged as `chat_request_failed` and rethrown to `workers/src/index.ts`.

## 5. Current credit lifecycle

Operation id:

- iOS sends `operationId` in the chat request.
- Worker uses `payload.operationId ?? crypto.randomUUID()` in `answerChatUsecase`.
- The operation id is passed to `consumeCredit` as the idempotency key.

Charge timing:

- `chargeChat(...)` runs before `buildChatResponse(...)`.
- Therefore credits are consumed before the answer is generated.

Refund timing:

- Normal generation failures are caught by `buildChatResponseWithRefund(...)`.
- `refundAfterChatGenerationFailure(...)` calls `refundChat(...)`.
- For credit billing, `refundChat(...)` calls `refundBillableCredits(...)`, which calls `refundCredit(...)` with `refundOperationId = refund:${operationId}`.

What is caught:

- Normal JavaScript/TypeScript thrown errors from `buildChatResponse(...)`.
- Non-chargeable answers after generation also trigger a refund.

What is not safely caught:

- Cloudflare fatal Worker termination such as `outcome: exceededCpu`.
- CPU exceeded can stop the isolate after `credit_consume` and before the refund code runs.

Idempotency:

- `UserQuotaDO.consumeCredit(...)` loads an existing `credit_operation:${operationId}` and returns it without mutating again.
- `UserQuotaDO.refundCredit(...)` loads an existing refund operation and returns it without mutating again.
- If the original operation is missing, not applied, or already refunded, refund writes a `noop`.
- This makes duplicate consume/refund calls idempotent when the calls execute.

Free quota vs paid/ad/monthly credit:

- Legacy `consumeChatQuota` and credit ledger `consumeCredit` are separate paths.
- Credit ledger consumes monthly credits first, then rewarded ad credits, then purchased credits.
- Refund restores the specific buckets recorded on the original consume operation.

Does `/v1/chat` save the assistant answer:

- The Worker does not persist chat answers. iOS saves chat history after a successful response.
- Since current Worker charges before generation, the server-side credit mutation can happen before iOS receives or saves an answer.

## 6. Evidence from worker tail log

Local log file inspected:

```text
tmp/kabuyomi-worker-tail-503.jsonl
```

Useful filter:

```bash
rg "exceededCpu|Worker exceeded CPU time limit|credit_consume|creditsRemaining|response.*503" tmp/kabuyomi-worker-tail-503.jsonl
```

Observed sequence:

- Successful chats consume from `48` down to `36`.
- At the next requests, `/v1/chat` returns `503`.
- Failed requests show `outcome: exceededCpu`.
- Failed requests include exception `Worker exceeded CPU time limit.`
- Failed requests include `credit_consume` before termination:
  - `delta: -2`, `creditsRemaining: 34`
  - later retries show `creditsRemaining: 32`
  - later retries show `creditsRemaining: 30`

The failure point correlates with maxed conversation context, not a credit threshold. The failing request payloads were about 1.6 KB and the schema allows up to 6 context messages of 420 chars each.

## 7. CPU hotspot inventory

### `workers/src/lib/chat/usecase.ts` / `answerChatUsecase`

Why it may cost CPU:

- Charges before all heavy work, then builds answer, answer quality flags, and full diagnostic payload.
- Always calls `buildChatQualityPipelinePayload(...)` after a successful answer.

Runs in production:

- Yes.

Affects answer output:

- Charge order affects billing, not answer quality.
- Diagnostic payload does not affect answer output.

Safe v1.0.2 mitigation:

- Add cheap credit preflight before generation.
- Move final credit consume after successful answer generation.
- Keep idempotent `operationId`.
- Replace verbose production `chat_quality_pipeline` with compact production diagnostics.

Risk:

- If final charge fails after answer generation, the generated answer must not be returned. This is safe but wastes compute.

### `workers/src/lib/chat/diagnostics.ts` / `buildChatQualityPipelinePayload`

Why it may cost CPU:

- Constructs a very large object with `selectedSourceExcerpts`, `selectedSourceTextPreview`, `sourceGateEvidenceSlots`, hard retrieval query arrays, final source arrays, language guard fields, model diagnostics, and many null/default fields.
- The payload is then JSON serialized by `logEvent`.
- Local tail shows enormous `chat_quality_pipeline` log entries.

Runs in production:

- Yes. There is no production guard around `logEvent("chat_quality_pipeline", ...)`.

Affects answer output:

- No. This is logging/observability.

Safe v1.0.2 mitigation:

- Build a compact production payload with counts, enum/status fields, timings, and small ids only.
- Keep verbose payload only for `KABUYOMI_ENV === "test"` or an explicit diagnostic env flag.
- Remove source excerpts and source text previews from production logs.

Risk:

- Less detail in production logs. Mitigate with compact fields and optional diagnostic mode for controlled staging.

### `workers/src/lib/chat/diagnostics.ts` / `buildContextDebugFields`

Why it may cost CPU:

- Maps every selected source into both `selectedSourceExcerpts` with `source.text.slice(0, 420)` and `selectedSourceTextPreview` with `source.text.slice(0, 320)`.
- These debug fields then flow into later logs.

Runs in production:

- Yes when context debug is attached to answer debug and later logged.

Affects answer output:

- No, except downstream code may inspect debug in finalizer logic.

Safe v1.0.2 mitigation:

- Do not attach raw excerpt/preview debug fields in production.
- If internal answer repair needs source text, pass it through in-memory local variables rather than log-shaped debug payloads.

Risk:

- Must ensure finalizer behavior does not rely on removed debug fields for answer text. Prefer compact logging first, then later refactor internal debug.

### `workers/src/lib/chat/source-gate.ts`

Why it may cost CPU:

- Performs repeated normalization, regex checks, sector-specific pattern scans, number token matching, and evidence slot construction over selected source text.
- `extractSupportedDrivers(...)` stores driver text snippets.

Runs in production:

- Yes for hard financial intents and fallback/evidence paths.

Affects answer output:

- Yes. This is answer-quality control, so do not broadly change logic for v1.0.2.

Safe v1.0.2 mitigation:

- Do not change source gate decision logic in the minimal patch.
- Compact only what is logged from the source gate.
- Add instrumentation counts/timings so future refactor can target exact cost.

Risk:

- Changing source gate logic can regress answer quality; avoid for v1.0.2 unless CPU still fails after safer mitigations.

### `workers/src/lib/chat/hard-intent-retrieval.ts`

Why it may cost CPU:

- `resolveHardIntentRetrievalMode` defaults to `diagnostic`.
- Production config explicitly sets `HARD_INTENT_TARGETED_RETRIEVAL_MODE = "diagnostic"`.
- Diagnostic mode still builds plans, queries, missing-source lists, coverage metadata, and debug arrays. Active retrieval scans filing text windows.

Runs in production:

- Yes, as diagnostic mode.

Affects answer output:

- Diagnostic mode should be output-neutral if it only reports diagnostics. Active mode may affect selected sources and answer output.

Safe v1.0.2 mitigation:

- Recommend production mode `off` or a cheap diagnostic mode that records only `hardRetrievalPlanUsed`, `hardRetrievalOutcome`, and counts.
- Treat this as a separated config/code recommendation, not part of answer-quality rewrite.

Risk:

- If current diagnostic fields are used for QA, production evidence is less detailed.

### `workers/src/lib/chat/response-finalizer.ts`

Why it may cost CPU:

- Contains many regex-based cleanup and guard passes over generated answer text and some source evidence text.
- `extractSourceGateEvidenceText(...)` walks source gate evidence and slices to 5000 chars.
- Some helpers inspect `debug.selectedSourceExcerpts`.

Runs in production:

- Yes.

Affects answer output:

- Yes.

Safe v1.0.2 mitigation:

- Do not rewrite finalizer for v1.0.2.
- Avoid adding more source text into debug/log fields.
- Later refactor can separate answer-internal data from log payloads.

Risk:

- Direct changes here can change answer quality; defer unless compact diagnostics and post-generation charge are insufficient.

### `workers/src/lib/chat/orchestrator.ts`

Why it may cost CPU:

- Runs route policy, context selection, model/fallback decisions, source repair, source gate, and logging decisions.
- Calls `logChatPathDecision` with debug fields in several branches.

Runs in production:

- Yes.

Affects answer output:

- Yes for routing and fallback decisions.

Safe v1.0.2 mitigation:

- Keep answer routing unchanged.
- Compact `chat_path_decision` if it includes source arrays or expensive diagnostic fields.

Risk:

- Low if only log payload is compacted.

## 8. Diagnostic/logging payload inventory

### High-risk / oversized logs

- `chat_quality_pipeline` in `workers/src/lib/chat/usecase.ts`
  - includes raw user question: `originalQuestion`
  - includes rewritten question: `rewrittenQuestion`
  - includes `selectedSourceExcerpts`
  - includes `selectedSourceTextPreview`
  - includes `sourceGateEvidenceSlots`
  - includes hard retrieval queries, purposes, missing source types, labels, ids
  - includes final source ids/labels

- `buildContextDebugFields` in `workers/src/lib/chat/diagnostics.ts`
  - creates source text slices from selected source text.

- `credit_consume` / `credit_refund` in `workers/src/lib/quota.ts`
  - logs `userId` as `identity.quotaSubject`.
  - For production device-key identities this is a hash, not the raw device key.
  - For `local_device` test identity it can contain local device text in tests/dev.

- AdMob routes log transaction id, ad unit, reward intent id, and user id in some events.
  - This audit did not find raw SSV signatures in logs.
  - For production release logs, transaction id/ad unit should be suffix/redacted.

- Apple verification logs include transaction id and Apple auth debug fields.
  - They do not log raw private keys or signed payloads in inspected code.
  - Transaction ids should be suffix/redacted in production-facing logs.

Recommended compact replacement fields for chat production logs:

- `requestId`
- `operationIdSuffix` or hash
- `identityKind`
- `quotaSubjectSuffix` or hash
- `route`
- `status`
- `responsePath`
- `fallbackReason`
- `selectedSourceCount`
- `selectedSourceCharCount`
- `conversationContextCount`
- `conversationContextCharCount`
- `diagnosticsLevel`
- `hardIntentRetrievalMode`
- `chargeStage`
- `charged`
- `creditDelta`
- `creditsRemaining`
- `latencyMs`
- `errorKind`

Do not log in production:

- full device key
- full transaction id
- full reward intent id
- AdMob unit id
- callback URLs
- SSV signatures
- Apple signed transaction payloads
- raw Apple JWS
- full user question unless an explicit diagnostic flag is enabled
- full conversation context
- selected source excerpts
- selected source text previews
- full source gate evidence text

## 9. Test coverage inventory

Existing coverage found:

- `/v1/chat` success with legacy quota consume:
  - `workers/test/chat-route.test.ts`
  - `returns a null modelName for non-remote response paths`

- `/v1/chat` credit billing success:
  - `uses credit billing when enabled and returns credit charge metadata`
  - `uses credit billing for detached dev access without the global credit flag`

- Insufficient credits returns 402 before generation:
  - `returns insufficient_credits without running chat generation`

- Normal generation failure refund:
  - `refunds consumed chat quota when chat generation fails after quota mutation`
  - `refunds credit when chat generation fails after credit consumption`

- Non-chargeable answer refund:
  - `refunds chat quota for non-chargeable historical preparation responses`
  - `refunds credits for non-chargeable historical preparation responses`

- Credit consume idempotency:
  - `workers/test/user-quota.test.ts`
  - `consumes credit once for the same operation id`

- Credit insufficient no decrement:
  - `returns insufficient_credits without decrementing the balance`
  - `workers/test/credit-quota.test.ts`
  - `throws insufficient credits without writing a ledger row`

- Credit refund idempotency:
  - `refunds a credit operation only once`
  - `persists a positive ledger row after a credit refund`

- Purchase / StoreKit idempotency:
  - `workers/test/credit-quota.test.ts`
  - `records and grants purchased credits once for a consumable transaction`
  - `grants the new primary 50-credit consumable as paid credits`
  - `does not grant credits again when the transaction is already granted`
  - `workers/test/apple-store-server.test.ts`
  - Apple server verification and rejection tests.

- AdMob SSV idempotency:
  - `workers/test/admob-rewards.test.ts`
  - `duplicate SSV callbacks are success no-ops and do not grant twice`
  - invalid signature / unknown custom data / expired intent / daily cap tests.

- Hard intent retrieval diagnostic behavior:
  - `workers/test/hard-intent-retrieval.test.ts`
  - `workers/test/chat-source-gate.test.ts`

Gaps:

- No test proves generation failure before final charge does not consume credits, because current implementation charges first.
- No test simulates CPU-risk fatal failure before refund and proves no credit loss.
- No test proves successful answer consumes exactly 2 credits after generation.
- No test proves duplicate operation id does not double charge in a post-generation charge design.
- No test proves final charge insufficient returns 402 without returning generated answer.
- No test proves max conversation context production path avoids verbose diagnostics.
- No test proves production `chat_quality_pipeline` excludes `selectedSourceExcerpts` and `selectedSourceTextPreview`.
- No test proves production chat logs omit full user question and full source text.

## 10. Minimal v1.0.2 patch recommendation

### Option A — Paid CPU limit only

What changes:

- Move the Cloudflare Worker to Workers Paid / Standard if not already.
- Add or configure a paid-compatible CPU limit, preferably:

```toml
[limits]
cpu_ms = 30000
```

What it fixes:

- Likely stops the immediate Free-tier-style `exceededCpu` 503 for the observed 100-200 ms CPU requests.
- Lets TestFlight smoke proceed with fewer backend 503s.

What it does not fix:

- Does not improve actual CPU cost or latency.
- Does not fix charge-before-generation.
- Does not eliminate credit-loss risk for fatal termination, deployment interruption, runtime kill, or other non-catchable failures.
- Does not reduce oversized production logs.

Risk:

- Low code risk, but it can hide the billing safety bug.
- Possible cost exposure if hot path remains heavy.

### Option B — Post-generation charge + compact diagnostics

What changes:

- Add a cheap credit preflight before generation.
- Generate the answer without mutating credits.
- Consume exactly 2 credits only after a chargeable answer is ready.
- If final charge fails with insufficient credits, return 402 and do not return the generated answer.
- Keep `operationId` idempotency for final consume.
- Compact production `chat_quality_pipeline` and related debug logs.
- Keep verbose diagnostics only for test/staging/explicit diagnostic mode.

What it fixes:

- Prevents CPU exceeded before final charge from consuming credits.
- Keeps existing 402 behavior for known insufficient balance before generation.
- Reduces CPU and log serialization pressure.
- Keeps answer-quality logic mostly unchanged.

Risk:

- A race can occur: user has enough credits at preflight but not enough by final charge. Correct behavior is to return 402 without answer.
- Compute can be spent on an answer that is not returned if final charge fails.
- Tests must be updated because existing tests assert charge happens before generation.

Files to change:

- `workers/src/lib/chat/usecase.ts`
- `workers/src/lib/credit-operation.ts` if a preflight helper is added there
- `workers/src/lib/quota.ts` if a credit check helper is added or exposed
- `workers/src/durable/user-quota.ts` only if a new credit check action is needed
- `workers/src/lib/chat/diagnostics.ts`
- possibly `workers/src/lib/logging.ts` for compact/safe helpers
- `workers/test/chat-route.test.ts`
- `workers/test/user-quota.test.ts` or `workers/test/credit-quota.test.ts` if a new credit check action is added

### Option C — Larger worker pipeline refactor

What changes:

- Refactor source gate, hard intent retrieval, response finalizer, and diagnostic data flow so answer-internal data and log data are separated.
- Potentially redesign fallback and source gate loops to be cheaper.
- Consider moving heavy analytics to async/offline evaluation.

Why not v1.0.2 unless necessary:

- It touches answer-quality logic and filing-source reasoning.
- It risks regressions in the user-visible answer surface.
- It is larger than needed to address the release-blocking credit-loss and CPU-log pressure.

## 11. Recommended exact patch plan

1. Add a cheap credit preflight before generation.
   - Use existing identity and usage/credit state.
   - Return `InsufficientCreditsError(2, remaining)` before generation if total credits are below 2.
   - This can initially reuse a non-mutating quota state read if available; if not, add a minimal `checkCredit` action to `UserQuotaDO`.

2. Move final credit consume after successful generation.
   - Generate answer first.
   - If `answer.chargeable === false`, do not charge.
   - If chargeable, call `consumeBillableCredits(...)` after the answer is ready.
   - Keep `operationId` as the consume idempotency key.

3. If final charge fails, return 402 without saving or returning generated answer.
   - Worker does not save chat answers today.
   - iOS only saves after successful response.
   - Therefore returning 402 without answer is safe.

4. Keep legacy quota path behavior explicit.
   - If credit billing is enabled for v1.0.2, focus patch on credit billing.
   - If legacy quota path is still active for some identities, either keep legacy pre-generation quota or add a separate post-generation path with tests.

5. Make production diagnostics compact.
   - Add a `shouldUseVerboseChatDiagnostics(env)` or similar helper.
   - Production log should omit raw `originalQuestion`, `rewrittenQuestion`, `selectedSourceExcerpts`, `selectedSourceTextPreview`, and `sourceGateEvidenceSlots`.
   - Keep compact counts and enum labels.

6. Disable or cheapen hard-intent diagnostic mode in production if output-neutral.
   - Recommended config to evaluate separately:
     - `HARD_INTENT_TARGETED_RETRIEVAL_MODE = "off"` for production, or
     - keep `diagnostic` but prevent large diagnostic arrays from being logged.
   - Do not switch to `active` for v1.0.2.

7. Add tests before deploy.
   - Update existing chat-route tests that currently assert charge before generation.
   - Add explicit tests for no charge before generation, final charge success, final charge insufficient, compact diagnostics, and log redaction.

8. Validate locally, then perform a read-only live tail smoke after deploy approval in a later task.

## 12. Recommended tests to add/update

Target file: `workers/test/chat-route.test.ts`

- `does not consume credits when generation fails before final charge`
- `does not consume credits when a simulated cpu-risk failure occurs before final charge`
- `consumes exactly two credits after a successful chargeable answer`
- `does not double charge duplicate operationId after successful answer`
- `returns insufficient_credits from preflight without running chat generation`
- `returns insufficient_credits from final charge without returning generated answer`
- `does not charge non-chargeable historical preparation responses`
- `emits compact production chat diagnostics without source excerpts`
- `omits raw question and selected source text from production chat logs`
- `keeps verbose chat diagnostics in test environment only`

Target file: `workers/test/user-quota.test.ts` or `workers/test/credit-quota.test.ts`

- `checks credit availability without mutating ledger`
- `keeps consume idempotent for duplicate operationId`
- `keeps refund idempotent for duplicate refundOperationId`

Target files for regression suite:

- Existing purchase / StoreKit tests:
  - `workers/test/apple-store-server.test.ts`
  - `workers/test/credit-quota.test.ts`

- Existing AdMob SSV tests:
  - `workers/test/admob-rewards.test.ts`

Required test names from acceptance list:

- `generation failure before final charge does not consume credits`
- `simulated CPU-risk failure before final charge does not consume credits`
- `successful answer consumes exactly 2 credits`
- `duplicate operationId does not double charge`
- `preflight insufficient credits returns 402 and does not generate`
- `final charge insufficient returns 402 and does not save/return answer`
- `max conversationContext production path does not build verbose diagnostics`
- `production logs do not include full device key or secrets`
- `production logs do not include selectedSourceExcerpts/sourceTextPreview`
- `existing purchase / AdMob / StoreKit tests still pass`

## 13. Validation commands

Commands run from `/Users/0xt4/t4dano/Kabuyomi` or `workers`:

```bash
git status --short
git branch --show-current
rg "exceededCpu|Worker exceeded CPU time limit|credit_consume|creditsRemaining|response.*503|chat_quality_pipeline|refund|chargeChat|buildChatResponseWithRefund" tmp/kabuyomi-worker-tail-503.jsonl workers/src workers/test
rg "HARD_INTENT_TARGETED_RETRIEVAL_MODE|OPENAI_CHAT_MODEL|OPENAI_REASONING_EFFORT|OPENAI_MAX_COMPLETION_TOKENS|cpu_ms|\\[limits\\]" workers/wrangler.toml workers/wrangler.test.toml
cd workers
npm run typecheck
npm test
npm run dryrun:test
```

Results:

- `npm run typecheck`: passed.
- `npm test`: passed, 48 test files, 598 tests.
- `npm run dryrun:test`: passed, Wrangler dry run completed without deployment.

No command failures were observed.

## 14. Risks and tradeoffs

- Paid CPU limit alone is the fastest operational mitigation, but it does not fix credit safety.
- Moving charge after generation prevents fatal pre-refund credit loss, but can spend compute on an answer that is not returned if the final charge fails.
- Compacting diagnostics reduces production observability depth, but current logs are large enough to be a CPU and privacy concern.
- Changing source gate, hard retrieval, or response finalizer logic can affect answer quality. Avoid that for the minimal v1.0.2 patch.
- If legacy non-credit chat quota remains active for any production identity, its ordering should be reviewed separately; the current release concern is the credit ledger path.
- Log redaction should avoid raw transaction ids, raw device keys, full AdMob unit ids, callback URLs, Apple signed payloads, and selected source text.

## 15. releaseDecision

releaseDecision: HOLD
