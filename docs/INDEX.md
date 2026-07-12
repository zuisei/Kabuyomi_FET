# Kabuyomi Documentation Index

Last updated: 2026-07-11 JST

This index classifies docs and artifacts by release relevance. Current truth is [release/CURRENT_SHIPPING_TRUTH.md](./release/CURRENT_SHIPPING_TRUTH.md). If older docs disagree with that file or current runtime code, treat older docs as historical.

## v1 Release Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active transfer prep | [release/ACQUISITION_READINESS_PACKET_2026-06-06.md](./release/ACQUISITION_READINESS_PACKET_2026-06-06.md) | Buyer diligence and near-transfer technical state: assets, validation evidence, transfer checklist, and remaining external account gates. |
| active transfer prep | [release/SALE_LISTING_DRAFT_2026-06-06.md](./release/SALE_LISTING_DRAFT_2026-06-06.md) | Private buyer outreach/listing draft, buyer profile, included assets, proof points, and disclosure copy. |
| active transfer prep | [release/SELLING_CHANNELS_RESEARCH_2026-06-07.md](./release/SELLING_CHANNELS_RESEARCH_2026-06-07.md) | Researched sell-side channels and ranked marketplaces for Kabuyomi: startup marketplaces, app brokers, Japan M&A platforms, and source-code fallbacks. |
| historical v1.0.2 | [release/RELEASE_TRUTH.md](./release/RELEASE_TRUTH.md) | Historical pre-remediation snapshot; not authoritative for release claims. |
| active | [release/CURRENT_SHIPPING_TRUTH.md](./release/CURRENT_SHIPPING_TRUTH.md) | Authoritative shipping snapshot: hardened identity, one-time welcome credit, server-authoritative subscriptions, externally gated account recovery, and explicit fail-closed monetization capabilities. |
| active capability evidence | [release/FEATURE_PARITY_COMPATIBILITY_REPORT.md](./release/FEATURE_PARITY_COMPATIBILITY_REPORT.md) | Regression contract retaining monetization implementations while requiring complete typed production capabilities and explicit emergency/trust gates. |
| active final evidence | [release/FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md](./release/FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md) | Complete repository discovery, 46-domain evidence matrix, remediation, deployments, validation, external gates, and final decision. |
| active machine gate | [release/RELEASE_GATE_STATE.json](./release/RELEASE_GATE_STATE.json) | Machine-readable release state kept consistent with the authoritative final report. |
| historical gate evidence | [release/FULL_REMEDIATION_RELEASE_GATE_REPORT.md](./release/FULL_REMEDIATION_RELEASE_GATE_REPORT.md) | Point-in-time PR00-PR14 snapshot superseded by the final discovery/remediation report. |
| active operations | [release/REMOTE_CONFIG_LIFECYCLE_RUNBOOK.md](./release/REMOTE_CONFIG_LIFECYCLE_RUNBOOK.md) | Human-reviewed 14-day refresh cadence, age alerts, 45-day hard stop, and explicit KV publication/rollback workflow. |
| historical test deployment evidence | [release/TEST_WORKER_DEPLOY_AND_SMOKE_REPORT_2026-07-11.md](./release/TEST_WORKER_DEPLOY_AND_SMOKE_REPORT_2026-07-11.md) | Superseded point-in-time test deployment evidence retained for audit history. |
| active v1 | [release/APP_STORE_SUBMISSION_NOTES.md](./release/APP_STORE_SUBMISSION_NOTES.md) | App Review notes, privacy questionnaire guidance, legal URLs, manual checks. |
| historical v1 checklist | [release/TESTFLIGHT_READINESS_CHECKLIST.md](./release/TESTFLIGHT_READINESS_CHECKLIST.md) | Superseded TestFlight/manual checklist retained for point-in-time context. |

## Legal And StoreKit / IAP Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1 | [legal/LEGAL_SITE_DEPLOYMENT.md](./legal/LEGAL_SITE_DEPLOYMENT.md) | Cloudflare Pages legal-site setup and public metadata URLs. |
| active v1 | [legal/APPLE_STORE_SERVER_CONFIG.md](./legal/APPLE_STORE_SERVER_CONFIG.md) | Worker Apple Store Server API secrets/config for paid-credit verification. |
| active v1 | [legal/APPLE_ACCOUNT_RECOVERY_CONFIG.md](./legal/APPLE_ACCOUNT_RECOVERY_CONFIG.md) | Sign in with Apple, account HMAC, D1 migration, two-device, and safe activation runbook. |
| active v1.0.2 | [legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md](./legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md) | Read-only TestFlight StoreKit diagnostics for v1.0.2 products: `kabuyomi.credits.50`, `kabuyomi.credits.100`, and Lite / Pro / Max subscriptions. |
| active v1 | [../legal-site/README.md](../legal-site/README.md) | Static legal site source location and validation command. |

## Worker Quality Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1 / internal only | [quality/WORKER_ARCHITECTURE_BRIEF.md](./quality/WORKER_ARCHITECTURE_BRIEF.md) | Current Worker architecture and testbench evidence brief. |
| active v1 / internal only | [quality/V1_WORKER_CRITICAL_REVIEW.md](./quality/V1_WORKER_CRITICAL_REVIEW.md) | Final v1 Worker answer-safety review packet. Current recommendation is HOLD. |
| active v1 / internal only | [quality/PROMPT_V2_EXPANDED_BASELINE_2026_07_02.md](./quality/PROMPT_V2_EXPANDED_BASELINE_2026_07_02.md) | Prompt-v2 expanded 180-row baseline, local hardening passes, quality gate evidence, and next Q03/Q04/Q06 smoke command. |
| v1.1 planning / internal only | [quality/chat_quality_contract.md](./quality/chat_quality_contract.md) | Chat answer-quality contract and eval gate. |
| v1.1 planning / internal only | [quality/chat_route_notes.md](./quality/chat_route_notes.md) | `/v1/chat` route and pipeline notes. |
| v1.1 planning / internal only | [quality/worker_refactor_tickets.md](./quality/worker_refactor_tickets.md) | Worker reliability and chat-quality refactor tickets. |
| internal only | [quality/worker_system_map.md](./quality/worker_system_map.md) | Worker system map. |
| internal only | [quality/worker_file_map.md](./quality/worker_file_map.md) | Worker file map. |

## AdMob Docs

| Status | Item | Purpose |
| --- | --- | --- |
| active v1.0.2 | [admob/release-admob-checklist.md](./admob/release-admob-checklist.md) | Rewarded AdMob checklist for the capability-controlled App Review path. Rewards are optional and require server-side SSV before credits are reflected. |
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

## Historical Grep Conflict Classification (2026-05-06)

This table records the May 6 organization pass and is not proof of current release consistency. Current validation is `cd legal-site && npm run validate`, plus the shipping-truth contract tests. The historical pass searched these terms across `README.md`, `docs`, `ios`, `workers`, and `legal-site`: subscription, Lite, Pro Max, Pro, monthly, monthly credit, 8-K, web search, Web検索, investment-advice terms, target/forecast terms, 500/280-credit product IDs, rewarded, AdMob, ads, and reward terms.

| Classification | Finding |
| --- | --- |
| active release-facing problem | None found in that historical pass after its then-current TestFlight checklist update. |
| internal acceptable | Active release docs intentionally mention prohibited/omitted features such as subscriptions, 8-K, web search, investment advice, target prices, and rewarded ads to say they are not in v1. |
| internal acceptable | iOS/Worker tests and dormant infrastructure mention subscriptions, AdMob, rewarded credits, and old product IDs as compatibility or negative-test coverage. |
| historical archived | Old specs and handoffs under `docs/archive/` contain subscription-era and broader product language. They are explicitly historical. |
| false positive | Generic words such as `Pro`, `500`, `monthly`, `recommended`, and Japanese `推奨` also appear in code comments, version strings, numeric examples, and non-release contexts. |

## Cleanup Notes

- Do not move `workers/testbench/*`, `workers/eval/*`, D1 migrations, or active source files as part of docs organization.
- `workers/testbench/runs/` and `workers/eval/runs/` contain large generated artifacts. They may be intentionally excluded from release commits unless explicitly requested.
- `releaseDecision` remains governed by Worker answer-safety, App Review, and manual verification gates. This organization pass does not close those blockers.
