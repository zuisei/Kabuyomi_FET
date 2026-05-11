# v1.0.2 Company UI Polish Restored Report

Generated: 2026-05-10 JST

## 1. Executive summary

The previous Company UI split decision has been reversed by product decision.

Company UI polish is restored into the `v1.0.2-subscription-rewarded-credits` release candidate. The restored scope is limited to SwiftUI Company presentation files and the related iOS presentation test. No Worker filing retrieval, Worker answer-quality logic, SEC Form Router, 20-F / 6-K / 8-K routing, or v1.2 work was added.

The branch is still not main-merge-ready. Real TestFlight StoreKit smoke and real AdMob SSV smoke remain required before merging to `main` or App Store submission readiness.

## 2. Branch / HEAD

- Repository: `/Users/0xt4/t4dano/Kabuyomi`
- Branch: `v1.0.2-subscription-rewarded-credits`
- HEAD: `e35a9c1`
- Main branch touched: no
- Production deploy: no
- Push: no
- v1.2 branch created: no

## 3. Previous split decision reversed

Superseded reports:

- `docs/release/V1_0_2_COMPANY_UI_POLISH_SPLIT_DECISION_REPORT.md`
- `docs/release/V1_0_2_TESTFLIGHT_CANDIDATE_PACKAGING_REPORT.md`

Those reports remain useful as historical audit evidence, but their recommendation to exclude Company UI polish is no longer the current release truth.

Current release truth:

- Company UI polish is included in v1.0.2.
- Source display polish is included in v1.0.2.
- Answer presentation polish is included in v1.0.2.
- Overview / summary UI polish is included in v1.0.2.
- No v1.2 / SEC Form Router / filing retrieval / Worker answer-quality changes are included.

## 4. Recovery method used

Recovery sources inspected before restoration:

- `git stash list`: no complete safe stash for the exact Company UI patch.
- Local commits and `git reflog`: no direct commit containing the full prior split-out Company UI state.
- Dangling Git objects from local recovery: found a candidate tree containing all ten target files.
- Existing UI polish reports: confirmed the intended scope was UI presentation, source display, answer presentation, summary/overview polish, and related tests.

Restoration method:

- Restored only the ten target paths from dangling tree `f9465aad9c67643592a590278eb9d559fc802b43`.
- No stash was applied.
- No Worker files were restored from the dangling tree.
- No broad checkout/reset was performed.

The recovered target diff is:

- 10 files changed
- 1075 insertions
- 306 deletions

## 5. Files restored

- `ios/Kabuyomi/Features/Company/CompanyComposer.swift`
- `ios/Kabuyomi/Features/Company/CompanyInsightsSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift`
- `ios/Kabuyomi/Features/Company/CompanySourceSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyTimeline.swift`
- `ios/Kabuyomi/Features/Company/CompanyTopBar.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/KabuyomiTests/ConversationPromptTests.swift`

## 6. Files not recoverable

No target file is currently known to be unrecoverable.

Important limitation:

- Recovery was from local Git object state, not from a named commit.
- The restored patch is therefore auditable as a recovered working-tree state, but it still needs normal human review before staging/commit.

## 7. Final v1.0.2 candidate scope

Included:

- subscriptions visible
- `kabuyomi.credits.50` visible
- `kabuyomi.credits.100` compatibility
- rewarded-credit UI hidden for Release/App Review until real Google AdMob SSV grant evidence is recorded in-repo
- StoreKit / Apple verification
- AdMob SSV rewarded credits
- Account Status privacy
- legal / App Review / TestFlight docs
- Company UI polish
- source display polish
- answer presentation polish
- overview / summary UI polish

Still excluded:

- SEC Form Router
- 20-F / 6-K / 8-K support
- foreign issuer routing
- filing retrieval changes
- Worker answer-quality logic changes
- model config changes
- production deploy
- push
- main merge

## 8. Tests run and results

Repository validation:

- `git diff --check`: passed
- `git diff --stat`: passed for review; final tracked dirty diff is 37 files, 2099 insertions, 603 deletions
- Restored Company target diff stat: 10 files changed, 1075 insertions, 306 deletions

iOS validation:

- `cd ios && xcodegen generate`: passed
- `xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`: passed, 140 tests / 0 failures
- `xcodebuild build -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`: passed

Worker validation:

- `cd workers && npm run typecheck`: passed
- `cd workers && npm test`: passed, 48 test files / 598 tests
- `cd workers && npm run dryrun:test`: passed, Wrangler dry-run only; no deploy
- `cd workers && npm run testbench:validate`: passed

Legal-site validation:

- `cd legal-site && npm run validate`: passed

## 9. Remaining blockers before main merge

P0:

- Real TestFlight StoreKit smoke remains required:
  - product load
  - `kabuyomi.credits.50` purchase
  - `kabuyomi.credits.100` compatibility behavior if returned
  - subscription product visibility
  - Lite subscription purchase
  - restore purchases
  - duplicate restore no double grant
  - Apple server verification
  - `/v1/usage` refresh

P0:

- Real AdMob SSV smoke remains required before any future rewarded-credit UI re-enable:
  - rewarded ad UI visibility in the candidate build
  - optional/free-ad-credit copy
  - real Google SSV callback receipt
  - `/v1/admob/reward-status` becomes `granted`
  - exactly +2 ad credits
  - paid balance remains separate
  - 3/day cap
  - 4th reward blocked
  - duplicate SSV no double grant

P1:

- Human review of restored Company UI diff before staging/commit.
- Human App Review metadata consistency check.
- Public legal URL smoke if App Store metadata depends on updated public pages.

## 10. Confirmation that no v1.2 / SEC Form Router work was added

Confirmed for this restoration:

- No `v1.2-sec-form-router` branch was created.
- No SEC Form Router was implemented.
- No form family registry was added.
- No 20-F / 6-K / 8-K routing was added.
- No foreign issuer routing was added.
- No filing retrieval logic was changed.
- No Worker answer-quality logic was changed.
- No production deploy, push, or merge was performed.
