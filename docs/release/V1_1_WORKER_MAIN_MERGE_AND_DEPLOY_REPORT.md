# Kabuyomi v1.1 Worker Main Merge and Production Deploy Report

Date: 2026-05-08

## Executive Summary

The committed v1.1 Worker quality branch was merged into `main`, production Worker config was aligned with the accepted v1.1 model decision, final local validation passed, and the production Worker was deployed successfully.

Release decision: `PRODUCTION DEPLOYED - SMOKE PASSED`

Key outcome:

- Source branch: `v1.1-worker-quality-token-retrieval`
- Source branch HEAD: `0d0af30` (`Accept Q06 safe fallback for v1.1`)
- `main` before merge: `e03faab` (`Hide StoreKit diagnostics in release settings UI`)
- Merge commit: `4842a97` (`Merge branch 'v1.1-worker-quality-token-retrieval'`)
- Production config commit: `8fea094` (`Set production Worker reasoning effort low`)
- Production Worker version: `08c23d87-5bdc-4078-9831-25b7861582c6`
- Production URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Production deploy: completed
- Push: not performed

## Source Branch and Main HEAD Before / After

Pre-merge inspection:

```text
git branch --show-current
v1.1-worker-quality-token-retrieval

git rev-parse --short HEAD
0d0af30

git status --short
<clean>
```

Stash list included the expected unrelated local stash:

```text
stash@{0}: On v1.1-worker-quality-token-retrieval: pre-final-rerun unrelated local files
stash@{1}: On main: wip drawer interaction cleanup before credit s4b
stash@{2}: On main: pre-deploy-integration
```

Branch verification confirmed the quality branch contained the expected latest commits:

- `Accept Q06 safe fallback for v1.1`
- `Record final v1.1 minimal core rerun`
- `Run minimal core model config comparison`
- `Support explicit OpenAI reasoning none`

`main` before merge:

```text
e03faab Hide StoreKit diagnostics in release settings UI
```

`main` after merge and production config commit:

```text
8fea094 Set production Worker reasoning effort low
4842a97 Merge branch 'v1.1-worker-quality-token-retrieval'
0d0af30 Accept Q06 safe fallback for v1.1
f882828 Record final v1.1 minimal core rerun
ba21da0 Prepare final v1.1 minimal core rerun
```

## Merge Result

Commands run:

```bash
git switch main
git pull --ff-only
git merge --no-ff v1.1-worker-quality-token-retrieval
```

Result:

- `main` was already up to date with `origin/main` before merge.
- Merge completed successfully using the `ort` strategy.
- No conflicts occurred.
- No stash was popped or applied.
- No unrelated iOS/legal-site local files were merged.

## Production Config Verification

Production config after the intentional update:

```text
workers/wrangler.toml:28:LLM_PROVIDER = "openai"
workers/wrangler.toml:29:OPENAI_CHAT_MODEL = "gpt-5-nano"
workers/wrangler.toml:33:OPENAI_REASONING_EFFORT = "low"
```

Test Worker config was not changed:

```text
workers/wrangler.test.toml:35:LLM_PROVIDER = "openai"
workers/wrangler.test.toml:36:OPENAI_CHAT_MODEL = "gpt-5-nano"
workers/wrangler.test.toml:40:OPENAI_REASONING_EFFORT = "minimal"
```

Intentional production config change:

- `OPENAI_REASONING_EFFORT` changed from `minimal` to `low` in `workers/wrangler.toml`.
- This matches the accepted model decision: `KEEP GPT-5-NANO LOW`.
- No switch to `gpt-5.4-nano` was made.
- No external context / web search was enabled.

## Local Validation Results

Commands run from `/Users/0xt4/t4dano/Kabuyomi/workers` before production deploy:

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

Results:

- `npm run typecheck`: passed.
- `npm test`: passed, 48 test files / 582 tests.
- `npm run dryrun:test`: passed.
- `npm run testbench:validate`: passed, 5 default tickers / 12 question templates.

## Production Deploy Result

Command run from `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run deploy
```

Result:

- Worker name: `kabuyomi-api`
- URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Current Version ID: `08c23d87-5bdc-4078-9831-25b7861582c6`
- Worker startup time: 10 ms
- Production deploy completed successfully.

Effective production bindings shown by Wrangler included:

```text
env.LLM_PROVIDER ("openai")
env.OPENAI_CHAT_MODEL ("gpt-5-nano")
env.OPENAI_REASONING_EFFORT ("low")
env.OPENAI_MAX_COMPLETION_TOKENS ("1800")
env.APPLE_APP_STORE_SERVER_ENVIRONMENT ("auto")
```

No test Worker deploy was performed as the final output.

## Post-Deploy Smoke Results

### A. Root Smoke

Command:

```bash
curl -i https://kabuyomi-api.dznqjmctk7.workers.dev/
```

Result:

- HTTP 404
- JSON body: `{"error":"Not found"}`
- This matches the expected existing root behavior.

### B. Search Smoke

Command:

```bash
curl -i -sS "https://kabuyomi-api.dznqjmctk7.workers.dev/v1/search?q=AAPL"
```

Result:

- HTTP 200
- Returned Apple / AAPL result:
  - `ticker`: `AAPL`
  - `companyName`: `Apple Inc.`
  - `latestFormType`: `10-Q`
  - `snapshotUpdatedAt`: `2026-05-07T18:00:36.242Z`

### C. Usage Smoke Without Device Key

Command:

```bash
curl -i "https://kabuyomi-api.dznqjmctk7.workers.dev/v1/usage"
```

Result:

- HTTP 400
- JSON body: `{"error":"Device key is required"}`
- This is the expected controlled failure.

### D. Usage Smoke With Device Key

Command:

```bash
curl -i -sS \
  -H "x-device-key: codex-v1-1-prod-smoke-main-merge" \
  "https://kabuyomi-api.dznqjmctk7.workers.dev/v1/usage"
```

Result:

- HTTP 200
- Returned usage/credits object.
- Initial smoke balance included `monthlyRemaining: 50`, `totalRemaining: 50`, `creditBillingEnabled: true`.

### E. AAPL Revenue Snapshot / AAPL-Q02-like Chat Smoke

Company filing lookup:

- Endpoint: `/v1/company/AAPL`
- HTTP 200
- Filing key: `v6:0000320193:000032019326000013`
- Filed at: `2026-05-01`
- Period of report: `2026-03-28`

Chat smoke command:

```bash
curl -i -sS -X POST "https://kabuyomi-api.dznqjmctk7.workers.dev/v1/chat" \
  -H "content-type: application/json" \
  -H "x-device-key: codex-v1-1-prod-smoke-main-merge" \
  --data '{"filingKey":"v6:0000320193:000032019326000013","question":"直近決算の売上はどうだった？","operationId":"prod-smoke-main-merge-aapl-q02-20260508"}'
```

Result:

- HTTP 200
- `responsePath`: `openai`
- `modelName`: `gpt-5-nano`
- `creditsCharged`: 2
- `creditsRemaining`: 48
- No provider/server error reproduced.
- The isolated AAPL-Q02 provider/server row from the final benchmark did not reproduce in this smoke.

### F. Optional IAP Usage Path Smoke

No existing non-mutating IAP smoke script was identified in this pass.

Not run:

- No real purchase.
- No manual credit grant.
- No mutating IAP verification path.

The safe usage/credits smoke above verified the non-purchase usage surface.

## Provider / Server Errors

Post-deploy smoke provider/server errors:

- None observed.

Wrangler tail was not needed.

## Stash Status

The existing stash was not popped or applied.

Relevant stash entry remains:

```text
stash@{0}: On v1.1-worker-quality-token-retrieval: pre-final-rerun unrelated local files
```

This stash contains unrelated local files from the final rerun prep context and should be handled intentionally outside this production Worker deploy task.

## Remaining Unrelated Local Work

No unrelated iOS/legal-site files were staged or merged from the stash.

Remaining local work is parked in stash, including known unrelated categories from prior prep:

- iOS settings/project local changes.
- legal-site local changes.
- old/intermediate untracked artifacts that were intentionally stashed before the final rerun.

## Release Decision

`PRODUCTION DEPLOYED - SMOKE PASSED`

Rationale:

- Merge to `main` succeeded without conflicts.
- Production config matches the accepted v1.1 model decision.
- Local validation passed.
- Production deploy succeeded.
- Production smoke checks passed.
- AAPL-Q02-like provider/server smoke did not reproduce the benchmark provider row.
- No stash contents were applied.
- No production deploy used temporary CLI model overrides.

## Next Steps

- Do not pop the stash as part of this deploy task.
- Review whether `main` should be pushed to the remote; no push was performed in this task.
- If pushing is desired, use the normal repository workflow after confirming the local commits:
  - `4842a97 Merge branch 'v1.1-worker-quality-token-retrieval'`
  - `8fea094 Set production Worker reasoning effort low`
  - this deploy report commit, if committed separately.
- Monitor production logs for OpenAI provider/server errors and hard-intent fallback drift.
- Keep v1.2 external context / web search as a separate product/design task.
