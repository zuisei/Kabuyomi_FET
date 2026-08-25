# PR-01 Request Execution Idempotency Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-10 JST

Repository: `zuisei/Kabuyomi_FET`

Working branch: `main`

Audited base commit: `b61602ef55e2499cccd46e32f53e29bb61c83aa7`

## 1. Conclusion

PR-01 is complete in the current uncommitted working tree. Chat and quote-translation operation IDs are now required request-execution keys bound to deterministic SHA-256 payload fingerprints. The per-principal `UserQuotaDO` admits one leader, returns followers as pending, replays stable completed results with fresh usage, rejects changed payloads, and retains terminal fingerprints after cached result expiry. iOS now owns one operation ID per logical action and reuses it after response loss and while polling a pending execution.

KBY-P0-02 is closed by implementation and regression coverage. Product release remains `HOLD`; PR-02 must atomically reserve credit before provider work.

## 2. Audit-claim verification table

| Claim | Baseline classification | Remediated proof |
|---|---|---|
| Operation IDs were credit-ledger keys only | Confirmed | `RequestExecutionRequestSchema`, `request-fingerprint.ts`, and the DO execution record bind operation ID, route, and request hash before work. |
| Exact retry could execute the provider again | Confirmed | Sequential, 20-way concurrent, and response-loss tests prove one leader/provider execution and replay/pending followers. |
| Changed request could reuse a prior operation ID | Confirmed | Question, filing, ordered context, translation text, and route/hash mismatches return HTTP 409 before provider or charging. |
| Cached replay could expose stale usage | Confirmed design risk | Cached bodies exclude usage; both routes load current usage on replay. |
| iOS minted a UUID inside every API call | Confirmed | API methods now require a caller-provided ID; AppModel and quote state retain payload-bound IDs across ambiguous retries. |
| Raw error/request payloads appeared in touched logs | Partially confirmed | Touched chat/translation failure logs now emit bounded error classes plus redacted hashes/suffixes, never raw question, context, quote text, or full operation ID. |

## 3. Implementation summary

- Added recursive stable-key canonical JSON and SHA-256 fingerprints with route-version domain separators.
- Made chat and quote-translation operation IDs required.
- Added a dedicated `/request-execution` internal DO endpoint with a 128 KiB payload limit.
- Implemented immutable `pending`, `completed`, and `failed` execution states under the per-principal serialization gate.
- New exact execution creates one leader; exact in-flight followers receive `202 execution_pending`; changed payload or route receives `409 operation_id_payload_mismatch`.
- Completed exact retries replay answer/translation, source, response-path/model, and charge metadata only. Current usage is loaded independently.
- Cached result bodies expire after seven days; fingerprints and terminal state remain. Expired retries receive `410 operation_result_expired` and do not regenerate.
- Pending records terminalize after five minutes instead of electing a second leader.
- Chat and translation routes claim execution before filing preparation/provider/credit work, and persist terminal failures without replacing the original error.
- iOS performs bounded same-ID polling for `202`, uses payload-bound retry records after response loss, rotates the ID only for a changed or subsequently successful new action, and uses the injected client for quote translation.

## 4. Files changed

- `workers/src/lib/contracts.ts`
- `workers/src/lib/request-fingerprint.ts`
- `workers/src/lib/request-execution.ts`
- `workers/src/durable/user-quota.ts`
- `workers/src/lib/chat/usecase.ts`
- `workers/src/routes/chat.ts`
- `workers/src/routes/translate-quote.ts`
- `workers/test/request-fingerprint.test.ts`
- `workers/test/user-quota.test.ts`
- `workers/test/chat-route.test.ts`
- `workers/test/quote-translation-route.test.ts`
- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/Kabuyomi/Models/APIModels.swift`
- `ios/Kabuyomi/Services/APIClient.swift`
- `ios/KabuyomiTests/APIClientTests.swift`
- `ios/KabuyomiTests/AppModelTests.swift`

## 5. Schema and migration changes

No D1 migration, Durable Object class migration, binding, or production data migration was added. Request-execution records use new namespaced keys inside the existing `UserQuotaDO` storage. This is additive and lazy: records appear only when a request is claimed.

The public API contract now requires `operationId` for `/v1/chat` and `/v1/translate-quote`. The current shipped iOS client already sent IDs; this phase moves ID creation out of `APIClient` and makes the ownership rule compile-time visible.

## 6. State-machine or data-flow changes

```text
new exact request -> pending leader -> provider/charge -> completed + stable result
same exact request while pending -> 202 follower; no provider/charge
same exact request when completed -> replay + freshly loaded usage
same ID with changed route/hash -> 409; no provider/charge
pending timeout or explicit failure -> immutable failed
completed body expiry -> immutable fingerprint + 410; no regeneration
```

Forbidden transitions are `completed -> pending`, `failed -> pending`, and `failed -> completed`. Duplicate complete/fail calls are idempotent and preserve the first terminal state.

## 7. Tests added or updated

- Canonical ordering, whitespace normalization, domain fields, ordered context, analysis-tier/cost binding, and translation-field fingerprints.
- DO leader election with 20 concurrent begins, config-change replay, mismatch, body-size boundary, completion/failure idempotency, pending expiry, result expiry, missing records, and response headers.
- Chat exact replay, fresh usage, 20-way concurrency, question/filing/context mismatch, disabled-config replay, expired result, and privacy-safe failures.
- Translation exact replay, fresh usage, changed-text mismatch, disabled-provider replay, expired result, and failure/refund paths.
- iOS fixed-ID serialization, response-loss retry reuse, payload-change rotation, post-success rotation, `202` same-ID polling, result-expiry retention, quote payload binding, and dependency injection.

## 8. Commands run and exact results

| Command | Result |
|---|---|
| `cd workers && npm run typecheck` | PASS, 0 TypeScript errors |
| `cd workers && npm test` | PASS, 55/55 files and 751/751 tests |
| `cd workers && npm run dryrun:test` | PASS, dry-run only; upload 1357.16 KiB / gzip 274.60 KiB |
| `cd workers && npm run testbench:validate` | PASS, 5 default tickers and 12 templates |
| `cd workers && npm run migrations:validate` | PASS, nine ordered migrations (`0001`-`0009`) |
| focused Worker route tests | PASS, 38/38 |
| `cd ios && xcodebuild test ... -only-testing:KabuyomiTests/APIClientTests -only-testing:KabuyomiTests/AppModelTests` | PASS, 109/109 |
| full iOS suite on iPhone 17 Pro / iOS 26.4.1 | PASS, 165/165; result `/tmp/KabuyomiPR01Full.xcresult` |
| `git diff --check` | PASS |

No Worker was deployed and no remote migration was applied.

## 9. Security and privacy review

- Operation records are isolated by the existing per-principal Durable Object namespace.
- Logs contain only quota hashes, short operation/hash suffixes, route, bounded state/reason enums, and non-identifying counts.
- Cached results exclude usage, balance, debug diagnostics, prompts, source excerpts, questions, conversation context, raw identities, and full operation IDs.
- Provider calls remain outside `blockConcurrencyWhile`; the serialization gate contains storage-only transitions.
- Disabled provider/config states can replay an already-completed result but cannot create a new execution.

## 10. Backward-compatibility review

The shipped iOS request shape remains compatible because it already included operation IDs. Older clients that omit an ID now receive a validation error rather than receiving an unsafe server-generated fallback; this is an intentional security boundary. Existing credit records and balances are unchanged. Config changes do not change a client-payload hash, so exact retry replays the originally completed result.

## 11. Unresolved risks

- PR-01 does not reserve credit. Concurrent unique requests can still pass affordability checks before provider work; KBY-P0-03 remains open for PR-02.
- A Worker termination after provider/charge but before completion leaves a terminalizable pending record and may prevent result recovery. It does not permit free regeneration; PR-02 will make completion and reservation commit atomic within the DO.
- Result bodies are stored directly in DO storage. The 128 KiB cap is tested, but future larger responses should use a result pointer.
- Production deployment and real response-loss smoke were intentionally not performed.

## 12. Rollback or disable procedure

Keep product release on `HOLD`. If this change must be disabled before PR-02, disable chat and quote translation through server controls and revert the PR-01 code as a unit. Do not delete execution fingerprints or credit-operation records, because deleting only one idempotency side can permit an unsafe replay. No balance rollback or migration cleanup is required.

## 13. releaseDecision

`releaseDecision: HOLD`

PR-02 atomic credit/quota reservation is required before request execution can be enabled for release.
