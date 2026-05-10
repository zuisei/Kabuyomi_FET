# V1.0.2 Final Hardening Deploy Smoke Report

## conclusion

The final Worker hardening migration/deploy gate was run through production migration and production deploy.

Passed:

- local preflight validation
- test D1 migration
- test Worker deploy
- test Worker smoke after a stale smoke fixture was corrected
- production D1 migration
- production Worker deploy
- production chat credit safety smoke
- production CPU smoke for the exercised `/v1/chat` path
- production log compactness for chat diagnostics
- production internal repair endpoint unauthorized gating
- production AdMob invalid SSV no-grant smoke

Not fully passed:

- authorized production `/v1/internal/credit-audit/repair` smoke was not executed because the local environment did not have the `BACKFILL_SHARED_SECRET` value. Wrangler confirms the production secret exists, but its value is not retrievable from Wrangler.
- live Apple subscription downgrade/no-clawback smoke was not executed because no safe live Apple sandbox/production transaction fixture was available in this environment. The behavior remains covered by local tests and the deployed version includes PR4.

Because the authorized repair endpoint count-only smoke was a required release-candidate condition, this gate remains `HOLD`.

## preflight results

Repository:

- path: `/Users/0xt4/t4dano/Kabuyomi`
- branch: `v1.0.2-subscription-rewarded-credits`

Preflight commands:

- `npm run typecheck`: passed
- `npm test`: passed, `50` test files / `626` tests
- `npm run dryrun:test`: passed
- `git diff --check`: passed
- `git status --short`: dirty release branch; pre-existing iOS files remained untouched by this gate
- remote D1 migration list before apply:
  - `kabuyomi-history-test`: `0009_credit_audit_repair_queue.sql` pending
  - `kabuyomi-history`: `0009_credit_audit_repair_queue.sql` pending

Production CPU limit config remains present:

```text
workers/wrangler.toml:[limits]
workers/wrangler.toml:cpu_ms = 30000
```

## test D1 migration result

Command:

```bash
npx wrangler d1 migrations apply kabuyomi-history-test --config workers/wrangler.test.toml --remote
```

Result:

- applied `0009_credit_audit_repair_queue.sql`
- Wrangler executed 4 commands
- migration status: success

Confirmation:

```bash
npx wrangler d1 migrations list kabuyomi-history-test --config workers/wrangler.test.toml --remote
```

Result:

- `No migrations to apply`

## test Worker deploy/smoke result

Test deploy command:

```bash
npm run deploy:test
```

Result:

- deployed Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- version ID: `3b19e2a5-c900-4b20-b69f-5e5ecb6807c6`
- Wrangler warning: local deploy used Wrangler `4.81.1`; update available `4.90.0`

Initial test smoke command:

```bash
npm run smoke:test
```

Initial result:

- failed at `billing/sync`
- cause: stale smoke fixture used unsupported product ID `app.kabuyomi.pro.monthly`
- current catalog product ID is `kabuyomi.sub.pro.monthly`

Minimal blocker fix:

- updated `workers/smoke/staging-worker.js` to use `kabuyomi.sub.pro.monthly`
- no Worker product behavior was changed
- no iOS files were modified

Retest:

```bash
npm run smoke:test
```

Result:

- passed
- smoke covered usage baseline, search, watchlist add/remove, company, chat, chat-history, and billing/sync inactive/invalid-active guard behavior

## production D1 migration result

Command:

```bash
npx wrangler d1 migrations apply kabuyomi-history --config workers/wrangler.toml --remote
```

Result:

- applied `0009_credit_audit_repair_queue.sql`
- Wrangler executed 4 commands
- migration status: success

Confirmation:

```bash
npx wrangler d1 migrations list kabuyomi-history --config workers/wrangler.toml --remote
```

Result:

- `No migrations to apply`

## production Worker deploy result

Command:

```bash
npm run deploy
```

Result:

- deployed Worker: `kabuyomi-api`
- URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- deployed version ID: `521c50fd-0d39-4943-838d-f9926e37849b`
- deploy observed at approximately `2026-05-10T08:10:38Z` / `2026-05-10 17:10:38 JST`
- upload size: `1190.71 KiB`, gzip `238.68 KiB`
- Worker startup time: `12 ms`
- Wrangler warning: local deploy used Wrangler `4.81.1`; update available `4.90.0`

Bindings/config summary from deploy:

- Durable Objects: `SEC_RATE_LIMITER`, `FILING_LOCK`, `USER_QUOTA`, `ENTITLEMENT`
- KV: `KABUYOMI_CACHE`
- D1: `kabuyomi-history`
- R2: `kabuyomi-filings`
- scheduled trigger: `0 18 * * *`
- model config unchanged in deploy output:
  - `LLM_PROVIDER = openai`
  - `OPENAI_CHAT_MODEL = gpt-5-nano`
  - `OPENAI_REASONING_EFFORT = low`
  - `OPENAI_MAX_COMPLETION_TOKENS = 1800`
  - `HARD_INTENT_TARGETED_RETRIEVAL_MODE = diagnostic`
- production `[limits] cpu_ms = 30000` remains in `workers/wrangler.toml`

## deployed Worker version/id

```text
Worker: kabuyomi-api
Version ID: 521c50fd-0d39-4943-838d-f9926e37849b
```

## chat credit safety smoke result

Production smoke used a fresh generated device identity and did not expose the raw device key.

Result:

- initial credits: `50`
- chat attempts: `26`
- successful chargeable chats: `25`
- failed chargeable chats before insufficient state: `0`
- final credits: `0`
- each successful chat consumed exactly `2` credits
- no failed request consumed credits
- true insufficient-credit request returned HTTP `402`
- insufficient-credit request did not consume credits
- HTTP `503` count from the smoke script: `0`
- tail `chat_charge_commit_succeeded` count: `25`
- tail `credit_consume` count: `25`

Smoke result payload summary:

```json
{
  "initialCredits": 50,
  "finalCredits": 0,
  "chatAttempts": 26,
  "successCount": 25,
  "failureCount": 0,
  "failedConsumed": false,
  "perSuccessChargedExactly2": true,
  "http503Count": 0,
  "insufficientStatus": 402,
  "insufficientDidNotConsume": true
}
```

## log redaction smoke result

Tail path:

```text
/Users/0xt4/t4dano/Kabuyomi/tmp/kabuyomi-worker-tail-v1.0.2-final-hardening-smoke.jsonl
```

Tail capture:

- `7806` lines
- size: `462 KiB`
- all captured Worker events used deployed script version `521c50fd-0d39-4943-838d-f9926e37849b`

Tail analysis:

- `exceededCpu`: `0`
- `Worker exceeded CPU time limit`: `0`
- exact HTTP response status `503`: `0`
- compact chat diagnostics remained compact:
  - `selectedSourceExcerpts`: `0`
  - `selectedSourceTextPreview`: `0`
  - `sourceGateEvidenceSlots`: `0`
  - `originalQuestion`: `0`
  - `rewrittenQuestion`: `0`
  - `signedTransactionInfo`: `0`
  - `signedPayload`: `0`
- Cloudflare request metadata showed `x-device-key` only as `REDACTED`
- application logs used suffix/hash fields such as `quotaSubjectHash`, `quotaSubjectSuffix`, and `operationIdSuffix`

Documented tail findings:

- `signature` appeared only in the synthetic invalid AdMob SSV smoke:
  - application log field: `signaturePresent: true`
  - Cloudflare request URL metadata contained the literal test-safe query `signature=invalid`
- `custom_data=invalid` appeared once in Cloudflare request URL metadata for the same synthetic invalid SSV smoke
- no real AdMob payload, Apple payload, raw question text, source excerpt, or raw device key was observed in application logs

## credit audit repair endpoint smoke result

Unauthorized production request:

- `POST /v1/internal/credit-audit/repair` without token
- result: HTTP `401`
- behavior: gated as expected

Authorized production request:

- not executed
- reason: local environment did not contain `BACKFILL_SHARED_SECRET`
- `npx wrangler secret list --config workers/wrangler.toml` confirms `BACKFILL_SHARED_SECRET` exists as a deployed Worker secret
- Wrangler cannot reveal secret values, so a live authorized request could not be made from this environment without the secret value

Local route tests still cover authorized count-only behavior, but this gate required live authorized smoke. This is the reason for `releaseDecision: HOLD`.

## AdMob reward smoke result

Production-safe smoke performed:

- invalid SSV callback to `/v1/admob/ssv`
- result: HTTP `401`
- application log: `rewarded_ad_ssv_invalid_signature`
- result: no grant path exercised

Daily cap serialization remains covered by local tests and was deployed in version `521c50fd-0d39-4943-838d-f9926e37849b`; no live real-reward callback was run.

## billing/subscription downgrade smoke result

Live Apple subscription sync downgrade/no-clawback smoke was not run.

Reason:

- no safe live Apple sandbox/production transaction fixture was available in this environment
- using fake transaction payloads against production would be rejected by Apple verification and would not prove downgrade semantics

Covered by deployed local validation:

- active Lite sync grants `400` monthly credits once
- active Pro sync grants `900` monthly credits once
- active Max sync grants `2000` monthly credits once
- duplicate sync does not double grant
- Lite -> Pro same-period upgrade grants `+500` once
- Pro -> Max same-period upgrade grants `+1100` once
- Pro -> Lite same-period downgrade does not subtract credits
- Max -> Pro same-period downgrade does not subtract credits
- downgrade no-clawback is idempotent
- inactive expiration does not grant subscription credits
- purchased paid credits are not touched

## tail log path

```text
/Users/0xt4/t4dano/Kabuyomi/tmp/kabuyomi-worker-tail-v1.0.2-final-hardening-smoke.jsonl
```

## commands run

From `workers/`:

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run deploy:test
npm run smoke:test
npm run deploy
```

From repo root:

```bash
git diff --check
git status --short
rg "\[limits\]|cpu_ms" workers/wrangler.toml workers/wrangler.test.toml
npx wrangler d1 migrations list kabuyomi-history-test --config workers/wrangler.test.toml --remote
npx wrangler d1 migrations list kabuyomi-history --config workers/wrangler.toml --remote
npx wrangler d1 migrations apply kabuyomi-history-test --config workers/wrangler.test.toml --remote
npx wrangler d1 migrations list kabuyomi-history-test --config workers/wrangler.test.toml --remote
npx wrangler d1 migrations apply kabuyomi-history --config workers/wrangler.toml --remote
npx wrangler d1 migrations list kabuyomi-history --config workers/wrangler.toml --remote
npx wrangler secret list --config workers/wrangler.toml
npx wrangler tail kabuyomi-api --format=json | tee /Users/0xt4/t4dano/Kabuyomi/tmp/kabuyomi-worker-tail-v1.0.2-final-hardening-smoke.jsonl
rg "exceededCpu|Worker exceeded CPU time limit|response.*503|credit_consume|credit_refund|chat_charge_commit|credit_audit_repair|admob|billing_sync|monthly-downgrade-no-clawback" tmp/kabuyomi-worker-tail-v1.0.2-final-hardening-smoke.jsonl
rg "selectedSourceExcerpts|selectedSourceTextPreview|sourceGateEvidenceSlots|originalQuestion|rewrittenQuestion|signedTransactionInfo|signedPayload|signature|callback|deviceKey" tmp/kabuyomi-worker-tail-v1.0.2-final-hardening-smoke.jsonl
```

Additional ad hoc smoke/diagnostic commands were run with generated device identifiers and redacted output:

- production `/v1/usage`
- production `/v1/watchlist/add`
- production `/v1/chat` loop through 25 successful charges plus one 402
- production `/v1/internal/credit-audit/repair` unauthorized request
- production `/v1/admob/ssv` invalid-signature request

## failed commands

- Initial `npm run smoke:test` failed at `billing/sync` because the smoke fixture used stale product ID `app.kabuyomi.pro.monthly`. The smoke fixture was corrected to `kabuyomi.sub.pro.monthly`, then `npm run smoke:test` passed.
- One diagnostic `node` command failed because top-level `await` was used in stdin CommonJS mode. It was immediately rerun with an async wrapper and succeeded.
- One inspection `rg` command used a bad path from inside `workers/` and exited with a path error; the relevant route/auth files were then inspected successfully.
- One exact multiline `rg` attempt used `\n` without multiline mode. Exact HTTP `503` status was checked with a simpler pattern afterward and found no matches.

## remaining risks

- Live Apple subscription downgrade/no-clawback behavior remains not live-smoked; it is covered by local tests and deployed code version evidence.
- Production tail captures Cloudflare request URL metadata. The synthetic invalid AdMob SSV smoke used literal test-safe query values, and those appeared in tail request metadata. Application logs correctly used `signaturePresent` and did not log raw SSV payloads.
- No real AdMob rewarded grant was run in production; invalid SSV no-grant was verified, and daily cap serialization remains covered by tests.
- The release branch remains dirty and contains pre-existing iOS changes. This gate did not modify iOS files.

## authorized repair endpoint follow-up smoke

- timestamp: `2026-05-10T08:25:48Z` / `2026-05-10 17:25:48 JST`
- Worker version: `521c50fd-0d39-4943-838d-f9926e37849b`
- endpoint: `POST /v1/internal/credit-audit/repair`
- unauthorized status: `401`
- authorized status: `200`
- authorized response shape: count-only JSON
- raw payloads exposed: no
- secret printed/logged: no
- result: passed

## releaseDecision

releaseDecision: RELEASE CANDIDATE - WORKER HARDENING PASSED
