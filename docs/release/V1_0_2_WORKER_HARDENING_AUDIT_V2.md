# V1.0.2 Worker Hardening Audit v2

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Executive summary

This was a read-only Worker hardening audit before SEC Form Router / additional form support work. No source code, iOS files, model config, retrieval behavior, answer-quality logic, deploy state, branch state, or push state was changed. The only intended write is this report.

Conclusion: the recent `/v1/chat` CPU/credit safety work still looks structurally sound. The post-generation final charge path is covered by tests and production compact diagnostics are present by default. The larger hardening risks are outside the already-smoked chat fix:

- P0 release blockers: none found in this audit.
- P1 before v1.0.2 final submission:
  - Production logs still emit raw or full stable identifiers in credit, StoreKit, and AdMob events.
  - AdMob daily cap enforcement is count-before-grant in D1 and is not concurrency-serialized per user/day.
  - D1 credit audit writes are best-effort after Durable Object mutation, so the hot balance can change while D1 audit rows are missing.
  - Same-period subscription downgrade reduces monthly remaining credits without an explicit reversal/audit operation.
- releaseDecision: HOLD FOR HARDENING REVIEW.

Local validation passed:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `git diff --check`

Read-only migration status:

- Production D1 `kabuyomi-history`: no migrations to apply.
- Test D1 `kabuyomi-history-test`: no migrations to apply.

## 2. Branch and repo state

- Repository: `/Users/0xt4/t4dano/Kabuyomi`
- Branch: `v1.0.2-subscription-rewarded-credits`
- Worktree was already dirty before this report. Existing dirty files included iOS files, Worker chat/credit hotfix files, `workers/wrangler.toml`, release reports, and tail logs. This audit did not modify iOS files.

Relevant `git status --short` snapshot before report write:

```text
 M ios/Kabuyomi/App/AppModel.swift
 M ios/Kabuyomi/App/AppRootView.swift
 M ios/Kabuyomi/Features/Company/CompanyComposer.swift
 M ios/Kabuyomi/Features/Company/CompanyView.swift
 M ios/Kabuyomi/Features/Settings/CreditView.swift
 M ios/Kabuyomi/Services/RewardedAdService.swift
 M ios/KabuyomiTests/AppModelTests.swift
 M workers/src/lib/chat/diagnostics.ts
 M workers/src/lib/chat/usecase.ts
 M workers/test/chat-route.test.ts
 M workers/wrangler.toml
?? docs/release/V1_0_2_CHAT_POST_GENERATION_CHARGE_HOTFIX_REPORT.md
?? docs/release/V1_0_2_CLOUDFLARE_CPU_LIMIT_CONFIG_REPORT.md
?? docs/release/V1_0_2_INSUFFICIENT_CREDIT_RECOVERY_REPORT.md
?? docs/release/V1_0_2_PRODUCTION_CHAT_CPU_CREDIT_SMOKE_REPORT.md
?? docs/release/V1_0_2_REWARDED_AD_RETURN_NAVIGATION_FIX_REPORT.md
?? docs/release/V1_0_2_REWARDED_AD_SMOKE_HANDOFF_FOR_CHATGPT.md
?? docs/release/V1_0_2_WORKER_CPU_CREDIT_AUDIT.md
?? tmp/kabuyomi-worker-tail-503.jsonl
?? tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl
```

## 3. Worker responsibility map

| Responsibility | Main entrypoint | Stores touched | Idempotency key | External dependency | Failure behavior | Test coverage |
|---|---|---|---|---|---|---|
| Chat | `workers/src/routes/chat.ts`, `workers/src/lib/chat/usecase.ts`, `buildChatResponse` | R2 filing cache, D1/R2 history, `USER_QUOTA` DO, KV config | `payload.operationId` or generated UUID for final credit charge | OpenAI/Gemini, SEC fetcher for content upgrade/history | Preflight 402 blocks generation; generation failure before charge does not consume; final charge failure returns error without answer | `workers/test/chat-route.test.ts`, chat diagnostics/source/finalizer/fallback tests |
| Filing/company loading | `routes/company.ts`, `lib/company/usecase.ts`, `lib/filings/latest.ts`, `clients/sec.ts` | KV ticker/search cache, R2 filings, D1 metadata/history, `FILING_LOCK` DO | filing key/accession; lock key for prep | SEC fetcher, SEC submissions/companyfacts | stale fallback or retryable state where available; unsupported filing forms rejected | `ticker-routes.test.ts`, `latest-filing.test.ts`, `sec*.test.ts`, `content-upgrade.test.ts` |
| Credit consumption | `lib/quota.ts`, `durable/user-quota.ts`, `lib/credit-operation.ts` | `USER_QUOTA` DO source of truth; D1 `credit_ledger`, `monthly_grants` audit | credit operation ID | none | 402 insufficient without decrement; duplicate operation returns prior result while operation record retained | `user-quota.test.ts`, `credit-quota.test.ts`, `chat-route.test.ts` |
| Credit grants | StoreKit route, internal grant route, AdMob route, monthly grant during usage/load | `USER_QUOTA` DO, D1 `purchase_transactions`, `credit_ledger`, `monthly_grants`, AdMob tables | purchase transaction ID, monthly grant operation ID, AdMob transaction ID | Apple App Store Server API, AdMob SSV keys | verified purchase/ad grants mutate DO, then D1 audit best-effort or transaction mark | `index.test.ts`, `credit-quota.test.ts`, `user-quota.test.ts`, `admob-rewards.test.ts` |
| Usage display | `routes/usage.ts` | `USER_QUOTA` DO; D1 audit if monthly grant is ensured | monthly grant operation ID if a period grant is created | none | requires device key; can mutate by ensuring monthly grant | `index.test.ts`, quota tests |
| StoreKit purchase verification | `routes/credit-purchase-grant.ts`, `lib/apple-store-server.ts` | D1 `purchase_transactions`; `USER_QUOTA` DO | Apple transaction ID | Apple App Store Server API | unsupported/mismatch/revoked/unverified transactions reject before grant | `apple-store-server.test.ts`, `index.test.ts`, `credit-quota.test.ts` |
| Subscription entitlement sync | `routes/billing-sync.ts`, `lib/entitlements.ts`, `durable/entitlement.ts` | `ENTITLEMENT` DO, `USER_QUOTA` DO, D1 monthly/ledger audit | original transaction ID DO name; hashed subscription monthly grant operation ID | Apple App Store Server API for active sync | active requires Apple verification; inactive sync becomes untrusted/free | `apple-store-server.test.ts`, `entitlement.test.ts`, `index.test.ts`, `billing-catalog.test.ts` |
| AdMob rewarded SSV | `routes/admob-rewards.ts`, `lib/admob-ssv.ts` | D1 `admob_reward_intents`, `admob_reward_transactions`, `USER_QUOTA` DO, D1 credit audit | AdMob transaction ID, reward intent custom data, DO operation ID | Google AdMob SSV public keys URL | invalid signature rejects before grant; duplicate transaction no-op; expired/unknown intent rejects | `admob-rewards.test.ts`, `credit-quota.test.ts`, `user-quota.test.ts` |
| Logging/diagnostics | `lib/logging.ts`, chat diagnostics, route-specific events | Cloudflare logs | event-specific suffix/hash in some paths | Cloudflare Workers logging | structured JSON; some paths still log full IDs | covered indirectly; chat compact diagnostics explicitly tested |
| Scheduled jobs | `index.ts scheduled`, `lib/daily-refresh.ts` | KV ticker snapshot, R2/D1 filing/history stores | ticker/filing keys | SEC fetcher | search refresh failure throws; tracked filing refresh logs per target | daily refresh/history tests |
| Caches / KV / D1 / R2 / DO | `wrangler.toml`, `env.ts`, route/usecase modules | KV `KABUYOMI_CACHE`, D1 `DB`, R2 `FILINGS_BUCKET`, DOs `SEC_RATE_LIMITER`, `FILING_LOCK`, `USER_QUOTA`, `ENTITLEMENT` | resource-specific | Cloudflare platform | binding absence generally throws or degrades by feature | dry-run validates bindings; unit tests mock stores |

## 4. Credit ledger invariant audit

| Invariant | Status | Evidence / gap |
|---|---|---|
| 1. Chat success charges exactly once. | Covered | Chat final commit uses `commitChatChargeAfterGeneration`; duplicate operation test exists. Production smoke also covered this. |
| 2. Chat generation failure does not charge. | Covered | Generation is before final charge; tests cover model/generation and CPU-risk failures before final charge. |
| 3. Failed request does not charge. | Mostly covered | Preflight 402 blocks generation; generation failure before charge covered. Final-charge 402 returns failure without answer and no charge. |
| 4. Duplicate operationId does not double charge. | Covered with retention caveat | DO checks existing credit operation. Caveat: generic credit operation records are pruned after 30 days, so extremely late duplicate chat operation IDs can charge again. |
| 5. Purchase transaction grants once. | Covered | D1 `purchase_transactions.transaction_id` is unique; DO also stores purchase grant by transaction ID. |
| 6. Duplicate purchase transaction does not double grant. | Covered | Public and DO tests cover already-granted/duplicate behavior. |
| 7. AdMob SSV grants once. | Covered for duplicate transaction | D1 transaction primary key and DO operation ID prevent duplicate transaction double grant. |
| 8. Duplicate AdMob callback does not double grant. | Covered | `admob-rewards.test.ts` covers duplicate callback no-op. |
| 9. Subscription monthly grant is idempotent if implemented. | Covered | Monthly grant operation IDs and D1 operation ID uniqueness are used; tests cover same period idempotency. |
| 10. Same-period subscription upgrade/downgrade is auditable and deterministic if implemented. | Partially covered | Upgrade delta is covered and D1 index 0007 removes the old user+period uniqueness. Downgrade reduces `monthlyRemaining` via negative `limitDelta` without an explicit reversal/ledger event. |
| 11. Refund operations are idempotent. | Covered | DO refund operation ID and original-operation `refundedBy` guard are tested. |
| 12. Paid credits are not lost or expired accidentally. | Mostly covered | Purchased credits are preserved across monthly resets. D1 audit can miss rows if D1 write fails after DO mutation, but DO balance remains source of truth. |
| 13. Ad/free/subscription/purchased buckets are consumed in intended order. | Covered | DO consumes monthly first, then rewarded-ad promotional, then purchased. Tests cover rewarded ad before paid after monthly exhaustion. |
| 14. `/v1/usage` matches DO / D1 source of truth. | Mostly covered | `/v1/usage` loads from DO source of truth and may ensure monthly grant. D1 is audit, not balance source; audit rows can lag/miss on write failure. |

## 5. Apple / StoreKit trust-boundary audit

Classification:

- P0 release blocker: none found.
- P1 before subscription release:
  - Raw transaction IDs are logged in Apple verification and credit purchase grant events. These should be redacted to suffix/hash.
  - Same-period subscription downgrade/expiration behavior needs explicit audit semantics before shipping subscriptions broadly.
- P2 cleanup:
  - `/v1/usage` and `/v1/billing/sync` return `originalTransactionId` and `transactionId` to the owning app. That may be acceptable for client recovery, but it should be documented as an intentional app-facing identifier exposure.

Findings:

- Client-provided JWS is not accepted as authority. For active purchase/subscription paths, code parses client JWS only for sanity checks, then calls Apple App Store Server API and uses Apple payload as authority.
- Paid credit grants require Apple verification before `grantPurchasedCredits`.
- Product ID, transaction ID, original transaction ID, bundle ID, expired, and revoked checks are present.
- Active subscription sync requires Apple verification. Inactive sync does not verify, but `buildSyncedEntitlement` treats unverified inactive sync as free/untrusted, so it does not grant subscription credits.
- Product config is mostly centralized in `workers/src/lib/billing-catalog.ts`.
- Raw transaction logging remains the main StoreKit trust-boundary/privacy issue.

## 6. AdMob SSV trust-boundary audit

Classification:

- P0 release blocker: none found.
- P1 before v1.0.2 final submission:
  - Daily cap enforcement is not serialized per user/day. `processSsvGrant` counts granted D1 rows, then grants through the per-user quota DO, then records the D1 transaction. Concurrent valid callbacks for different pending intents can all observe `grantedToday < DAILY_REWARD_CAP` before any of them records the grant, exceeding the daily cap.
  - Raw AdMob transaction IDs, ad unit IDs, expected ad unit IDs, reward intent IDs, and full quota subject values are logged.
- P2 cleanup:
  - Google SSV public keys are fetched during verification and are not obviously cached in the Worker. This is not on the chat hot path, but it is a latency and reliability risk for reward callbacks.

Findings:

- SSV signature verification happens before grant-field processing.
- `custom_data`/`customData` is required and bound to a server-created reward intent.
- Reward intents expire after 30 minutes.
- Duplicate transaction callbacks are idempotent/no-op.
- Reward amount/item validation rejects client/provider mismatch and grants only server-defined `+2`.
- Reward credits are stored as `rewardedAdRemaining`, separated from purchased credits, and D1 ledger metadata marks `creditSource: admob_rewarded`.
- iOS recovery UI can rely on server status for a single intent, but daily cap concurrency needs server hardening before treating the cap as strict.

## 7. Logging and privacy audit

Required search found the following categories.

Safe:

- Chat lifecycle logs use `quotaSubjectSuffix` and `operationIdSuffix`.
- Production chat quality diagnostics are compact by default and omit raw question text, rewritten question text, selected source excerpts, selected source text previews, and source gate evidence slots.
- Apple auth debug logs include key ID, issuer prefix/hash, bundle ID, JOSE header fields, and signature byte count, but not the private key or bearer token.
- Invalid AdMob signature logs only `verify_failed`.

Test-only:

- Tests intentionally include raw questions, source excerpts, signed payload samples, transaction IDs, and local device keys.
- Verbose `chat_quality_pipeline` is enabled in test environment.

Should redact:

- `quota.ts` credit events log full `userId` / quota subject and full operation IDs for credit consume/refund/monthly/purchase/eval/ad reward events.
- `apple-store-server.ts` logs raw transaction IDs on verification success/failure/attempt failure.
- `admob-rewards.ts` logs raw transaction ID, ad unit, expected ad unit, reward intent ID, and full quota subject in several SSV/intention events.
- `usage.ts` and `billing-sync.ts` return transaction identifiers to the client; keep only if intentional and document/redact anywhere logged.
- `internal-eval-credit-grant.ts` path can expose raw device key in operation ID/reference. It is internal-token gated, but still should hash/suffix for logs.

Release blocker:

- None found. The privacy findings are P1 hardening because production logs persist and monetization identifiers are stable.

## 8. CPU / latency risk inventory

| Hot path | Runs in production? | Affects answer output? | Can compact/disable without answer change? | Should measure before optimizing? | Suggested metric/log field |
|---|---:|---:|---:|---:|---|
| Chat compact diagnostics | Yes | No | Already compact by default | Continue measuring | `diagnosticsLevel`, `totalPipelineMs`, serialized payload size |
| Verbose chat diagnostics | Only test unless `CHAT_DIAGNOSTICS_LEVEL=verbose` | No | Yes | Yes before enabling anywhere | verbose field count / log byte size |
| Source gate | Yes | Yes | No, it affects fallback/retry decisions | Yes | `sourceGateMs`, `sourceGateSufficient`, missing type counts |
| Hard-intent retrieval diagnostic mode | Yes in diagnostic mode | Diagnostic mode should not alter output; active mode would | Can keep diagnostic compact | Yes | `hardRetrievalMode`, `hardRetrievalQueryCount`, `hardRetrievalAddedSourceCount`, `hardRetrievalMs` |
| Finalizer regex/language/source repair passes | Yes | Yes | No broad disable without quality change | Yes | `finalizerMs`, repair label counts |
| JSON serialization of large logs | Compact production yes, verbose test only | No | Yes for logs | Yes | `chatLogBytes`, `diagnosticsLevel` |
| Filing parsing/source selection/content upgrade | Yes for cache misses/metrics-only upgrades | Yes | No, but async fallback already exists in some places | Yes | `contextBuildMs`, `filingUpgradeMs`, `sourceSelectionMs` |
| Historical hydration | Yes for historical questions, can enqueue with `waitUntil` | Yes for historical answers/degrades | Some hydration can remain async | Yes | `historicalLookupMs`, `hydratedCount`, `status` |
| D1/KV read patterns | Yes | Indirect | No | Yes | D1 query count per request, KV get count |
| Scheduled jobs | Yes via cron | No per request | Can disable with config if needed | Yes | per-ticker duration/error count |
| Apple verification | Purchase/subscription only | Credit entitlement output | No | Yes | Apple verification latency/status/environment |
| AdMob SSV verification | Reward callback only | Reward grant output | No | Yes | SSV verification latency, key fetch cache status |

## 9. D1 / Durable Object consistency audit

- The hot credit balance is in `USER_QUOTA` Durable Object storage.
- D1 `credit_ledger`, `monthly_grants`, `purchase_transactions`, `admob_reward_intents`, and `admob_reward_transactions` are audit/coordination tables.
- Production/test read-only migration list reported no pending migrations.
- Known concern checked: migration `0007_monthly_grants_drop_user_period_index.sql` drops the older `idx_monthly_grants_user_period`; both configured D1 databases report no pending migrations, so same-period plan upgrade audit rows should not be dropped by the old unique index.
- D1 audit completeness risk remains: monthly grant and credit ledger writes catch/log failures and do not roll back the DO mutation. This preserves user balance availability, but weakens paid-credit audit completeness.
- Purchase transaction grant ordering is safer than generic ledger audit: D1 `purchase_transactions` row is inserted before DO grant and marked granted afterward. A failure between DO grant and D1 mark can be retried because the DO purchase transaction key is idempotent.
- AdMob grant ordering grants through DO before `recordRewardTransaction`. Duplicate transaction recovery is mostly safe because the DO operation ID uses transaction ID, but the daily cap count is still D1-count-before-grant and not atomic.
- Rollback risk: D1 migrations are additive except index drop. Reintroducing the old user+period unique monthly-grants index would regress same-period upgrade audit rows.

## 10. Form Router readiness audit

Current architecture is not ready to add 20-F / 6-K / 8-K by simply widening a type. A Form Router boundary should be added before new form support.

Hard-coded filing assumptions found:

- `workers/src/env.ts` defines `FilingReference.formType` and `FilingCacheRecord.formType` as `"10-K" | "10-Q"`.
- `workers/src/lib/history-store.ts` uses `HistoricalMetricRow.formType` and `SegmentHighlightRow.formType` as `"10-K" | "10-Q"`, and default backfill forms are `["10-K"]`.
- `workers/src/lib/chat/context-factual-pack.ts` exposes `ChatFactualPack.formType` as `"10-K" | "10-Q"`.
- Historical chat wording and comparison basis assume annual/quarterly 10-K/10-Q semantics.
- SEC/latest filing tests already observe unsupported forms like `6-K`, but route behavior rejects unsupported filing forms before saving quota in watchlist flows.
- Filing/source extraction and prompt/source assumptions are tuned around MD&A/XBRL source availability, which may not map cleanly to 20-F, 6-K, and 8-K.

Recommended boundary:

- Add a Worker-local Form Router layer between SEC submissions/latest-filing selection and filing ingestion/chat context creation.
- The router should own supported form policy, form-specific filing metadata normalization, source extraction strategy, cache-key policy, and route eligibility.
- Keep `/v1/chat` answer-quality and source gate logic behind a form-normalized `FilingCacheRecord` contract. Do not let each route sprinkle form-specific branches.
- Add form-specific fixtures and tests before enabling any new form in production.

## 11. Test coverage gaps

- No concurrent AdMob daily-cap race test. Current tests cover sequential cap enforcement and duplicate transaction callback idempotency.
- No explicit test for same-period subscription downgrade / expiry credit reversal semantics.
- No test that D1 credit ledger failure after DO mutation is reconciled or surfaced for paid-credit audit.
- No production-log redaction test for StoreKit/AdMob/credit events.
- No test that `/v1/usage` client-facing transaction identifiers are intentionally allowed or redacted.
- No Form Router boundary tests; current tests mostly encode 10-K/10-Q assumptions and unsupported-form rejection.
- No SSV public-key cache/latency behavior tests.

## 12. Ranked fix plan

### P0 — release blockers

- None found in this audit.

### P1 — before v1.0.2 final submission

1. Redact stable identifiers in production logs:
   - Replace full quota subjects, operation IDs, transaction IDs, AdMob transaction IDs, reward intent IDs, ad unit IDs, and expected ad unit IDs with suffix/hash fields.
   - Keep raw values in D1/DO storage where required for idempotency, not in logs.
2. Serialize AdMob daily cap enforcement per user/day:
   - Move cap check + grant + transaction record into a per-user/day Durable Object or otherwise atomic server-side section.
   - Add a concurrent callback test proving only 3 grants/day can apply.
3. Make paid-credit audit failure visible/recoverable:
   - For paid purchase and AdMob grants, either make D1 ledger write mandatory before success response or add a durable reconciliation queue/status.
   - At minimum, expose an audit health metric when ledger writes fail after DO mutation.
4. Define subscription downgrade/reversal semantics:
   - Avoid silent monthly credit removal, or record an explicit negative adjustment ledger row with plan/period/product evidence.

### P2 — before v1.2 Form Router

1. Introduce a Form Router boundary for form eligibility, metadata normalization, and extraction strategy.
2. Widen form types only behind router-owned feature flags/tests.
3. Add form-specific source extraction fixtures for 20-F / 6-K / 8-K before route enablement.
4. Add cache-key and history-store tests for form-specific behavior.
5. Add SSV public-key caching and latency metrics.
6. Decide whether 30-day chat operation ID retention is sufficient; document or extend if long retry windows matter.

### P3 — cleanup

1. Document `/v1/usage` as an idempotent read-with-monthly-grant side effect.
2. Centralize redaction helpers for all route logs.
3. Add a log schema snapshot test for production-safe fields.
4. Remove or rename stale test filename assumptions in local audit scripts.

## 13. Recommended minimal patch sequence

1. PR 1: Production log redaction only
   - Add `suffixForLog` / hash helper in shared logging utilities.
   - Update quota, Apple, AdMob, internal eval grant logs.
   - Add tests that forbidden raw identifiers do not appear in production log payloads.

2. PR 2: AdMob daily-cap serialization
   - Add per-user/day cap guard in a Durable Object or equivalent atomic path.
   - Move cap check and grant decision inside that guard.
   - Add duplicate and concurrent SSV tests.

3. PR 3: Credit audit reconciliation
   - Make paid grant ledger write failures observable and recoverable.
   - Add tests for D1 failure after DO mutation.

4. PR 4: Subscription downgrade semantics
   - Define expected behavior for downgrade/expiration.
   - Add explicit ledger adjustment or no-clawback policy.
   - Add same-period downgrade tests.

5. PR 5: Form Router design patch
   - Add router interfaces and tests without enabling new forms.
   - Keep existing 10-K/10-Q behavior unchanged.

## 14. Commands run

```bash
cd /Users/0xt4/t4dano/Kabuyomi
git status --short
git branch --show-current
rg "deviceKey|operationId|transactionId|signedTransaction|signedTransactionInfo|signedPayload|authorization|Bearer|secret|SSV|adUnit|callback|sourceText|sourceExcerpt|selectedSourceExcerpts|selectedSourceTextPreview|originalQuestion|rewrittenQuestion" workers/src workers/test
rg "10-K|10-Q|20-F|6-K|8-K|formType|filingType|filingKey|accession|primaryDocument|companyfacts|submissions" workers/src workers/test
rg "monthly_grants|purchase_transactions|credit_ledger|reward|admob|subscription|originalTransactionId|webOrderLineItemId" workers/src workers/d1 workers/test
rg --files workers/d1/migrations
rg -n "console\\.(log|warn|error)|logEvent|logErrorEvent" workers/src
rg -n "createExecutionContext|SELF|unstable_dev|handleBillingSync|billing_sync|subscription|purchase|credit_purchase|grantPurchased|grantRewarded|refund|monthly grant|daily cap|duplicate" workers/test -g '*.test.ts'
git diff --check

cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test

cd /Users/0xt4/t4dano/Kabuyomi
npx wrangler d1 migrations list kabuyomi-history --config workers/wrangler.toml --remote
npx wrangler d1 migrations list kabuyomi-history-test --config workers/wrangler.test.toml --remote
```

Additional file inspection commands used `nl -ba`, `sed`, `find`, and focused `rg` over the Worker source, tests, migrations, and config.

## 15. Failed commands

No required validation command failed.

Exploration-only command issues:

- `rg ... workers/test/billing-sync.test.ts workers/test/credit-purchase-grant.test.ts ...` returned missing-file errors because those exact test files do not exist; the coverage is in `workers/test/index.test.ts`, `workers/test/credit-quota.test.ts`, and related tests.
- Two `nl` inspections used wrong migration filenames before listing the actual migration files. Correct files were then inspected:
  - `workers/d1/migrations/0007_monthly_grants_drop_user_period_index.sql`
  - `workers/d1/migrations/0008_admob_rewarded_credits.sql`

## 16. releaseDecision

releaseDecision: HOLD FOR HARDENING REVIEW
