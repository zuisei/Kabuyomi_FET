# V1.0.2 Production Chat CPU / Credit Smoke Report

## conclusion

Production deploy succeeded after Workers Paid activation, and the focused production `/v1/chat` CPU/credit smoke passed.

The deployed Worker includes:

- Post-generation chat credit charge hotfix.
- Compact production chat diagnostics.
- Production Cloudflare Worker CPU limit:

```toml
[limits]
cpu_ms = 30000
```

## whether Workers Paid activation was effective

Yes.

The previous deploy failed with Cloudflare API error `100328` because CPU limits were not supported for the Free plan. After Workers Paid activation, the same production config with `[limits] cpu_ms = 30000` deployed successfully without removing the CPU limit.

## deploy result

Result: succeeded.

- Worker name: `kabuyomi-api`
- Production URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Deploy timestamp: `2026-05-10 15:30:06 JST`
- Wrangler version: `4.81.1`
- Wrangler warning: update available `4.90.0`
- Worker startup time: `13 ms`
- Upload: `1168.11 KiB / gzip: 234.93 KiB`
- Trigger: `schedule: 0 18 * * *`

Production bindings printed during deploy confirmed the expected config remained:

- `OPENAI_CHAT_MODEL = "gpt-5-nano"`
- `OPENAI_REASONING_EFFORT = "low"`
- `OPENAI_MAX_COMPLETION_TOKENS = "1800"`
- `HARD_INTENT_TARGETED_RETRIEVAL_MODE = "diagnostic"`
- `APPLE_APP_STORE_SERVER_ENVIRONMENT = "auto"`

## deployed Worker version/id

`b41d10a6-c07f-42aa-9055-332b947e2e44`

## smoke result

Passed for the focused production API smoke.

Smoke shape:

- Fresh production device-key style user.
- Filing: AAPL current cached filing from production `/v1/company/AAPL`.
- One failed `/v1/chat` request before successful sends using a missing filing key.
- 25 successful chargeable `/v1/chat` sends.
- One final true insufficient-credit `/v1/chat` request.

The retained Worker tail file was sanitized after capture to remove full internal operation IDs and full hashed user IDs while preserving event names, status, credit deltas, suffixes, and ordering evidence.

## initial credits

`50`

## final credits

`0`

## successful chat count

`25`

This goes beyond the requested minimum of 10 sends and reaches the true insufficient-credit boundary.

## failed request count

`2`

- One missing-filing `/v1/chat` request returned `404` and did not consume credits.
- One true insufficient-credit `/v1/chat` request returned `402`.

## whether successful chats consumed exactly 2 credits

Yes.

The API response sequence showed every successful chargeable answer consumed exactly `2` credits:

```text
50 -> 48 -> 46 -> 44 -> 42 -> 40 -> 38 -> 36 -> 34 -> 32 -> 30 -> 28 -> 26 -> 24 -> 22 -> 20 -> 18 -> 16 -> 14 -> 12 -> 10 -> 8 -> 6 -> 4 -> 2 -> 0
```

Tail analysis also found:

- `25` smoke-device `chat_charge_commit_succeeded` events with `creditDelta: -2`.
- `25` smoke-device `chat_response_returned` events with status `200`.

## whether any failed request consumed credits

No evidence of failed-request credit consumption.

- Initial credits: `50`.
- Missing-filing failed request: HTTP `404`.
- Credits after the missing-filing failed request: `50`.
- True insufficient-credit request: HTTP `402`, `creditsRemaining: 0`.
- Final credits: `0`.

## whether any exceededCpu occurred

No.

Tail search found no matches for:

```text
exceededCpu
Worker exceeded CPU time limit
```

## whether any HTTP 503 occurred

No.

Tail search found no `503` response pattern, and all 25 successful smoke chat sends returned HTTP `200`.

## whether true 402 behavior works

Yes.

After 25 successful chargeable chats reduced credits to `0`, the next `/v1/chat` request returned:

```text
HTTP 402
error: insufficient_credits
creditsRemaining: 0
```

## whether insufficient-credit recovery UI still appears

Simulator recovery-state coverage passed.

Because the production API smoke was run with a fresh production device-key style user, I separately ran the focused iOS Simulator tests for the recovery path on iPhone 16e / iOS 18.5:

```text
KabuyomiTests/AppModelTests/testSendChatServerInsufficientCreditsOpensRecoveryState
KabuyomiTests/AppModelTests/testInsufficientCreditRecoveryTracksWhenCreditsBecomeSufficient
KabuyomiTests/AppModelTests/testClosingInsufficientCreditRecoveryClearsRecoveryState
```

Result: `3 passed / 0 failed`.

No iOS source files were modified in this task.

## whether diagnostics stayed compact

Yes.

Tail search found no forbidden verbose production chat fields:

```text
selectedSourceExcerpts
selectedSourceTextPreview
sourceGateEvidenceSlots
originalQuestion
rewrittenQuestion
```

Observed `chat_quality_pipeline` events used:

```text
diagnosticsLevel: compact
```

## successful lifecycle order

Confirmed in tail for the smoke-device successful chats. The first smoke-device successful chat showed the expected order:

```text
chat_credit_preflight_passed
chat_generation_started
chat_generation_succeeded
chat_charge_commit_attempted
chat_charge_commit_succeeded
chat_response_returned
```

## tail log path

```text
/Users/0xt4/t4dano/Kabuyomi/tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl
```

The saved file is sanitized.

## commands run

Pre-deploy verification:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
```

Repo checks:

```bash
cd /Users/0xt4/t4dano/Kabuyomi
git diff --check
git status --short
rg "\[limits\]|cpu_ms|HARD_INTENT_TARGETED_RETRIEVAL_MODE|OPENAI_CHAT_MODEL|OPENAI_REASONING_EFFORT|OPENAI_MAX_COMPLETION_TOKENS" workers/wrangler.toml workers/wrangler.test.toml
```

Deploy:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler --version
npm run deploy
```

Tail:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler tail kabuyomi-api --format=json --search="/v1/chat" \
  | tee /Users/0xt4/t4dano/Kabuyomi/tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl
```

Smoke:

```bash
cd /Users/0xt4/t4dano/Kabuyomi
node
```

The Node smoke used production `/v1/usage`, `/v1/company/AAPL`, and `/v1/chat` with a fresh production device-key style user. It printed only sanitized credit/status summary values.

Tail analysis:

```bash
cd /Users/0xt4/t4dano/Kabuyomi
rg "exceededCpu|Worker exceeded CPU time limit|response.*503|credit_consume|credit_refund|chat_credit_preflight|chat_generation|chat_charge_commit|chat_response_returned|chat_quality_pipeline" \
  tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl

rg "selectedSourceExcerpts|selectedSourceTextPreview|sourceGateEvidenceSlots|originalQuestion|rewrittenQuestion" \
  tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl
```

Simulator recovery tests:

```text
XcodeBuildMCP test_sim
-only-testing:KabuyomiTests/AppModelTests/testSendChatServerInsufficientCreditsOpensRecoveryState
-only-testing:KabuyomiTests/AppModelTests/testInsufficientCreditRecoveryTracksWhenCreditsBecomeSufficient
-only-testing:KabuyomiTests/AppModelTests/testClosingInsufficientCreditRecoveryClearsRecoveryState
```

Tail sanitization:

```bash
perl -0pi -e '...' tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl
```

## validation results

- `npm run typecheck`: passed.
- `npm test`: passed, 48 test files / 603 tests.
- `npm run dryrun:test`: passed.
- `git diff --check`: passed.
- Config grep: passed; production has `[limits] cpu_ms = 30000`, and model/retrieval config remained unchanged.
- `npm run deploy`: passed.
- Production API smoke: passed.
- Tail CPU/503 search: no matches.
- Tail forbidden verbose-field search: no matches.
- Focused iOS Simulator recovery tests: passed, 3 tests.

## failed commands

None.

The forbidden verbose-field `rg` intentionally returned no matches.

## remaining risks

- This was a focused production `/v1/chat` CPU/credit safety smoke, not a full TestFlight release regression pass.
- The live production API smoke used direct production HTTP requests with a fresh device-key style user rather than manually tapping through a TestFlight UI session.
- The insufficient-credit recovery UI path was covered by focused iOS Simulator tests, not by a new screenshot-based manual UI walkthrough in this run.
- Tail captured a small amount of unrelated live `/v1/chat` traffic before the smoke-device sequence; no CPU/503/verbose-field issues were found in the whole retained tail file.

## releaseDecision

releaseDecision: RELEASE CANDIDATE - CHAT CPU/CREDIT SAFETY PASSED
