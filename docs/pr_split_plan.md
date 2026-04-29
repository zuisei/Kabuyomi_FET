# Kabuyomi PR Split Plan

Current branch:

```text
codex/worker-test-ui-and-refactor-tickets
```

Already pushed:

```text
ce7ceb2 Refactor worker chat diagnostics boundaries
```

This document splits the remaining dirty working tree into reviewable PRs. Do not mix these groups unless a later diff proves a file is a hard dependency.

## PR 1 - Worker chat maintainability

Status: pushed

Purpose:

```text
Keep routes/usecases/orchestrator easier to reason about by moving chat source validation and diagnostics into dedicated helpers.
```

Already included in commit:

```text
docs/worker_refactor_tickets.md
workers/src/lib/chat/decision-log.ts
workers/src/lib/chat/diagnostics.ts
workers/src/lib/chat/grounding.ts
workers/src/lib/chat/orchestrator.ts
workers/src/lib/chat/source-validation.ts
workers/src/lib/chat/usecase.ts
workers/src/lib/credit-operation.ts
workers/src/routes/chat.ts
workers/test/chat-diagnostics.test.ts
workers/test/chat-route.test.ts
workers/test/chat-source-validation.test.ts
```

Validation already run:

```text
cd workers
npm run typecheck
npm test
npm run dryrun:test
npm run deploy:test
npm run smoke:test
```

Deploy:

```text
test Worker only
Version ID: 06a5c47e-5061-4356-89a8-4528c4ca72b7
```

## PR 2 - Test API and dev tooling

Purpose:

```text
Make it safer to test Worker changes without touching production.
```

Files:

```text
.gitignore
ios/Kabuyomi/App/AppModel.swift
ios/Kabuyomi/Features/Settings/SettingsView.swift
ios/Kabuyomi/Services/APIClient.swift
ios/KabuyomiTests/APIClientTests.swift
workers/package.json
workers/scripts/assert-test-config-ready.mjs
workers/wrangler.test.toml
```

Optional docs in same PR:

```text
docs/README.md
```

Do not include:

```text
sec-fetcher/*
workers/src/clients/sec-fetcher.ts
workers/src/lib/filings/ingest.ts
chat answer quality files
filing/watchlist reliability files
```

Validation:

```text
cd workers
npm run check:test-config
npm run dryrun:test

xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.4.1' -only-testing:KabuyomiTests/APIClientTests
xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -configuration Release -destination 'generic/platform=iOS Simulator'
```

Merge condition:

```text
Release build must ignore the debug Test API switch.
No production Worker deploy required.
```

## PR 3 - SEC fetcher prepared filing path

Purpose:

```text
Move heavy filing text preparation toward sec-fetcher and reduce Worker-side payload/CPU pressure.
```

Files:

```text
sec-fetcher/server.mjs
sec-fetcher/src/sec-service.mjs
sec-fetcher/src/prepared-filing.mjs
sec-fetcher/test/sec-service.test.mjs
workers/src/clients/sec-fetcher.ts
workers/src/clients/sec.ts
workers/src/lib/filings/ingest.ts
workers/test/sec-fetcher-client.test.ts
```

Possible dependency:

```text
workers/src/env.ts
```

Only include `workers/src/env.ts` here if the prepared filing path actually needs the env typing change. If it is only for Test API vars or Gemini timeout vars, keep it out.

Validation:

```text
cd sec-fetcher
npm test

cd ../workers
npm run test -- --run test/sec-fetcher-client.test.ts test/ingest.test.ts test/latest-filing.test.ts
npm run typecheck
npm test
```

Deploy order:

```text
1. deploy sec-fetcher or verify the fetcher already supports /internal/sec/prepared-filing
2. deploy only test Worker
3. smoke test company/watchlist/chat
```

Merge condition:

```text
Worker must still fall back when prepared-filing returns 404.
No production deploy until test Worker smoke and a couple of new ticker ingests pass.
```

## PR 4 - Filing, watchlist, and company reliability

Purpose:

```text
Make long-running filing preparation and watchlist/company flows easier to recover and debug.
```

Files:

```text
workers/d1/migrations/0006_filing_prep_jobs.sql
workers/src/durable/filing-lock.ts
workers/src/env.ts
workers/src/index.ts
workers/src/lib/company/usecase.ts
workers/src/lib/filings/lock.ts
workers/src/lib/filings/prep-job-store.ts
workers/src/lib/watchlist/usecase.ts
workers/src/routes/company.ts
workers/src/routes/filing-prep-job.ts
workers/src/routes/watchlist-add.ts
workers/test/filing-lock.test.ts
workers/test/ticker-routes.test.ts
```

Possible support files:

```text
workers/src/lib/daily-refresh.ts
workers/src/routes/internal-backfill-history.ts
workers/src/routes/usage.ts
```

Only include support files if they are required by this PR's runtime path.

Validation:

```text
cd workers
npm run test -- --run test/filing-lock.test.ts test/ticker-routes.test.ts test/latest-filing.test.ts
npm run typecheck
npm test
npm run d1:migrate:test
npm run dryrun:test
npm run deploy:test
npm run smoke:test
```

Merge condition:

```text
No billing/quota semantic changes.
Async watchlist behavior and filing prep job response shape must be tested against test Worker.
```

## PR 5 - Chat answer quality and eval contract

Purpose:

```text
Improve weak/generic chat answers after the infrastructure is observable and safer.
```

Files:

```text
workers/eval/README.md
workers/scripts/validate-chat-run.mjs
workers/src/clients/gemini/fallback.ts
workers/src/clients/gemini/prompts.ts
workers/src/clients/gemini/request.ts
workers/src/lib/chat/context-pack.ts
workers/src/lib/chat/intent.ts
workers/src/lib/chat/web-supplement.ts
workers/test/chat-intent-context.test.ts
workers/test/gemini.test.ts
docs/chat_quality_contract.md
docs/chat_route_notes.md
```

Possible config:

```text
workers/src/env.ts
workers/wrangler.toml
```

Only include these if this PR owns `GEMINI_CHAT_TIMEOUT_MS` or related test/prod config.

Validation:

```text
cd workers
npm run test -- --run test/gemini.test.ts test/chat-intent-context.test.ts test/chat-route.test.ts test/pipeline.test.ts
npm run typecheck
npm test
npm run eval:chat:validate-run
npm run dryrun:test
npm run deploy:test
npm run smoke:test
```

Merge condition:

```text
No model selection change unless explicitly called out.
Prompt changes must have before/after eval evidence.
Production deploy only after test Worker chat checks pass on representative tickers.
```

## PR 6 - Worker maps and planning docs

Purpose:

```text
Keep project maps and current review notes available without mixing them into runtime PRs.
```

Files:

```text
docs/fuckme.md
docs/project_file_map.md
docs/worker_file_map.md
docs/worker_system_map.md
docs/README.md
```

Do not commit by default:

```text
tmp/*.svg
```

Validation:

```text
No runtime tests required unless docs references generated commands.
```

Merge condition:

```text
Docs should not claim deploy/test status unless verified in that PR.
```

## Suggested Merge Order

```text
1. PR 1 - Worker chat maintainability
2. PR 2 - Test API and dev tooling
3. PR 3 - SEC fetcher prepared filing path
4. PR 4 - Filing, watchlist, and company reliability
5. PR 5 - Chat answer quality and eval contract
6. PR 6 - Worker maps and planning docs
```

Reason:

```text
First land low-risk structure and test tooling.
Then land fetcher/runtime reliability separately.
Only then tune answer quality, because quality changes are easier to judge when observability and runtime paths are stable.
```

## Current Uncommitted Files To Re-check

These files are cross-cutting and must be assigned carefully before staging:

```text
workers/src/env.ts
workers/package.json
workers/wrangler.toml
docs/README.md
.gitignore
```

Rule:

```text
If a cross-cutting file contains changes for multiple PRs, split it with git add -p or make a temporary cleanup commit only after reviewing each hunk.
```
