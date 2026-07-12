# Kabuyomi v1.0.2 Branch Cleanup And Merge Readiness Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-05-10 JST

Superseded note: the current RC decision changed again after this report. Rewarded-credit UI is hidden for Release/App Review until real Google AdMob SSV grant evidence is recorded in-repo. Older release-visible statements in this report are retained only as history and are superseded by `docs/release/RELEASE_TRUTH.md`.

## Executive Summary

The current checkout is on `v1.0.2-subscription-rewarded-credits` at HEAD `e35a9c1`.

This cleanup kept the branch inside the v1.0.2 monetization scope: consumable credits, subscriptions, rewarded-ad credit gating, StoreKit / Apple verification documentation, ledger correctness documentation, iOS Credits / Settings / Account Status UI safety, legal copy, and TestFlight readiness.

No production deploy, push, merge to `main`, v1.2 branch creation, SEC Form Router work, or filing retrieval / answer-quality logic changes were performed in this pass.

The branch is not ready to merge to `main` yet because real TestFlight / StoreKit smoke remains unverified. It is closer to review-ready locally: Worker tests pass, iOS simulator tests pass after a small Account Status duplicate-row crash fix, unsigned simulator build passes, legal-site validation passes, and `git diff --check` is clean.

## Current Branch / HEAD / Dirty State Before Cleanup

- Branch before cleanup: `v1.0.2-subscription-rewarded-credits`
- HEAD before cleanup: `e35a9c1 Add v1.0.2 production Worker deploy report`
- `main` was not checked out or modified.
- Working tree before cleanup was dirty.

Initial dirty tracked files:

- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/Features/Ads/AdMobBannerView.swift`
- `ios/Kabuyomi/Features/Company/CompanyComposer.swift`
- `ios/Kabuyomi/Features/Company/CompanyInsightsSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift`
- `ios/Kabuyomi/Features/Company/CompanySourceSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyTimeline.swift`
- `ios/Kabuyomi/Features/Company/CompanyTopBar.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/Features/Settings/SettingsView.swift`
- `ios/Kabuyomi/Services/SubscriptionStore.swift`
- `ios/KabuyomiTests/AppModelTests.swift`
- `ios/KabuyomiTests/ConversationPromptTests.swift`
- `ios/project.yml`
- `workers/src/routes/admob-rewards.ts`
- `workers/test/admob-rewards.test.ts`

Initial untracked release reports:

- `docs/release/V1_0_2_ACCOUNT_STATUS_PRIVACY_FIX_REPORT.md`
- `docs/release/V1_0_2_OVERVIEW_PRO_UI_REPORT.md`
- `docs/release/V1_0_2_REWARDED_AD_CREDITS_REPORT.md`
- `docs/release/V1_0_2_UI_COLOR_CORRECTION_REPORT.md`
- `docs/release/V1_0_2_UI_POLISH_FIXUP_REPORT.md`
- `docs/release/V1_0_2_UI_POLISH_REPORT.md`
- `docs/release/V1_0_2_UI_POLISH_SAFETY_REVIEW_REPORT.md`
- `docs/release/V1_0_2_UI_VERIFICATION_REPORT.md`

## Dirty Diff Classification

| Group | Files / Areas | Classification |
| --- | --- | --- |
| v1.0.2 backend monetization | `workers/src/routes/admob-rewards.ts`, `workers/test/admob-rewards.test.ts` | Rewarded-ad credit validation and tests. |
| v1.0.2 iOS monetization UI | `ios/Kabuyomi/Features/Settings/CreditView.swift`, `ios/Kabuyomi/Services/SubscriptionStore.swift`, `ios/Kabuyomi/App/AppModel.swift`, `ios/project.yml`, `ios/KabuyomiTests/AppModelTests.swift` | Credit / subscription / Account Status / release version UI and tests. |
| Rewarded ad / AdMob | `ios/Kabuyomi/Features/Ads/AdMobBannerView.swift`, `workers/src/routes/admob-rewards.ts`, `workers/test/admob-rewards.test.ts`, AdMob docs | Rewarded credit infrastructure and gated visibility. |
| Account Status / privacy UI | `ios/Kabuyomi/Features/Settings/CreditView.swift`, `ios/Kabuyomi/Features/Settings/SettingsView.swift`, `ios/KabuyomiTests/AppModelTests.swift` | Account display and legal/privacy copy. |
| release docs / App Review docs | `docs/release/*`, `docs/legal/*`, `docs/admob/*`, `README.md`, `docs/INDEX.md`, `legal-site/public/*`, `workers/src/routes/legal.ts` | v1.0.2 release truth alignment. |
| unrelated or suspicious | Company UI files under `ios/Kabuyomi/Features/Company/*`, `ios/KabuyomiTests/ConversationPromptTests.swift` | Presentation / source display polish already present in dirty diff. No Worker retrieval or answer-quality logic was changed in this cleanup. Human reviewer should decide whether to keep this UI polish in the same v1.0.2 PR. |
| v1.2 / SEC Form Router related | None found in dirty diff | No form family registry, foreign issuer routing, 20-F / 6-K / 8-K routing, filing candidate ranking, or question-aware filing selection changes were found. |

## Files Changed By This Cleanup

- `README.md`
- `docs/INDEX.md`
- `docs/admob/release-admob-checklist.md`
- `docs/admob/rewarded_admob_credits_runbook.md`
- `docs/legal/APPLE_STORE_SERVER_CONFIG.md`
- `docs/legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md`
- `docs/release/APP_STORE_SUBMISSION_NOTES.md`
- `docs/release/CURRENT_SHIPPING_TRUTH.md`
- `docs/release/RELEASE_TRUTH.md`
- `docs/release/TESTFLIGHT_READINESS_CHECKLIST.md`
- `docs/release/V1_0_2_BRANCH_CLEANUP_AND_MERGE_READINESS_REPORT.md`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/Features/Settings/SettingsView.swift`
- `legal-site/public/terms/index.html`
- `legal-site/public/tokushoho/index.html`
- `legal-site/scripts/validate.mjs`
- `workers/src/routes/legal.ts`

## Release Truth Decisions Reflected In Docs

- v1.0.2 includes subscriptions when the app exposes them.
- `kabuyomi.credits.50` is the primary visible paid-credit consumable: JPY 100, 50 paid credits.
- `kabuyomi.credits.100` remains supported as an existing compatibility product when StoreKit returns it.
- Subscription group is `Kabuyomi_sus`.
- Lite / Pro / Max monthly plans are documented as:
  - `kabuyomi.sub.lite.monthly`: JPY 640/month, 400 subscription credits/month.
  - `kabuyomi.sub.pro.monthly`: JPY 1,280/month, 900 subscription credits/month.
  - `kabuyomi.sub.max.monthly`: JPY 2,560/month, 2,000 subscription credits/month.
- Normal chat cost remains 2 credits.
- Paid, subscription, free/promotional, and ad credits are documented as separate buckets.
- Paid credits do not expire.
- Ad credits may expire after 30 days if the ledger supports expiry.
- Rewarded-credit UI is hidden for the current RC; real TestFlight/production SSV smoke remains required before any future UI re-enable or App Store submission material can describe rewarded ads.
- Older "no subscriptions" and "only kabuyomi.credits.100" release-truth statements were replaced or superseded.
- No legal identity, address, phone number, or seller details were invented.

## Product IDs Confirmed In Code / Docs

Confirmed in code:

- iOS: `ios/Kabuyomi/Services/SubscriptionStore.swift`
  - `kabuyomi.credits.50`
  - `kabuyomi.credits.100`
- iOS beta billing catalog: `ios/Kabuyomi/Services/BetaBilling.swift`
  - `kabuyomi.sub.lite.monthly`
  - `kabuyomi.sub.pro.monthly`
  - `kabuyomi.sub.max.monthly`
- Worker billing catalog: `workers/src/lib/billing-catalog.ts`
  - `kabuyomi.credits.50`
  - `kabuyomi.credits.100`
  - `kabuyomi.sub.lite.monthly`
  - `kabuyomi.sub.pro.monthly`
  - `kabuyomi.sub.max.monthly`

Confirmed in docs/legal copy after cleanup:

- `kabuyomi.credits.50`
- `kabuyomi.credits.100`
- `Kabuyomi_sus`
- `kabuyomi.sub.lite.monthly`
- `kabuyomi.sub.pro.monthly`
- `kabuyomi.sub.max.monthly`

## Rewarded Ad Visibility Status

Current RC truth superseding the earlier cleanup pass: rewarded-ad credit UI is hidden for Release/App Review until real Google AdMob SSV grant evidence is recorded in-repo.

The Worker route tests cover +2 credits, reward amount / item validation, duplicate handling, and daily cap behavior. This is not a substitute for real TestFlight / production SSV smoke.

## App Review / Legal Copy Risks

The focused risk-term scan over release-facing docs, legal pages, iOS app copy, and Worker legal fallback found investment-policy terms only in disclaimers, safety filters, or negative claims such as "投資助言ではありません" and "売買推奨、株価予測、目標株価は提供しません".

No user-facing copy was found that claims buy/sell recommendations, target prices, guaranteed performance, or stock-picking recommendations.

Remaining App Review risks:

- Real StoreKit / TestFlight product loading and purchase / restore smoke remains unverified in this pass.
- Real subscription renewal / restore behavior remains unverified in this pass.
- Real rewarded-ad SSV smoke remains unverified in this pass; the build is not main-merge/App-Store-submission-ready until that evidence is produced.
- Static legal-site deployment was not performed in this pass.

## Tests Run And Results

Worker:

- `cd workers && npm run typecheck`: passed.
- `cd workers && npm test`: passed, 48 files / 597 tests.
- `cd workers && npm run dryrun:test`: passed, Wrangler dry-run only; no deploy.
- `cd workers && npm run testbench:validate`: passed, 5 default tickers / 12 question templates.

iOS:

- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`: first run failed with a crash in `AppModelTests/testAccountStatusDisplayModelUsesServerUsageAndHandlesMissingActiveSubscription()` caused by duplicate `"環境"` rows in the Account Status display model.
- Cleanup fix: removed duplicate DEBUG `"環境"` row from `AccountStatusDisplayModel.debugRows`.
- Rerun of the same iOS test command: passed, 140 tests / 0 failures.
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`: passed.

Legal / formatting:

- `cd legal-site && npm run validate`: initially failed because the validator still treated `Lite` as a forbidden old v1 claim.
- Cleanup fix: removed `Lite` from the forbidden legal-site validator terms because Lite is now an intended v1.0.2 subscription.
- Rerun of `cd legal-site && npm run validate`: passed.
- `git diff --check`: passed.

## Remaining Blockers Before Merging To Main

P0:

- Real TestFlight StoreKit smoke is still required:
  - `kabuyomi.credits.50` product load and purchase.
  - `kabuyomi.credits.100` compatibility behavior if returned by StoreKit.
  - Lite / Pro / Max subscription product load.
  - subscription purchase / restore / duplicate sync no-op.
  - Apple server verification in the intended TestFlight environment.

P0:

- Rewarded-credit UI is hidden in the current RC, and real AdMob SSV evidence must be recorded before any future UI re-enable.

P1:

- Superseded: the human decided Company UI polish belongs in the v1.0.2 candidate. It should stay included unless a later explicit release decision reverses this again.

P1:

- Static legal-site deployment and URL smoke were not performed in this pass.

## Merge-Ready Statement

This branch is not ready to merge to `main` yet.

It is locally cleaner and passes available local validation, but merge to `main` should wait for TestFlight / StoreKit smoke and restored Company UI validation. Company UI polish is currently included in this v1.0.2 PR candidate.

## Exact Next Human Actions

1. Review the dirty diff on `v1.0.2-subscription-rewarded-credits`, including the restored Company UI polish files, before staging/commit.
2. Confirm App Store Connect product configuration for `kabuyomi.credits.50`, `kabuyomi.credits.100`, `Kabuyomi_sus`, Lite, Pro, and Max.
3. Build and install a real TestFlight candidate.
4. Run StoreKit/TestFlight smoke for consumable purchase, subscription purchase, restore, and duplicate grant no-op.
5. Run and record real AdMob SSV smoke before any future rewarded-credit UI re-enable or App Store submission material describes rewarded ads.

## Confirmation: No v1.2 / SEC Form Router Work Added

Confirmed for this cleanup pass:

- No `v1.2-sec-form-router` branch was created.
- No SEC Form Router was implemented.
- No form family registry was added.
- No 20-F / 6-K / 8-K routing was added.
- No foreign issuer detection was added.
- No filing candidate ranking was added.
- No question-aware form selection was added.
- No filing retrieval or Worker answer-quality logic was changed.
- No production deploy, push, or merge was performed.
