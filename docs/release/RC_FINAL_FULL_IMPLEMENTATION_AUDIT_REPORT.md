# Kabuyomi RC Final Full Implementation Audit Report

Date: 2026-05-11

## 1. Executive summary

Kabuyomi RC was audited across iOS, Workers, Cloudflare config, legal Pages, release docs, billing/credit flows, AdMob rewarded-credit exposure, Apple verification, D1 migrations, and SEC filing answer quality.

Two release-relevant issues were fixed:

- Rewarded AdMob credit UI and public/App Review copy were drifting toward visible release claims without recorded real Google SSV grant evidence.
- Test Worker live benchmark exposed an OpenAI dashboard prompt variable mismatch that forced chat answers into fallback.

The rewarded-credit UI is hidden for Release/App Review. The Worker SSV backend remains implemented and tested, but it is backend-only until real SSV grant evidence is recorded.

## 2. Final release decision

RC READY - PRODUCTION DEPLOYED - SMOKE PASSED

## 3. Branch and commits

- Branch: `main`
- Implementation commit: `03cab44 Finalize Kabuyomi RC release`
- OpenAI prompt blocker fix: `8d598ca Fix OpenAI prompt variable mismatch`
- Production Worker deployed from Worker code at `8d598ca`
- This report and successful benchmark artifacts are documentation/evidence only and do not change deployed Worker runtime.

## 4. Current shipping truth

Kabuyomi RC is a Japanese iOS app for reading U.S. SEC filings. The core visible product is 10-K / 10-Q company search, company pages, watchlist, filing-first chat/Q&A, source-backed answers, visible paid credits, visible subscriptions, legal links, and usage/credit status.

Standard chat uses the Worker with `LLM_PROVIDER=openai`, `OPENAI_CHAT_MODEL=gpt-5-nano`, and production `OPENAI_REASONING_EFFORT=low`. Standard chat does not ship external web search as a user-visible feature.

Rewarded AdMob credit backend routes are implemented and SSV-gated, but rewarded-credit UI is hidden in Release/App Review until real production/TestFlight Google SSV grant evidence is recorded.

## 5. Feature classification table

| Feature | Classification | Evidence / notes |
|---|---|---|
| SEC 10-K / 10-Q filing reader | SHIPPING_VISIBLE | iOS company/search/watchlist/chat flows and Worker filing routes smoke passed. |
| Company search | SHIPPING_VISIBLE | Production smoke `/v1/search` passed. |
| Company page | SHIPPING_VISIBLE | Production smoke `/v1/company/AAPL` path passed through smoke script. |
| Watchlist | SHIPPING_VISIBLE | Production smoke add/remove passed. |
| Chat / filing Q&A | SHIPPING_VISIBLE | Production smoke chat and chat-history passed. |
| Source citations / source IDs | SHIPPING_VISIBLE | Minimal Core 60 `sourceIdsValidFalse=0`. |
| Fallback behavior | SHIPPING_VISIBLE | Honest fallback remains active; Minimal Core 60 had 11 fallback rows, no invalid source IDs. |
| Minimal Core / testbench | SHIPPING_BACKEND_ONLY | Testbench is an internal quality gate; full 60 run completed. |
| Consumable paid credits | SHIPPING_VISIBLE | Product IDs and Worker tests cover `kabuyomi.credits.50` and `kabuyomi.credits.100`. |
| Subscription monthly credits | SHIPPING_VISIBLE | iOS UI, StoreKit IDs, Worker entitlement tests, App Review notes, and legal copy align. |
| Rewarded AdMob credits | SHIPPING_BACKEND_ONLY | Backend implemented/tested; UI hidden for Release/App Review. |
| Free/promotional credits | SHIPPING_VISIBLE | Usage/credit bucket remains visible as promotional/free balance. |
| Usage/quota response | SHIPPING_VISIBLE | Production smoke usage passed via smoke script. |
| StoreKit purchase / restore | SHIPPING_VISIBLE | iOS tests/build pass; manual sandbox/TestFlight purchase still required. |
| App Store Server verification | SHIPPING_BACKEND_ONLY | Worker tests verify Apple server authority, bundle/product mismatch rejection, sandbox/production/auto behavior. |
| Apple JWS parsing / trust boundary | SHIPPING_BACKEND_ONLY | Client JWS alone is rejected in tests; Apple server payload is authoritative. |
| AdMob SSV | SHIPPING_BACKEND_ONLY | Tests cover valid/duplicate/invalid SSV and daily cap; no real SSV smoke recorded. |
| Legal Pages site | SHIPPING_VISIBLE | Pages deployed and live legal URLs returned 200. |
| Worker legal fallback routes | SHIPPING_BACKEND_ONLY | Copy aligned with hidden rewarded-credit truth. |
| App Review notes | SHIPPING_VISIBLE | Updated to avoid hidden rewarded-credit claims. |
| Remote config | SHIPPING_BACKEND_ONLY | iOS Release gate hides rewarded-credit UI independent of stale remote config. |
| Web search / external context | IMPLEMENTED_BUT_HIDDEN | Not presented as standard chat shipping behavior. |
| SEC Form Router / 8-K / 20-F / 6-K / DEF14A support | STALE_DOC_ONLY / EXPERIMENTAL_DO_NOT_SHIP | Not treated as RC visible scope. |
| Account/sync | SHIPPING_VISIBLE | App model and persistence tests pass; manual device/TestFlight check remains. |
| Debug/internal/admin routes | IMPLEMENTED_BUT_HIDDEN | Not public RC user surface. |

## 6. Worker audit result

Worker routes and core billing/chat paths were inspected through source review and tests. The critical live issue found was the OpenAI dashboard prompt variable mismatch. The Worker was sending `original_question` and `conversation_context` variables to a deployed prompt that did not accept them. This produced OpenAI 400 errors and chat fallback in the first live benchmark. The fix embeds conversation context into the accepted `question` variable and removes the unsupported variables.

## 7. iOS audit result

iOS generated successfully, full simulator tests passed on iPhone 16 iOS 18.5, and Release build passed with code signing disabled. Rewarded-credit UI is hidden in Release/App Review. Subscriptions and consumable credit UI remain visible.

## 8. SEC filing / AI quality audit result

The fixed live Minimal Core 60 run completed against the test Worker with no infra contamination, no provider errors, no rate limits, no surfaced raw English, and no invalid source IDs. Eleven rows used honest fallback. These are residual quality risks, not hidden hallucination evidence from the summary artifact.

## 9. Testbench / benchmark result

- Failed pre-fix live sample: `workers/testbench/runs/2026-05-11T12-09-55-400Z-summary.json`
- Fixed 3-row live sample: `workers/testbench/runs/2026-05-11T12-12-20-rc-fix-smoke-summary.json`
- Final Minimal Core 60: `workers/testbench/runs/2026-05-11T12-13-00-rc-final-minimal-core-60-summary.json`

Final Minimal Core 60 summary:

- Rows: 60
- Response paths: `openai=44`, `deterministic=5`, `fallback=11`
- `sourceIdsValidFalse=0`
- `infraContaminated=false`
- Provider/network/auth/rate-limit/engineering error rows: 0
- `rawEnglishSurfaced=0`
- `bannedFallbackPhraseHits=0`
- `bankTermsInNonBankSectors=0`
- `wrongSectorTerms=0`
- Quality fallback rate: 18.3%
- p99 latency: 6916 ms

## 10. Billing / credits audit result

Worker tests cover paid credit grants, duplicate consumable idempotency, unknown/mismatched products, refund idempotency, monthly grant audit repair, separate monthly grants for same-period upgrades, and no client-only Apple grant. Paid credits remain separate from subscription/free/ad buckets in runtime structures and public copy.

## 11. Subscription audit result

Subscriptions remain visible. Product IDs are `kabuyomi.sub.lite.monthly`, `kabuyomi.sub.pro.monthly`, and `kabuyomi.sub.max.monthly`. App Review and legal copy describe subscription monthly credits separately from paid credits. Manual sandbox/TestFlight purchase, restore, cancel/renew state, and upgrade/downgrade checks remain required in App Store Connect/TestFlight.

## 12. Rewarded AdMob audit result

Rewarded-credit backend routes are implemented and tests cover SSV validation, duplicate callback idempotency, invalid signature/custom data rejection, and daily cap behavior. Because no real Google SSV callback evidence is recorded in-repo, rewarded-credit UI is hidden for Release/App Review and App Review notes do not claim ad credits are visible.

## 13. Apple verification / JWS trust-boundary result

Apple App Store Server verification is server-authoritative in tests. Client-provided JWS alone is not accepted. Bundle and product mismatches reject. Production config uses `APPLE_APP_STORE_SERVER_ENVIRONMENT=auto`; test config uses sandbox.

## 14. Legal / App Review audit result

Legal Pages and Worker fallback legal copy were updated to match current RC truth. Public legal Pages validation passed. Live URLs verified:

- `https://kabuyomi-legal-site.pages.dev/privacy/` 200
- `https://kabuyomi-legal-site.pages.dev/terms/` 200
- `https://kabuyomi-legal-site.pages.dev/support/` 200
- `https://kabuyomi-legal-site.pages.dev/tokushoho/` 200

Live grep after Pages deploy found no `TODO_FINAL_LEGAL`, `ad credit`, or `広告報酬` in privacy/terms/tokushoho.

## 15. Cloudflare config audit result

Production Worker:

- Name: `kabuyomi-api`
- URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Version ID: `4df2ecec-c1a2-4af3-b4dc-aae6c5aaa26d`
- Model config: `gpt-5-nano`, reasoning `low`
- Apple environment: `auto`

Test Worker:

- Name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Fixed version ID: `3dc7df51-6c4e-4dac-8df8-21dcecbbb493`
- Model config: `gpt-5-nano`, reasoning `minimal`
- Apple environment: `sandbox`

## 16. D1 migration audit result

No new D1 migration was required. Existing migrations are additive or index-oriented except the intentional drop of the older monthly grant user-period uniqueness index in `0007`, which enables auditable same-period plan upgrades. AdMob audit tables exist in `0008`; repair queue exists in `0009`.

## 17. Files changed

Changed areas:

- iOS app model, company UI, settings/credits, persistence, tests
- Worker chat/finalizer/OpenAI prompt handling, legal route, tests
- Legal Pages public copy and validation
- Release/App Review/legal/AdMob documentation
- Testbench evidence artifacts

## 18. Tests added/updated

Updated Worker OpenAI prompt tests, chat/source/final-answer language tests, iOS AppModel/test fixtures, and the oversized chat payload test. Added final live testbench evidence artifacts.

## 19. Commands run

Key commands run:

- `git status --short`
- `git branch --show-current`
- `git remote -v`
- `git log --oneline -20`
- `git stash list`
- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`
- `npm test -- openai`
- `npm test -- apple-store-server credit-quota entitlement billing-sync`
- `npm test -- admob`
- `npm test -- chat`
- `npm test -- source`
- `npm test -- billing`
- `npm test -- quota`
- `npm test -- purchase` (no matching files)
- `npm test -- subscription` (no matching files)
- `xcodegen generate`
- `xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5'`
- `xcodebuild -project Kabuyomi.xcodeproj -scheme Kabuyomi -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`
- `npm run validate` in `legal-site`
- `npm run deploy:test`
- `npm run smoke:test`
- `npm run testbench:run`
- `npm run deploy`
- `KABUYOMI_SMOKE_BASE_URL=https://kabuyomi-api.dznqjmctk7.workers.dev npm run smoke:staging`
- `npx wrangler pages deploy ...`

## 20. Test results

- Worker typecheck: passed
- Worker full tests: 50 files, 627 tests passed
- `sec-fetcher` tests: 15 passed
- Legal validation: passed
- iOS full test: passed after XBRL source-chip fix
- iOS Release build: passed
- `npm test -- purchase`: no matching files, coverage exists in broader Apple/billing/credit tests
- `npm test -- subscription`: no matching files, coverage exists in broader Apple/entitlement/billing tests

## 21. Test Worker deploy result

- Initial test deploy exposed live prompt-variable failure in testbench.
- Fixed test deploy succeeded:
  - Worker: `kabuyomi-api-test`
  - URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
  - Version ID: `3dc7df51-6c4e-4dac-8df8-21dcecbbb493`
- Staging smoke: passed

## 22. Production Worker deploy result

- Worker: `kabuyomi-api`
- URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Version ID: `4df2ecec-c1a2-4af3-b4dc-aae6c5aaa26d`
- Production smoke: passed

## 23. Legal Pages deploy result

- Project: `kabuyomi-legal-site`
- Deployment URL: `https://6be10134.kabuyomi-legal-site.pages.dev`
- Canonical Pages URL: `https://kabuyomi-legal-site.pages.dev`
- Privacy/terms/support/tokushoho returned 200

## 24. Smoke checks run

Test and production smoke covered:

- Usage baseline
- Search
- Watchlist add
- Company endpoint
- Chat
- Chat history
- Watchlist remove
- Billing sync

Legal smoke covered:

- Live privacy/terms/support/tokushoho status checks
- Live forbidden TODO/ad-credit text checks for privacy/terms/tokushoho

## 25. Smoke results

Test Worker smoke passed. Production Worker smoke passed. Legal Pages smoke passed.

## 26. Remaining non-blocking risks

- Minimal Core 60 still has 11 honest fallback rows and 18.3% quality fallback rate.
- Full human benchmark review was not completed; the automated summary shows no hard source/infrastructure blockers.
- Real Google AdMob SSV grant was not executed; rewarded-credit UI remains hidden until that evidence exists.
- Real StoreKit sandbox/TestFlight purchases, restores, subscription upgrade/downgrade, cancellation/renewal state, and App Store Connect metadata must still be manually checked.
- Production Worker was deployed from `8d598ca`; this report commit is documentation/evidence only and does not change Worker runtime.

## 27. Manual App Store Connect actions required

- Verify product availability/pricing for `kabuyomi.credits.50`, `kabuyomi.credits.100`, Lite, Pro, and Max.
- Confirm subscription group `Kabuyomi_sus`.
- Run sandbox/TestFlight purchase and restore for consumables and subscriptions.
- Confirm App Review notes do not claim rewarded ad credits.
- Confirm legal URLs in App Store metadata point to live Pages URLs.

## 28. Manual TestFlight checks required

- Fresh install and existing-user upgrade.
- Product load, consumable purchase, subscription purchase, restore/sync.
- Usage refresh after purchase/subscription.
- Confirm rewarded-credit UI is hidden in Release/App Review build.
- Open privacy/terms/support/tokushoho links from the app.
- Run a representative 10-K / 10-Q search, company page, watchlist, chat, chat-history flow.

## 29. Final status

RC READY - PRODUCTION DEPLOYED - SMOKE PASSED
