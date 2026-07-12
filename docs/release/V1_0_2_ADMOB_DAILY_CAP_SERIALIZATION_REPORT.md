# V1.0.2 AdMob Daily Cap Serialization Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Conclusion

PR2 AdMob daily cap serialization is implemented.

The rewarded-ad daily cap is now enforced inside the per-user `USER_QUOTA` Durable Object, in the same serialized operation that grants rewarded ad credits. D1 still records reward intents and transactions for audit/coordination, but D1 row counts are no longer the authoritative SSV grant-time daily cap gate.

No iOS files, chat answer-quality logic, filing retrieval, model config, StoreKit verification, subscription grant semantics, credit pricing, deploy state, push state, or SEC Form Router work was changed in this PR.

## Files Changed

- `workers/src/durable/user-quota.ts`
- `workers/src/lib/contracts.ts`
- `workers/src/lib/quota.ts`
- `workers/src/routes/admob-rewards.ts`
- `workers/test/admob-rewards.test.ts`
- `workers/test/credit-quota.test.ts`
- `workers/test/user-quota.test.ts`
- `docs/release/V1_0_2_ADMOB_DAILY_CAP_SERIALIZATION_REPORT.md`

Existing dirty iOS files were not modified.

## Previous Race Condition

Before this patch, the SSV grant path did this:

```text
processSsvGrant
  -> count granted D1 rows for user/day
  -> if count < DAILY_REWARD_CAP
  -> grant through USER_QUOTA DO
  -> record D1 reward transaction
```

Concurrent valid callbacks for different pending intents could all observe the same stale D1 count before any callback recorded its successful transaction. That allowed more than 3 same-day rewards to pass the cap check.

## New Atomic Cap / Grant Design

The authoritative daily cap check moved into `UserQuotaDO`.

For `grantRewardedAdCredit`, the DO now accepts:

- `transactionId`
- `referenceId` / reward intent ID
- `credits`
- `promoExpiresAt`
- `dailyRewardDateKey`
- `dailyRewardCap`
- `operationId`

Inside the existing per-user serialized `blockConcurrencyWhile` operation, the DO now:

1. checks existing credit operation idempotency
2. loads a per-day rewarded-ad cap record from DO storage
3. returns a cap-reached no-op if the daily count is already at the cap
4. otherwise grants `+2` rewarded ad credits
5. increments the same-day rewarded count in DO storage
6. stores the credit operation result for idempotency
7. returns daily cap telemetry:
   - `dailyRewardsUsed`
   - `dailyRewardsRemaining`
   - `creditsRemaining`
   - granted / duplicate / cap-reached state

The daily cap record is keyed by user DO plus day, so cap decisions are serialized per user/day without adding a new Durable Object binding.

## Daily Cap Behavior

Maintained behavior:

- valid SSV grants exactly `+2` rewarded/ad promotional credits
- daily cap remains 3 successful rewards/day
- 4th same-day valid reward returns cap reached and does not grant
- cap resets on the next day
- failed or invalid callbacks do not increment the daily count
- reward status remains compatible for granted and capped/rejected states

The reward status route still uses D1 for normal audit-backed remaining-count display, but capped/rejected intents now report `dailyRemaining: 0` directly.

## Duplicate Transaction Behavior

Duplicate AdMob transactions remain idempotent.

- Existing D1 transaction duplicates still return `duplicate_ignored` before calling the DO.
- DO-level duplicate operation IDs return `duplicate_ignored` without adding credits or incrementing the daily cap count.
- Concurrent duplicate callbacks for the same transaction produce at most one grant.

## Concurrent Callback Behavior

New coverage proves the concurrency boundary:

- Route-level concurrent valid callbacks are handled as 3 successful grants and 2 cap-reached denials.
- DO-level concurrent valid grant calls for the same user/day serialize through `USER_QUOTA` and produce at most 3 grants total.
- DO-level concurrent duplicate transaction calls produce exactly 1 mutation and do not increment daily count twice.

## D1 Audit Behavior

D1 remains the audit/coordination store for:

- `admob_reward_intents`
- `admob_reward_transactions`

After the DO returns a successful grant, the route records the reward transaction and marks the intent granted in D1. If the D1 audit write fails after the DO grant, the behavior remains fail-fast as before, but the failure is now logged with redacted fields:

- `quotaSubjectHash`
- `transactionIdSuffix`
- `rewardIntentIdSuffix`

This PR does not solve general D1 audit completeness after DO mutation.

## Logging / Redaction Behavior

PR1 redaction behavior was preserved.

Production logs do not emit raw:

- transaction IDs
- ad unit IDs
- expected ad unit IDs
- reward intent IDs
- customData
- quota subjects
- SSV signatures
- callback URLs

The required final `rg` scan still finds raw identifier variable names and test fixture values. Those remaining matches are expected in storage, verification, API response, request parsing, and tests. Production log payloads use suffix/hash/presence fields.

## Tests Added / Updated

Updated `workers/test/admob-rewards.test.ts`:

- valid SSV grants still grant exactly `+2`
- route passes `dailyDateKey` and `dailyCap` into the grant bridge
- sequential cap reached path marks the intent rejected and does not grant
- concurrent valid callbacks accept at most 3 same-day grants
- concurrent duplicate callbacks grant at most once
- PR1 production log redaction assertion still passes
- existing invalid signature, invalid customData, expired intent, wrong amount/item, wrong ad unit, missing intent, client-only callback, duplicate callback, and reward status behavior still pass

Updated `workers/test/user-quota.test.ts`:

- rewarded ad grants are idempotent with daily cap telemetry
- concurrent same-user/day grant calls serialize and cap at 3
- concurrent duplicate transaction calls mutate once and leave daily count at 1
- next-day grant resets the daily cap

Updated `workers/test/credit-quota.test.ts`:

- rewarded ad credit bridge now includes `dailyDateKey` / `dailyCap`
- ledger behavior remains promotional/ad credit
- returned daily cap telemetry is asserted

## Commands Run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
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
rg "transactionId|transaction_id|adUnit|ad_unit|expectedAdUnit|rewardIntentId|customData|signature|quotaSubject|deviceKey" workers/src/routes/admob-rewards.ts workers/src/lib/quota.ts workers/src/durable/user-quota.ts workers/test/admob-rewards.test.ts
git diff --stat -- workers/src/lib/contracts.ts workers/src/lib/quota.ts workers/src/durable/user-quota.ts workers/src/routes/admob-rewards.ts workers/test/admob-rewards.test.ts workers/test/credit-quota.test.ts workers/test/user-quota.test.ts
```

Validation results:

- `npm run typecheck`: passed
- focused tests: passed
- full `npm test`: 49 files passed, 615 tests passed
- `npm run dryrun:test`: passed
- `git diff --check`: passed

## Failed Commands

None.

## Remaining Risks

- This PR does not solve general D1 audit completeness after a successful DO mutation.
- Reward intent creation and normal reward-status remaining-count display still use D1 counts as a user-facing snapshot. The authoritative grant-time cap is now DO-backed.
- This PR does not change subscription downgrade/upgrade audit semantics.
- This PR does not change StoreKit verification, model behavior, chat quality, filing retrieval, or iOS UI behavior.
- No production deploy or live AdMob SSV smoke was performed in this task.

## Deploy Recommendation

Deploy may be considered after code review and the normal predeploy gate because local validation and dry-run passed. No deploy was performed in this task.

This is still not final release approval because the hardening sequence has remaining P1 work.

## releaseDecision

releaseDecision: HOLD - NEXT P1 HARDENING PATCH REQUIRED
