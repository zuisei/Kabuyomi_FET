# Kabuyomi Documentation Index

Last updated: 2026-05-06 JST

This index classifies docs and artifacts by release relevance. Current v1 truth is [release/RELEASE_TRUTH.md](./release/RELEASE_TRUTH.md). If older docs disagree with that file or current runtime code, treat older docs as historical.

## v1 Release Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1.0.2 | [release/RELEASE_TRUTH.md](./release/RELEASE_TRUTH.md) | Current v1.0.2 monetization truth for this branch: 10-K/10-Q, `kabuyomi.credits.50`, `kabuyomi.credits.100` compatibility, Lite/Pro/Max subscriptions, release-visible optional rewarded ads with server-side SSV, no 8-K, no web search, no investment advice. |
| active v1 | [release/CURRENT_SHIPPING_TRUTH.md](./release/CURRENT_SHIPPING_TRUTH.md) | Current shipping snapshot and implementation semantics. |
| active v1 | [release/APP_STORE_SUBMISSION_NOTES.md](./release/APP_STORE_SUBMISSION_NOTES.md) | App Review notes, privacy questionnaire guidance, legal URLs, manual checks. |
| active v1 | [release/TESTFLIGHT_READINESS_CHECKLIST.md](./release/TESTFLIGHT_READINESS_CHECKLIST.md) | TestFlight/manual verification checklist aligned to the current credit-only v1 truth. |

## Legal And StoreKit / IAP Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1 | [legal/LEGAL_SITE_DEPLOYMENT.md](./legal/LEGAL_SITE_DEPLOYMENT.md) | Cloudflare Pages legal-site setup and public metadata URLs. |
| active v1 | [legal/APPLE_STORE_SERVER_CONFIG.md](./legal/APPLE_STORE_SERVER_CONFIG.md) | Worker Apple Store Server API secrets/config for paid-credit verification. |
| active v1.0.2 | [legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md](./legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md) | Read-only TestFlight StoreKit diagnostics for v1.0.2 products: `kabuyomi.credits.50`, `kabuyomi.credits.100`, and Lite / Pro / Max subscriptions. |
| active v1 | [../legal-site/README.md](../legal-site/README.md) | Static legal site source location and validation command. |

## Worker Quality Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1 / internal only | [quality/WORKER_ARCHITECTURE_BRIEF.md](./quality/WORKER_ARCHITECTURE_BRIEF.md) | Current Worker architecture and testbench evidence brief. |
| active v1 / internal only | [quality/V1_WORKER_CRITICAL_REVIEW.md](./quality/V1_WORKER_CRITICAL_REVIEW.md) | Final v1 Worker answer-safety review packet. Current recommendation is HOLD. |
| v1.1 planning / internal only | [quality/chat_quality_contract.md](./quality/chat_quality_contract.md) | Chat answer-quality contract and eval gate. |
| v1.1 planning / internal only | [quality/chat_route_notes.md](./quality/chat_route_notes.md) | `/v1/chat` route and pipeline notes. |
| v1.1 planning / internal only | [quality/worker_refactor_tickets.md](./quality/worker_refactor_tickets.md) | Worker reliability and chat-quality refactor tickets. |
| internal only | [quality/worker_system_map.md](./quality/worker_system_map.md) | Worker system map. |
| internal only | [quality/worker_file_map.md](./quality/worker_file_map.md) | Worker file map. |

## AdMob Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1.0.2 | [admob/release-admob-checklist.md](./admob/release-admob-checklist.md) | Rewarded AdMob checklist for the release-visible v1.0.2 App Review path. Rewards are optional and require server-side SSV before credits are reflected. |
| active v1.0.2 | [admob/rewarded_admob_credits_runbook.md](./admob/rewarded_admob_credits_runbook.md) | Rewarded SSV runbook and evidence template. Real TestFlight/production SSV smoke evidence is still not recorded in the repo. |

## Historical Docs

| Status | Item | Purpose |
| --- | --- | --- |
| historical / legacy | [archive/old-specs/](./archive/old-specs/) | Older broad product specs. Some mention subscription, Free/Pro, 8-K exclusions, old UI direction, or older beta assumptions. |
| historical / legacy | [archive/historical-handoffs/](./archive/historical-handoffs/) | Old handoffs, project maps, split plans, and scratch notes. Keep for context only. |

## Testbench And Eval Artifact Locations

These stay in place because Worker package scripts and reports reference their current paths.

| Status | Location | Purpose |
| --- | --- | --- |
| active v1 / internal only | `workers/testbench/company-sets/` | Benchmark company sets. Do not move unless scripts are updated and tested. |
| active v1 / internal only | `workers/testbench/questions/` | Benchmark question sets. Do not move unless scripts are updated and tested. |
| active v1 / internal only | `workers/testbench/scripts/` | Benchmark runner, summarizer, quality classifier, and validator. Referenced by `workers/package.json`. |
| active v1 / internal only | `workers/testbench/runs/` | Saved JSONL and summary artifacts, including the 2026-05-05 v1 safety runs. |
| internal only | `workers/testbench/reports/` | Handwritten benchmark reports. Latest report set predates the 2026-05-05 safety artifacts. |
| historical / internal only | `workers/eval/` | Older fixed manual eval dataset and archived eval runs. Keep stable unless intentionally versioning a new eval set. |
| internal only | `workers/smoke/` | Staging smoke script location. |

## Current Grep Conflict Classification

The May 6 organization pass searched these terms across `README.md`, `docs`, `ios`, `workers`, and `legal-site`: subscription, Lite, Pro Max, Pro, monthly, monthly credit, 8-K, web search, Web検索, investment-advice terms, target/forecast terms, 500/280-credit product IDs, rewarded, AdMob, ads, and reward terms.

| Classification | Finding |
| --- | --- |
| active release-facing problem | None found in this pass after updating the active TestFlight checklist to the current credit-only v1 truth. |
| internal acceptable | Active release docs intentionally mention prohibited/omitted features such as subscriptions, 8-K, web search, investment advice, target prices, and rewarded ads to say they are not in v1. |
| internal acceptable | iOS/Worker tests and dormant infrastructure mention subscriptions, AdMob, rewarded credits, and old product IDs as compatibility or negative-test coverage. |
| historical archived | Old specs and handoffs under `docs/archive/` contain subscription-era and broader product language. They are explicitly historical. |
| false positive | Generic words such as `Pro`, `500`, `monthly`, `recommended`, and Japanese `推奨` also appear in code comments, version strings, numeric examples, and non-release contexts. |

## Cleanup Notes

- Do not move `workers/testbench/*`, `workers/eval/*`, D1 migrations, or active source files as part of docs organization.
- `workers/testbench/runs/` and `workers/eval/runs/` contain large generated artifacts. They may be intentionally excluded from release commits unless explicitly requested.
- `releaseDecision` remains governed by Worker answer-safety, App Review, and manual verification gates. This organization pass does not close those blockers.
