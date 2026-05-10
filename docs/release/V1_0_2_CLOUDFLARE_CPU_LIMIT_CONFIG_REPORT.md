# V1.0.2 Cloudflare CPU Limit Config Report

## conclusion

Applied the minimal production Worker CPU limit config recommended after the `/v1/chat` post-generation charge hotfix.

`workers/wrangler.toml` now sets Cloudflare Worker CPU time to 30 seconds:

```toml
[limits]
cpu_ms = 30000
```

No production deploy was run. No iOS files, answer-quality logic, filing retrieval logic, model config, subscription UI, or rewarded ad UI were changed in this task.

## files changed

- `workers/wrangler.toml`
- `docs/release/V1_0_2_CLOUDFLARE_CPU_LIMIT_CONFIG_REPORT.md`

Pre-existing unrelated dirty iOS files and prior Worker hotfix files remain in the worktree, but this task only edited the production Worker config and this report.

## exact cpu limit config

Production config:

```toml
[limits]
cpu_ms = 30000
```

Test config:

- `workers/wrangler.test.toml` was not changed.
- Reason: requested validation uses the test config dry-run, and it already passes without a `[limits]` block. The release capacity change is specifically for the production Worker. If parity becomes desirable later, the same `[limits] cpu_ms = 30000` can be added to test config as a separate explicit change.

## config values left unchanged

Confirmed unchanged:

- `HARD_INTENT_TARGETED_RETRIEVAL_MODE = "diagnostic"`
- `OPENAI_CHAT_MODEL = "gpt-5-nano"`
- `OPENAI_REASONING_EFFORT = "low"` in production
- `OPENAI_REASONING_EFFORT = "minimal"` in test
- `OPENAI_MAX_COMPLETION_TOKENS = "1800"`

No `300000` CPU setting was added.

## commands run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
npm test
npm run dryrun:test
```

From `/Users/0xt4/t4dano/Kabuyomi`:

```bash
git diff --check
rg "\[limits\]|cpu_ms|HARD_INTENT_TARGETED_RETRIEVAL_MODE|OPENAI_CHAT_MODEL|OPENAI_REASONING_EFFORT|OPENAI_MAX_COMPLETION_TOKENS" workers/wrangler.toml workers/wrangler.test.toml
```

## validation result

- `npm run typecheck`: passed.
- `npm test`: passed, 48 test files / 603 tests.
- `npm run dryrun:test`: passed, Wrangler test dry-run completed.
- `git diff --check`: passed.
- Config grep confirmed production has `[limits] cpu_ms = 30000`, while test config has no `[limits]` block.

## failed commands

None.

## whether production deploy is now safe to run

Production deploy is locally safe to run after explicit approval.

Rationale:

- The config change is minimal and limited to `workers/wrangler.toml`.
- Worker typecheck, full tests, and Wrangler test dry-run passed.
- No model config, retrieval behavior, answer-quality logic, or credit ledger safety was changed by this config task.

Deploy was intentionally not run because this task explicitly required no production deploy unless separately instructed after local validation.

## smoke test plan

After explicit deploy approval, validate with a fresh Simulator/TestFlight-style user:

1. Confirm fresh user starts at 50 credits.
2. Send repeated `/v1/chat` messages until at least 10 successful sends or the previous failure point.
3. Confirm each successful answer consumes exactly 2 credits.
4. Confirm no failed HTTP 503 request consumes credits.
5. Confirm HTTP 402 appears only when the user is actually insufficient.
6. Confirm Worker tail has no `exceededCpu` outcome for `/v1/chat`.
7. Confirm compact `chat_quality_pipeline` logs do not include raw question text, `selectedSourceExcerpts`, `selectedSourceTextPreview`, or `sourceGateEvidenceSlots`.
8. Confirm `chat_credit_preflight_passed`, `chat_generation_started`, `chat_generation_succeeded`, `chat_charge_commit_attempted`, `chat_charge_commit_succeeded`, and `chat_response_returned` appear in the expected order for successful chargeable chats.
9. Confirm any generation failure before final charge logs `chat_generation_failed_before_charge` and does not produce a `credit_consume` ledger mutation.
10. Confirm iOS insufficient-credit recovery UI still appears for true insufficient-credit state.

Useful Worker tail filters:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler tail kabuyomi-api --format=json --search="/v1/chat"
```

Suggested safe evidence fields:

- response status
- Worker outcome
- `event`
- `chargeStage`
- `charged`
- `creditsRemaining`
- `creditDelta`
- operation ID suffix only
- quota subject suffix/hash only
- `diagnosticsLevel`
- selected source counts/chars only

Do not capture or share raw device keys, full operation IDs, full transaction IDs, raw prompts/questions, raw source excerpts, secrets, callback URLs, AdMob unit IDs, SSV signatures, or Apple payloads.

## releaseDecision

releaseDecision: HOLD until production/TestFlight smoke passes.
