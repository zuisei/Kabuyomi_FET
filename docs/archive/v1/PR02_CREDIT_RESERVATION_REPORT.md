# PR-02 Atomic Credit and Quota Reservation Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-10 JST

Repository: `zuisei/Kabuyomi_FET`

Working branch: `main`

Audited base commit: `b61602ef55e2499cccd46e32f53e29bb61c83aa7`

## 1. Conclusion

PR-02 is complete in the current uncommitted working tree. The PR-01 request-execution transition now atomically reserves credit or a legacy chat slot before provider work, commits the exact reservation with the replayable result, releases it on failure or non-chargeable output, and expires orphaned reservations through Durable Object alarms plus lazy cleanup.

KBY-P0-03 is closed by implementation and adversarial tests. Product release remains `HOLD`; entitlement, stable-principal, anonymous-identity, and financial-correctness P0 findings remain.

## 2. Audit-claim verification table

| Claim | Baseline classification | Remediated proof |
|---|---|---|
| Chat only checked affordability before model work | Confirmed | Request begin now subtracts/reserves exact buckets in the same DO transition that elects the leader. |
| Parallel unique requests could all reach the provider | Confirmed | Balance-2/ten-request and balance-4/ten-request tests cap leaders/provider-eligible work at one and two respectively. |
| Post-generation consume could fail after provider cost | Confirmed | Provider paths no longer call `consumeCredit`/`consumeChat`; completion commits an existing reservation without a second deduction. |
| Worker termination could strand value | Confirmed risk | Five-minute due-index alarms and lazy begin cleanup expire and restore eligible allocations idempotently. |
| Aggregate rewarded-ad balance could not restore exact expiries | Confirmed | Credit state now lazily migrates to FEFO promotional lots and reservations retain exact lot IDs/expiries. |
| Legacy non-credit chat path was unprotected | Confirmed | It reserves one date-keyed daily slot before provider work and restores only that original day on failure/expiry. |

## 3. Implementation summary

- Extended the PR-01 begin contract with a discriminated reservation intent: `credits`, `legacy_chat`, or `unmetered`.
- New request execution atomically creates the pending execution, reservation, due index, and balance/slot mutation under one per-principal storage transaction.
- Credit allocation order is monthly, rewarded-ad lots by earliest expiry, then purchased.
- Completion atomically commits a chargeable reservation, persists allocation-aware credit operation metadata, and stores the replayable result.
- Non-chargeable completion stores the replayable result with zero charge and releases eligible value.
- Provider/schema/finalizer failures release the exact reservation and terminalize the execution.
- Purchased credit always restores to purchased. Monthly credit restores only to the identical unexpired period. Promotional credit restores only to its same unexpired lot; expired promotional value is discarded and never converted.
- Added a sortable due index and one multiplexed Durable Object alarm. Alarm delivery and lazy cleanup are idempotent.
- Existing PR-01 completed/failed records remain replayable. A legacy pending record without reservation fails closed and cannot be promoted to a leader.
- Route/use-case model paths no longer call credit consume/refund or chat preflight/consume/refund helpers.
- D1 ledger persistence remains an idempotent audit side effect after the atomic DO truth; duplicate completion re-emits the same operation for `INSERT OR IGNORE` repair.

## 4. Files changed

- `workers/src/lib/contracts.ts`
- `workers/src/lib/request-execution.ts`
- `workers/src/lib/quota.ts`
- `workers/src/lib/credit-operation.ts`
- `workers/src/durable/user-quota.ts`
- `workers/src/lib/chat/usecase.ts`
- `workers/src/routes/chat.ts`
- `workers/src/routes/translate-quote.ts`
- `workers/test/user-quota.test.ts`
- `workers/test/chat-route.test.ts`
- `workers/test/quote-translation-route.test.ts`

## 5. Schema and migration changes

No D1 migration, new Durable Object class, binding, or Wrangler migration tag is required for PR-02. New execution-linked reservation and rewarded-ad lot records are additive keys/fields in the existing `UserQuotaDO` storage. Legacy aggregate rewarded-ad state is converted lazily and idempotently on read.

No remote migration or production state change was performed.

## 6. State-machine or data-flow changes

```text
NEW
  -> atomically reserve exact credit/slot + RESERVED leader
  -> provider outside DO
  -> chargeable success: atomically COMMITTED + completed result
  -> non-chargeable success: atomically RELEASED + completed result
  -> normal failure: atomically RELEASED + failed execution
  -> TTL/alarm: atomically EXPIRED + failed execution
```

Forbidden transitions are `COMMITTED -> RELEASED`, `RELEASED -> COMMITTED`, `EXPIRED -> COMMITTED`, and any terminal state back to `RESERVED`. Duplicate commit, release, failure, and alarm delivery are no-ops.

## 7. Tests added or updated

- Balance 2 with ten concurrent unique chats: one reservation/provider-eligible leader maximum.
- Balance 4 with ten concurrent unique chats: two leaders maximum.
- Twenty exact duplicates: one reservation and one provider call.
- Monthly, multi-expiry rewarded-ad, and purchased allocation order and exact restoration.
- Month boundary, promotional expiry while reserved, duplicate commit/release, late commit, non-chargeable completion, and v1 compatibility.
- Alarm, repeated alarm, staggered alarm, lazy cleanup, and no-orphan terminal assertions.
- Legacy chat reservation/restore and unmetered translation token.
- Provider exception/finalizer rejection release and fresh-usage response.
- Route tests assert there are no post-generation consume/refund calls.

## 8. Commands run and exact results

| Command | Result |
|---|---|
| `npx vitest run test/user-quota.test.ts test/chat-route.test.ts test/quote-translation-route.test.ts` | PASS, 98/98 |
| `npx tsc --noEmit --pretty false` | PASS, 0 errors at PR-02 completion |
| `git diff --check` | PASS |
| `npm run migrations:validate` | PASS; PR-02 adds no migration |

The full Worker suite was rerun during integration. The reservation, chat, and translation suites were green; temporary failures were isolated to independently concurrent Apple signed-data fixture hardening and were not reservation/accounting failures. No Worker deploy or remote migration ran.

## 9. Security and privacy review

- Reservations are per-principal and serialized in the existing quota DO.
- Provider calls occur only after a successful reservation and remain outside the DO storage gate.
- Reservation events contain only redacted principal hash, short operation/reservation suffixes, route, mode, status, and non-identifying credit counts.
- No question, conversation, source text, result body, raw identity, or full operation ID is logged.
- Due-index entries contain operation IDs only inside principal-isolated DO storage and are removed at terminal transition.
- Failure to establish a storage transaction aborts without electing a provider leader.

## 10. Backward-compatibility review

Existing balance fields and public usage aggregates remain available. Existing consume/refund APIs remain for non-execution compatibility, while chat/translation no longer use them. Existing completed/failed PR-01 records replay; pending records without a linked reservation fail closed. The rollout must therefore drain or keep generation disabled for at least the reservation TTL if PR-01 had ever been deployed alone; it was not deployed during this work.

## 11. Unresolved risks

- D1 credit ledger is an audit replica, not the hot atomic balance. Its existing repair queue remains necessary if the post-DO audit write fails.
- Real Cloudflare alarm delivery was not exercised because production/test deployment is prohibited; the state machine and alarm retries were tested with the serialized storage fake.
- KBY-P0-01, KBY-P0-04, KBY-P0-05, and KBY-P0-06 remain release blockers.

## 12. Rollback or disable procedure

Disable chat and quote translation before rolling code back. Allow or force-expire outstanding five-minute reservations first; do not delete reservation/execution keys independently. Reverting the code without draining could leave value reserved until a compatible cleanup path runs. Never rewrite an expired promotional allocation as purchased credit.

## 13. releaseDecision

`releaseDecision: HOLD`

Server-authoritative entitlement, stable subscription principal, anonymous identity, and financial correctness work remain mandatory.
