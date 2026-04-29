# Kabuyomi Project File Map

This is the plain-English map of the current project.

It is meant for orientation, not as a perfect architecture spec. Generated folders, dependency folders, build output, `.DS_Store`, `.git`, `.wrangler`, `node_modules`, `dist`, `.deploy-out`, `.wrangler-dry-run`, `ios/build`, and `tmp` are intentionally excluded.

## What We Are Doing Now

Kabuyomi is past the basic "can this app exist?" phase.

The mobile app, API routes, ticker search, watchlist, filings, chat, credits, deployment, and local test tools already exist.

Current focus:

```text
Answer quality
Latency
Reliability
Observability
```

Most recent backend work:

```text
sec-fetcher prepared-filing endpoint
test Worker environment
chat route/usecase cleanup
filing prep job state
chat quality observability logs
```

The active chat-quality question is:

```text
When a user asks a vague or follow-up question, can we see:
  what question the backend actually answered,
  what sources it selected,
  why it used Gemini/fallback/deterministic,
  and why the answer was weak?
```

## Big Picture

```text
iOS app
  -> Cloudflare Worker API
    -> D1 / KV / R2 / Durable Objects
    -> sec-fetcher on Railway
      -> SEC EDGAR
    -> Gemini
```

Important rule:

```text
iOS never talks to sec-fetcher directly.
iOS talks to Workers.
Workers talk to sec-fetcher.
```

## Main Runtime Flow

```text
User opens app
  -> iOS AppModel
  -> APIClient
  -> Worker route
  -> usecase / lib
  -> sec-fetcher / D1 / R2 / Durable Object / Gemini
  -> JSON response
  -> SwiftUI screen
```

For chat:

```text
routes/chat.ts
  -> lib/chat/usecase.ts
  -> lib/chat/context.ts
  -> lib/chat/orchestrator.ts
  -> intent / context-pack / deterministic / Gemini / grounding / fallback
  -> chat_quality_pipeline log
  -> response to iOS
```

For filings:

```text
routes/company.ts or routes/watchlist-add.ts
  -> lib/company/usecase.ts or lib/watchlist/usecase.ts
  -> lib/filings/latest.ts
  -> clients/sec.ts
  -> clients/sec-fetcher.ts
  -> sec-fetcher/server.mjs
  -> SEC
```

## Root Files

| File | What it is |
| --- | --- |
| `README.md` | Human-facing project overview. |
| `CURRENT_SLICE.md` | Notes for the current working slice. May be stale unless recently updated. |
| `.gitignore` | Local files and generated artifacts ignored by git. |
| `ci_scripts/ci_post_clone.sh` | CI/App Store Connect style post-clone setup script. |

## Local Debug Tools

These are local-only helpers. They are not the production iOS app.

| File | What it is |
| --- | --- |
| `.kabuyomi-local/log-ui/README.md` | Notes for the local API/log viewer. |
| `.kabuyomi-local/log-ui/package.json` | Node package metadata for the local log UI. |
| `.kabuyomi-local/log-ui/server.mjs` | Local server for viewing downloaded/log data. |
| `.kabuyomi-local/log-ui/public/index.html` | Log UI page shell. |
| `.kabuyomi-local/log-ui/public/app.js` | Log UI frontend logic. |
| `.kabuyomi-local/log-ui/public/styles.css` | Log UI styling. |
| `.kabuyomi-local/test-api-console/README.md` | Notes for the local test API console. |
| `.kabuyomi-local/test-api-console/package.json` | Node package metadata for the test console. |
| `.kabuyomi-local/test-api-console/server.mjs` | Local server/proxy for calling the Worker APIs from a browser. |
| `.kabuyomi-local/test-api-console/public/index.html` | Test console page shell. |
| `.kabuyomi-local/test-api-console/public/app.js` | Test console behavior: API calls, question sets, compare logs. |
| `.kabuyomi-local/test-api-console/public/styles.css` | Test console styling. |

## Documentation

| File | What it is |
| --- | --- |
| `docs/README.md` | Index of project documentation. |
| `docs/current_shipping_truth.md` | Current shipping truth and release assumptions. |
| `docs/project_file_map.md` | This file. High-level project and file map. |
| `docs/worker_system_map.md` | Worker-focused system map. |
| `docs/worker_file_map.md` | Worker file map from the earlier backend review. |
| `docs/worker_refactor_tickets.md` | Refactor tickets and progress tracking. |
| `docs/fuckme.md` | Raw backend risk/refactor notes. Working scratch doc. |
| `docs/chat_route_notes.md` | Notes on the `/v1/chat` route and chat pipeline. |
| `docs/chat_quality_contract.md` | Expected chat quality behavior and eval contract. |
| `docs/testflight_readiness_checklist.md` | Release/TestFlight readiness checklist. |
| `docs/app_store_submission_notes.md` | App Store submission notes. |
| `docs/handoffs/codex_refactor_instruction.md` | Handoff instructions for refactor work. |
| `docs/handoffs/kabuyomi_claude_code_ui_spec_v1.md` | UI handoff/spec notes. |
| `docs/specs/kabuyomi_as_built_spec.md` | As-built spec from reading source files. |
| `docs/specs/kabuyomi_conversational_ui_spec_v1.md` | Conversation UI product spec. |
| `docs/specs/kabuyomi_engagement_spec_v1.md` | Engagement/product spec. |
| `docs/specs/kabuyomi_positioning_spec_v1.md` | Positioning/product framing spec. |
| `docs/specs/kabuyomi_spec_v3.md` | Older/broader product spec. |

## iOS App

### iOS Project Config

| File | What it is |
| --- | --- |
| `ios/project.yml` | XcodeGen source of truth for the Xcode project. |
| `ios/Kabuyomi/Info.plist` | iOS app plist metadata. |
| `ios/Kabuyomi/PrivacyInfo.xcprivacy` | Apple privacy manifest. |
| `ios/Kabuyomi/KabuyomiApp.swift` | SwiftUI app entry point. |

### iOS App Core

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/App/AppModel.swift` | Main app state and business flow coordinator. |
| `ios/Kabuyomi/App/AppRootView.swift` | Root SwiftUI view and top-level screen composition. |
| `ios/Kabuyomi/App/AppAlertState.swift` | Shared alert/error state. |
| `ios/Kabuyomi/App/Theme.swift` | App colors, typography, and shared visual constants. |

### iOS Models

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/Models/APIModels.swift` | Swift structs matching Worker API payloads. |
| `ios/Kabuyomi/Models/AIModel.swift` | Local model enum/configuration for AI-related UI state. |

### iOS Services

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/Services/APIClient.swift` | Main HTTP client for Workers API. |
| `ios/Kabuyomi/Services/SubscriptionStore.swift` | StoreKit subscription/purchase handling. |
| `ios/Kabuyomi/Services/BetaBilling.swift` | Beta billing/credit configuration helpers. |
| `ios/Kabuyomi/Services/DeviceIdentityStore.swift` | Stable device identity storage for quota/API identity. |
| `ios/Kabuyomi/Services/AdMobConfig.swift` | AdMob configuration. |

### iOS Persistence

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/Persistence/CoreDataSchema.swift` | Core Data schema definitions. |
| `ios/Kabuyomi/Persistence/PersistenceController.swift` | Core Data stack and persistence helpers. |

### iOS Screens

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/Features/Entry/ConversationEntryView.swift` | Entry/onboarding style conversation start view. |
| `ios/Kabuyomi/Features/Search/SearchView.swift` | Ticker/company search UI. |
| `ios/Kabuyomi/Features/Settings/SettingsView.swift` | Settings, legal links, account/plan related UI. |
| `ios/Kabuyomi/Features/Ads/AdMobBannerView.swift` | SwiftUI wrapper for AdMob banner display. |

### iOS Company/Chat UI

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/Features/Company/CompanyView.swift` | Main company/chat screen. |
| `ios/Kabuyomi/Features/Company/CompanyTopBar.swift` | Header/top bar for the company screen. |
| `ios/Kabuyomi/Features/Company/CompanyComposer.swift` | User input composer for chat questions. |
| `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift` | Chat message row rendering. |
| `ios/Kabuyomi/Features/Company/CompanySourceSupport.swift` | Source/evidence chip support types and helpers. |
| `ios/Kabuyomi/Features/Company/CompanyInsightsSupport.swift` | Company insight helper UI/data shaping. |
| `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift` | Saved company/library drawer. |
| `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift` | Filing/company summary drawer. |
| `ios/Kabuyomi/Features/Company/CompanyTimeline.swift` | Timeline/history UI for filings or chat context. |
| `ios/Kabuyomi/Features/Company/CompanyUIShared.swift` | Shared UI components/constants for company screens. |

### iOS Assets

| File | What it is |
| --- | --- |
| `ios/Kabuyomi/Resources/Assets.xcassets/Contents.json` | Asset catalog root metadata. |
| `ios/Kabuyomi/Resources/Assets.xcassets/AccentColor.colorset/Contents.json` | Accent color asset metadata. |
| `ios/Kabuyomi/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json` | App icon set metadata. |
| `ios/Kabuyomi/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024px app icon image. |

### iOS Tests

| File | What it is |
| --- | --- |
| `ios/KabuyomiTests/APIClientTests.swift` | Tests API request/response handling. |
| `ios/KabuyomiTests/AppModelTests.swift` | Tests main app state behavior. |
| `ios/KabuyomiTests/AIModelTests.swift` | Tests AI model related state/config. |
| `ios/KabuyomiTests/ConversationPromptTests.swift` | Tests prompt/conversation behavior on iOS side. |
| `ios/KabuyomiTests/PersistenceControllerTests.swift` | Tests Core Data persistence layer. |
| `ios/KabuyomiTests/TestFixtures.swift` | Shared Swift test fixtures. |

## Worker API

### Worker Config

| File | What it is |
| --- | --- |
| `workers/package.json` | Worker npm scripts and dependencies. |
| `workers/package-lock.json` | Locked npm dependency versions. |
| `workers/tsconfig.json` | TypeScript config. |
| `workers/vitest.config.ts` | Vitest config. |
| `workers/wrangler.toml` | Production Worker config. |
| `workers/wrangler.test.toml` | Test Worker config. Deploys `kabuyomi-api-test`. |
| `workers/.dev.vars.example` | Example local Worker secrets. |
| `workers/.dev.vars` | Local Worker secrets. Do not rely on this in docs or commits. |

### Worker Entrypoints

| File | What it is |
| --- | --- |
| `workers/src/index.ts` | Cloudflare Worker entry point and route dispatcher. |
| `workers/src/env.ts` | Worker binding and domain data types. |

### Worker Routes

Routes are the HTTP front doors. They should stay thin.

| File | What it is |
| --- | --- |
| `workers/src/routes/types.ts` | Shared route handler type. |
| `workers/src/routes/search.ts` | `/v1/search` ticker search route. |
| `workers/src/routes/company.ts` | `/v1/company/:ticker` company/filing route. |
| `workers/src/routes/chat.ts` | `/v1/chat` chat route. Validates payload and calls chat usecase. |
| `workers/src/routes/watchlist-add.ts` | `/v1/watchlist/add` route. |
| `workers/src/routes/watchlist-remove.ts` | `/v1/watchlist/remove` route. |
| `workers/src/routes/filing-prep-job.ts` | `/v1/filing-prep/jobs/:jobId` route for async filing prep state. |
| `workers/src/routes/usage.ts` | `/v1/usage` quota/credit usage route. |
| `workers/src/routes/billing-sync.ts` | `/v1/billing/sync` StoreKit entitlement sync route. |
| `workers/src/routes/credit-purchase-grant.ts` | Public StoreKit credit purchase grant route. |
| `workers/src/routes/translate-quote.ts` | Quote translation route. |
| `workers/src/routes/legal.ts` | Legal/support static route responses. |
| `workers/src/routes/internal-backfill-history.ts` | Internal history backfill route. |
| `workers/src/routes/internal-cleanup-filings.ts` | Internal filing cleanup route. |
| `workers/src/routes/internal-credit-purchase-grant.ts` | Internal/manual credit purchase grant route. |
| `workers/src/routes/internal-eval-credit-grant.ts` | Internal eval credit grant route. |

### Worker External Clients

| File | What it is |
| --- | --- |
| `workers/src/clients/sec.ts` | SEC facade used by Worker code. |
| `workers/src/clients/sec-fetcher.ts` | HTTP client for Railway `sec-fetcher`. |
| `workers/src/clients/web-search.ts` | Web/news search supplement client. |
| `workers/src/clients/gemini.ts` | Main Gemini client wrapper. |
| `workers/src/clients/gemini/request.ts` | Low-level Gemini request logic and model resolution. |
| `workers/src/clients/gemini/prompts.ts` | Prompt construction. Important for answer quality. |
| `workers/src/clients/gemini/fallback.ts` | Local fallback answer generation when Gemini fails or is weak. |
| `workers/src/clients/gemini/normalize.ts` | Gemini response normalization. |
| `workers/src/clients/gemini/types.ts` | Gemini response/fallback/usage types. |

### Worker Durable Objects

| File | What it is |
| --- | --- |
| `workers/src/durable/sec-rate-limiter.ts` | SEC fetch rate limiter Durable Object. |
| `workers/src/durable/filing-lock.ts` | Filing ingest lock Durable Object. Prevents duplicate filing work. |
| `workers/src/durable/user-quota.ts` | User quota, saved tickers, credits, purchases, eval grants. |
| `workers/src/durable/entitlement.ts` | Subscription entitlement state. |

### Worker Shared Utilities

| File | What it is |
| --- | --- |
| `workers/src/lib/request.ts` | JSON/body request parsing helpers. |
| `workers/src/lib/response.ts` | JSON/error response helpers. |
| `workers/src/lib/errors.ts` | App error type. |
| `workers/src/lib/logging.ts` | Structured JSON logging helpers. |
| `workers/src/lib/internal-auth.ts` | Shared secret verification for internal routes. |
| `workers/src/lib/remote-config.ts` | Runtime feature flags and config defaults. |
| `workers/src/lib/contracts.ts` | Shared API contract schemas. |
| `workers/src/lib/pipeline.ts` | Legacy/barrel exports. Avoid adding new imports here. |
| `workers/src/lib/metrics.ts` | Metric label/value helpers. |
| `workers/src/lib/llm-usage.ts` | LLM usage logging. |
| `workers/src/lib/starter-tickers.ts` | Starter/default ticker list. |
| `workers/src/lib/tracked-tickers.ts` | Ticker tracking helpers. |
| `workers/src/lib/detached-access.ts` | Debug/detached access handling. |
| `workers/src/lib/apple-store-server.ts` | Apple Store Server verification helpers. |
| `workers/src/lib/billing-catalog.ts` | Credit/subscription product catalog. |
| `workers/src/lib/entitlements.ts` | Entitlement helper layer. |
| `workers/src/lib/quota.ts` | Quota and credit operations wrapper around UserQuotaDO. Large and important. |
| `workers/src/lib/credit-operation.ts` | Shared billable credit consume/refund helper. |
| `workers/src/lib/search-form-type-cache.ts` | D1 cache for ticker latest form type metadata. |
| `workers/src/lib/history-store.ts` | D1/R2 history and filing archive storage helpers. |
| `workers/src/lib/history-autohydration.ts` | History hydration helper. |
| `workers/src/lib/daily-refresh.ts` | Scheduled daily refresh flow. |

### Worker Company/Watchlist Usecases

| File | What it is |
| --- | --- |
| `workers/src/lib/company/usecase.ts` | Company load/refresh business logic behind `routes/company.ts`. |
| `workers/src/lib/company-response.ts` | Serializes filing records into company API responses. |
| `workers/src/lib/watchlist/usecase.ts` | Watchlist add logic, async filing prep job state, quota handling. |

### Worker Filing Pipeline

| File | What it is |
| --- | --- |
| `workers/src/extractors/mda.ts` | Worker-side MD&A extraction. Still used in some upgrade paths. |
| `workers/src/lib/filings/latest.ts` | Chooses/latest filing and controls ingest/cache behavior. Very important. |
| `workers/src/lib/filings/ingest.ts` | Ingests a filing into cache/archive. Uses prepared-filing when available. |
| `workers/src/lib/filings/cache.ts` | Filing cache read/write helpers. |
| `workers/src/lib/filings/content-upgrade.ts` | Background upgrade from metrics-only to full content. |
| `workers/src/lib/filings/history-persistence.ts` | Historical filing persistence/preload. |
| `workers/src/lib/filings/latest-alias-store.ts` | Latest filing alias metadata. |
| `workers/src/lib/filings/lock.ts` | Filing lock client helper. |
| `workers/src/lib/filings/prep-job-store.ts` | D1 filing prep job store. |
| `workers/src/lib/filings/company-website.ts` | Extracts company website from filing HTML. |
| `workers/src/lib/filings/summary-upgrade.ts` | Summary upgrade helpers. |
| `workers/src/lib/filings/cleanup.ts` | Filing cleanup helpers. |

### Worker Chat Pipeline

This is the current answer-quality focus.

| File | What it is |
| --- | --- |
| `workers/src/lib/chat/usecase.ts` | `/v1/chat` application usecase: quota, rewrite, response shaping, `chat_quality_pipeline` log. |
| `workers/src/lib/chat/orchestrator.ts` | Main answer coordinator. Chooses historical, deterministic, Gemini, fallback, grounding repair. |
| `workers/src/lib/chat/intent.ts` | Classifies question intent. |
| `workers/src/lib/chat/context.ts` | Rewrites short follow-up questions using recent conversation context. |
| `workers/src/lib/chat/context-pack.ts` | Selects metrics and filing source chunks for Gemini. Very important for quality. |
| `workers/src/lib/chat/decision-log.ts` | Chat path/context/LLM decision logs. |
| `workers/src/lib/chat/deterministic.ts` | Programmatic answers for known financial question patterns. |
| `workers/src/lib/chat/grounding.ts` | Response/source grounding types and source URL attachment. |
| `workers/src/lib/chat/historical.ts` | Historical comparison chat flow. |
| `workers/src/lib/chat/web-supplement.ts` | Adds web/news context when filing-only answer needs market context. |
| `workers/src/lib/chat/answer-format.ts` | Final answer display formatting before API response. |

## Worker Database, Eval, Scripts, Smoke

### D1 Migrations

| File | What it is |
| --- | --- |
| `workers/d1/migrations/0001_history.sql` | Filing/history base schema. |
| `workers/d1/migrations/0002_filing_metadata.sql` | Filing metadata schema. |
| `workers/d1/migrations/0003_credit_accounting.sql` | Credit accounting schema. |
| `workers/d1/migrations/0004_monthly_grant_plan_index.sql` | Monthly grant index migration. |
| `workers/d1/migrations/0005_purchase_transactions_user_index.sql` | Purchase transaction user index migration. |
| `workers/d1/migrations/0006_filing_prep_jobs.sql` | Filing prep job state table. |

### Worker Scripts

| File | What it is |
| --- | --- |
| `workers/scripts/assert-test-config-ready.mjs` | Safety check before test Worker deploy/migration. |
| `workers/scripts/backfill-history.mjs` | CLI helper to backfill filing history. |
| `workers/scripts/cleanup-filings.mjs` | CLI helper to clean filing archive/cache. |
| `workers/scripts/run-chat-eval-pilot.mjs` | Runs chat eval pilot. |
| `workers/scripts/validate-chat-eval.mjs` | Validates chat eval set file shape. |
| `workers/scripts/validate-chat-run.mjs` | Validates eval run output shape. |

### Worker Smoke and Eval

| File | What it is |
| --- | --- |
| `workers/smoke/staging-worker.js` | End-to-end smoke test for Worker routes. |
| `workers/eval/README.md` | Chat eval workflow notes. |
| `workers/eval/chat-quality-v1.jsonl` | Main chat quality eval question set. |
| `workers/eval/runs/2026-04-26T11-27-53-881Z.jsonl` | Saved eval run output. |
| `workers/eval/runs/2026-04-26T11-48-43-080Z.jsonl` | Saved eval run output. |
| `workers/eval/runs/2026-04-26T12-09-25-773Z.jsonl` | Saved eval run output. |
| `workers/eval/runs/2026-04-26T12-11-10-205Z.jsonl` | Saved eval run output. |
| `workers/eval/runs/2026-04-26T12-29-56-529Z.jsonl` | Saved eval run output. |

### Worker Tests

| File | What it is |
| --- | --- |
| `workers/test/index.test.ts` | Worker router and HTTP behavior tests. |
| `workers/test/ticker-routes.test.ts` | Company/search/watchlist route behavior tests. |
| `workers/test/chat-route.test.ts` | `/v1/chat` route/usecase tests. |
| `workers/test/pipeline.test.ts` | Main chat pipeline behavior tests. |
| `workers/test/gemini.test.ts` | Gemini client, fallback, schema, weak-answer behavior tests. |
| `workers/test/sec-fetcher-client.test.ts` | Worker sec-fetcher HTTP client tests. |
| `workers/test/sec.test.ts` | SEC facade tests. |
| `workers/test/sec-metrics.test.ts` | SEC metric mapping tests. |
| `workers/test/mda.test.ts` | MD&A extraction tests. |
| `workers/test/ingest.test.ts` | Filing ingest tests. |
| `workers/test/latest-filing.test.ts` | Latest filing selection/cache tests. |
| `workers/test/content-upgrade.test.ts` | Metrics-only to full content upgrade tests. |
| `workers/test/history-store.test.ts` | History store tests. |
| `workers/test/history-persistence.test.ts` | Historical persistence tests. |
| `workers/test/historical-chat.test.ts` | Historical chat response tests. |
| `workers/test/chat-context.test.ts` | Follow-up/context rewrite tests. |
| `workers/test/chat-intent-context.test.ts` | Intent and context classification tests. |
| `workers/test/chat-factual-pack.test.ts` | Context factual-pack tests. |
| `workers/test/chat-answer-format.test.ts` | Final answer formatting tests. |
| `workers/test/company-response.test.ts` | Company API response serialization tests. |
| `workers/test/company-website.test.ts` | Company website extraction tests. |
| `workers/test/tracked-tickers.test.ts` | Tracked ticker helper tests. |
| `workers/test/user-quota.test.ts` | User quota Durable Object tests. |
| `workers/test/credit-quota.test.ts` | Credit accounting tests. |
| `workers/test/quote-translation-route.test.ts` | Quote translation route tests. |
| `workers/test/billing-catalog.test.ts` | Billing catalog tests. |
| `workers/test/apple-store-server.test.ts` | Apple transaction verification tests. |
| `workers/test/entitlement.test.ts` | Entitlement Durable Object tests. |
| `workers/test/remote-config.test.ts` | Remote config tests. |
| `workers/test/d1-metadata-cache.test.ts` | D1 metadata cache tests. |
| `workers/test/filing-cleanup.test.ts` | Filing cleanup tests. |
| `workers/test/filing-lock.test.ts` | Filing lock tests. |
| `workers/test/fixtures/sec-metric-regressions.ts` | Shared SEC metric regression fixtures. |

## sec-fetcher Service

This is the Railway Node service that talks to SEC EDGAR.

| File | What it is |
| --- | --- |
| `sec-fetcher/package.json` | sec-fetcher npm scripts. |
| `sec-fetcher/server.mjs` | HTTP server. Exposes internal SEC endpoints to Workers. |
| `sec-fetcher/src/sec-service.mjs` | Core SEC fetching, retry, caching, metrics, filing assets, prepared filing. |
| `sec-fetcher/src/request-body.mjs` | Safe JSON body reader with size/content-type checks. |
| `sec-fetcher/src/prepared-filing.mjs` | Extracts MD&A text inside sec-fetcher so Worker does less heavy HTML work. |
| `sec-fetcher/test/sec-service.test.mjs` | sec-fetcher service tests. |
| `sec-fetcher/test/request-body.test.mjs` | request-body tests. |

## What To Touch For Common Goals

### Improve Weak Chat Answers

Start here:

```text
workers/src/lib/chat/usecase.ts
workers/src/lib/chat/orchestrator.ts
workers/src/lib/chat/intent.ts
workers/src/lib/chat/context.ts
workers/src/lib/chat/context-pack.ts
workers/src/clients/gemini/prompts.ts
workers/src/clients/gemini/fallback.ts
workers/src/lib/chat/grounding.ts
```

Do not start with the iOS UI for backend answer quality issues.

### Diagnose Why A Chat Answer Was Bad

Look for these log events:

```text
chat_quality_pipeline
chat_context_selection
chat_path_decision
chat_model_retry
gemini_fallback_used
chat_grounding_repair_used
llm_usage
```

### Improve Latency / 503 Risk

Start here:

```text
workers/src/clients/sec-fetcher.ts
workers/src/clients/sec.ts
workers/src/lib/filings/latest.ts
workers/src/lib/filings/ingest.ts
workers/src/lib/filings/content-upgrade.ts
workers/src/lib/watchlist/usecase.ts
sec-fetcher/src/sec-service.mjs
sec-fetcher/src/prepared-filing.mjs
```

### Improve iOS Experience

Start here:

```text
ios/Kabuyomi/App/AppModel.swift
ios/Kabuyomi/Services/APIClient.swift
ios/Kabuyomi/Features/Company/CompanyView.swift
ios/Kabuyomi/Features/Company/CompanyMessageRow.swift
ios/Kabuyomi/Features/Company/CompanyComposer.swift
ios/Kabuyomi/Features/Search/SearchView.swift
```

### Change Credits / Quota / Billing

Start here:

```text
workers/src/lib/quota.ts
workers/src/durable/user-quota.ts
workers/src/lib/credit-operation.ts
workers/src/routes/usage.ts
workers/src/routes/billing-sync.ts
workers/src/routes/credit-purchase-grant.ts
ios/Kabuyomi/Services/SubscriptionStore.swift
ios/Kabuyomi/Services/BetaBilling.swift
```

## Current Risk Areas

| Area | Why it matters |
| --- | --- |
| Chat context selection | Good Gemini answers depend on the right MD&A chunks and metrics. |
| Follow-up rewriting | Questions like "why?" must be rewritten using prior conversation. |
| Fallback behavior | Weak fallback can make the app look dumb even when data exists. |
| Filing prep jobs | Still not a full durable Queue/Workflow. |
| sec-fetcher / Worker boundary | Prepared filing helps, but content upgrade still has heavy paths. |
| Quota/credit | Money-related mutation/refund paths must stay tested. |
| Dirty worktree | There are many local changes. Keep deploy slices small. |

## Safe Development Rule

Use this order:

```text
1. Make a small slice.
2. Run targeted tests.
3. Run full Worker tests if shared behavior changed.
4. Deploy to test Worker.
5. Smoke test.
6. Only then consider production.
```

Production deploy is separate from test deploy.

```text
test Worker:
  workers/wrangler.test.toml
  kabuyomi-api-test

production Worker:
  workers/wrangler.toml
  kabuyomi-api
```
