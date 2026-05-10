# V1.0.2 Credit Audit Reconciliation Report

## Conclusion

PR3 credit audit reconciliation is implemented.

Successful `USER_QUOTA` Durable Object mutations are still the source of truth for user balances and are not rolled back when D1 audit writes fail. The new behavior makes those post-DO audit failures visible and recoverable through an additive D1 repair queue plus an internal-token-gated repair endpoint.

No iOS files, chat answer-quality logic, filing retrieval, model config, StoreKit verification rules, AdMob SSV verification rules, subscription downgrade semantics, credit pricing, deploy state, push state, or SEC Form Router work was changed in this PR.

## Files Changed

- `workers/d1/migrations/0009_credit_audit_repair_queue.sql`
- `workers/src/lib/credit-audit-repair.ts`
- `workers/src/routes/internal-credit-audit-repair.ts`
- `workers/src/index.ts`
- `workers/src/lib/quota.ts`
- `workers/src/routes/admob-rewards.ts`
- `workers/test/credit-audit-repair.test.ts`
- `workers/test/admob-rewards.test.ts`
- `workers/test/index.test.ts`
- `docs/release/V1_0_2_CREDIT_AUDIT_RECONCILIATION_REPORT.md`

Existing dirty iOS files were not modified.

## Migration

Added additive migration:

```text
workers/d1/migrations/0009_credit_audit_repair_queue.sql
```

The migration creates `credit_audit_repair_queue` with:

- `status`: `pending`, `repaired`, `failed`, or future manual states
- `kind`: `credit_ledger`, `monthly_grant`, `admob_reward_transaction`, `purchase_transaction_mark`
- redacted searchable metadata: quota subject hash, transaction suffix, reward intent suffix
- `payload_json`: the minimum retry payload needed to recreate or complete D1 audit rows
- `attempt_count` and `last_error` for operational visibility

Read-only remote migration status was checked. Both remote databases report `0009_credit_audit_repair_queue.sql` as pending:

- `kabuyomi-history`
- `kabuyomi-history-test`

No migrations were applied.

## Previous Audit Gap

Before this patch, several paths could successfully mutate the per-user Durable Object and then fail to write D1 audit/coordination rows:

- credit ledger writes after grant, consume, or refund
- monthly grant rows after subscription/free-period grant mutation
- AdMob reward transaction / intent audit rows after a rewarded-ad DO grant
- purchase transaction mark-granted updates after a purchased-credit DO grant

That preserved user balance availability, but left incomplete audit evidence and no structured retry path.

## New Repair / Visibility Design

New library:

```text
workers/src/lib/credit-audit-repair.ts
```

It provides:

- `enqueueCreditAuditRepair`
- `processCreditAuditRepairQueue`

The queue item ID is deterministic from repair kind, operation ID, transaction ID, reward intent ID, and source. This makes enqueue retry idempotent.

New internal endpoint:

```text
POST /v1/internal/credit-audit/repair
```

It uses the existing internal-token pattern, accepts a bounded `limit` up to 50, processes queued rows, and returns counts only:

```json
{
  "scanned": 0,
  "repaired": 0,
  "failed": 0
}
```

The endpoint does not expose raw payloads.

## Covered Audit Paths

Covered in this patch:

- `credit_ledger`: failed ledger write after a DO mutation queues a repair row.
- `monthly_grant`: failed `monthly_grants` write after monthly grant mutation queues a repair row.
- `admob_reward_transaction`: failed `admob_reward_transactions` / intent mark after a DO rewarded-ad grant queues a repair row.
- `purchase_transaction_mark`: failed `purchase_transactions` mark-granted update after a DO purchase grant queues a repair row.

## Reconciliation Behavior

Repair processing recreates or completes D1 audit/coordination rows only:

- `credit_ledger`: `INSERT OR IGNORE`
- `monthly_grants`: `INSERT ... ON CONFLICT(operation_id) DO NOTHING`
- `admob_reward_transactions`: `INSERT OR IGNORE`, then mark matching pending intent granted
- `purchase_transactions`: update status to `granted`

Repair never calls `USER_QUOTA`, never grants credits, never consumes credits, and never increments the rewarded-ad daily cap.

If a repair fails, the row is marked `failed`, `attempt_count` increments, and `last_error` is stored in truncated form for later retry.

## Idempotency Behavior

The repair queue is idempotent at two levels:

- enqueue uses deterministic IDs and upserts pending rows without duplicating queue entries
- repair writes are idempotent and can be run repeatedly without changing DO balances

Tests verify:

- credit ledger repair writes the missing row exactly once
- running repair twice does not duplicate audit rows
- monthly grant repair is idempotent
- AdMob repair does not grant again or increment the daily cap again
- purchase mark-granted repair remains retry-safe after DO grant

## Logging / Redaction Behavior

PR1 redaction behavior was preserved.

New repair logs use:

- `auditKind`
- `repairStatus`
- `operationIdSuffix`
- `quotaSubjectHash`
- `transactionIdSuffix`
- `rewardIntentIdSuffix`
- `attemptCount`
- `errorClass`

They do not log raw device keys, full operation IDs, full transaction IDs, Apple payloads, AdMob payloads, SSV signatures, callback URLs, raw user questions, or source text.

The queue stores raw transaction/operation identifiers only where required to perform idempotent D1 audit repair. It does not store Apple JWS, SSV signatures, callback URLs, bearer tokens, private keys, or raw source/question text.

## Tests Added / Updated

Added `workers/test/credit-audit-repair.test.ts`:

- failed `credit_ledger` write after DO grant keeps the DO balance changed and queues repair
- repair writes the missing ledger audit row exactly once
- running repair twice is idempotent
- repair does not mutate the DO balance
- failed monthly grant audit write queues repair
- monthly grant repair is idempotent
- failed purchase mark-granted update queues repair and repairs to granted
- AdMob transaction audit repair writes D1 audit rows without granting again or incrementing caps
- repair log assertions verify full operation ID and quota subject are not emitted

Updated `workers/test/admob-rewards.test.ts`:

- failed AdMob D1 transaction audit write after a DO grant queues `admob_reward_transaction` repair state
- existing PR1 log redaction and PR2 daily cap/concurrency assertions still pass

Updated `workers/test/index.test.ts`:

- internal credit audit repair endpoint requires the internal token
- authorized repair endpoint returns count-only output

## Commands Run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
npm test -- credit-audit-repair
npm test -- admob-rewards
npm test -- user-quota
npm test -- credit-quota
npm test -- index
npm test
npm run dryrun:test
```

From `/Users/0xt4/t4dano/Kabuyomi`:

```bash
git diff --check
rg "audit|repair|credit_ledger|monthly_grants|admob_reward_transactions|purchase_transactions|operationId|transactionId|rewardIntentId|quotaSubject|signedTransaction|signature|callback" workers/src workers/test workers/d1
npx wrangler d1 migrations list kabuyomi-history --config workers/wrangler.toml --remote
npx wrangler d1 migrations list kabuyomi-history-test --config workers/wrangler.test.toml --remote
```

Validation results:

- `npm run typecheck`: passed
- `npm test -- credit-audit-repair`: passed, 4 tests
- `npm test -- admob-rewards`: passed, 25 tests
- `npm test -- user-quota`: passed, 33 tests
- `npm test -- credit-quota`: passed, 13 tests
- `npm test -- index`: passed, 35 tests
- full `npm test`: passed, 50 test files, 622 tests
- `npm run dryrun:test`: passed
- `git diff --check`: passed
- final `rg`: reviewed; remaining raw identifier matches are storage, request parsing, API responses, expected test fixtures, or redacted log suffix/hash fields
- remote D1 migration list: passed; `0009_credit_audit_repair_queue.sql` is pending for prod/test

## Failed Commands

None.

## Remaining Risks

- The new D1 migration must be applied before the repair queue can work in production.
- The internal repair endpoint is manual/batch-triggered only; this PR does not add a scheduled repair job.
- If queue insertion itself fails after an audit write failure, the system still only has redacted logs for that secondary failure.
- Repair queue payloads include raw IDs needed for idempotent D1 repair. They are not secret material, but D1 access should still be treated as operationally sensitive.
- This PR does not change subscription downgrade semantics or monthly grant product policy.
- No production deploy, production migration apply, or live repair smoke was performed in this task.

## Deploy / Migration Recommendation

Recommended next step is a reviewed migration-and-deploy gate:

1. Apply `0009_credit_audit_repair_queue.sql` to test D1.
2. Run test Worker smoke for an intentionally queued repair row.
3. Apply the migration to production D1.
4. Deploy the Worker.
5. Keep `/v1/internal/credit-audit/repair` internal-token gated and operate it with count-only output.

Do not deploy this patch without the migration, because repair enqueue calls depend on the new table.

## releaseDecision

releaseDecision: HOLD - NEXT P1 HARDENING PATCH REQUIRED
