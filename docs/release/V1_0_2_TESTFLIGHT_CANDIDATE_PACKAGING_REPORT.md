# Kabuyomi v1.0.2 TestFlight Candidate Packaging Report

Date: 2026-05-10 JST

Superseded current-state note, 2026-05-10 JST:

- The product decision was reversed after this packaging review.
- Company UI polish is now included in the v1.0.2 release candidate.
- Treat this report as historical evidence that the Company UI polish could be split safely, not as the current release decision.
- Current release truth is recorded in `docs/release/V1_0_2_COMPANY_UI_POLISH_RESTORED_REPORT.md`.

## 1. 結論

`v1.0.2-subscription-rewarded-credits` は、Company UI polish を候補から分離すれば、v1.0.2 monetization TestFlight candidate としてより clean に packaging できる。

この確認では、現在の worktree を直接 revert せず、一時 worktree `/tmp/kabuyomi-v102-candidate-test` に「Company UI polish を除いた v1.0.2 候補差分」を適用して検証した。結果として Worker / legal-site / iOS test-build が通ったため、Company UI polish は v1.0.2 monetization candidate から安全に除外可能と判断する。

現 worktree には Company UI polish がまだ残っている。TestFlight candidate を切る直前に、下記ファイルを別ブランチへ退避するか、この v1.0.2 candidate から除外することを推奨する。

## 2. branch / HEAD

- Current branch: `v1.0.2-subscription-rewarded-credits`
- HEAD: `e35a9c1`
- `main` checkout / merge: not performed
- Push: not performed
- Production deploy: not performed
- v1.2 branch creation: not performed

## 3. current dirty diff summary

Current dirty diff contains these groups:

| Group | Files / Area | Candidate decision |
| --- | --- | --- |
| Subscription / credit UI | `ios/Kabuyomi/Features/Settings/CreditView.swift`, `ios/Kabuyomi/Services/SubscriptionStore.swift`, `ios/Kabuyomi/App/AppModel.swift`, `ios/project.yml`, `ios/KabuyomiTests/AppModelTests.swift` | Keep in v1.0.2 candidate |
| Account Status / privacy | `CreditView.swift`, `SettingsView.swift`, `AppModelTests.swift` | Keep in v1.0.2 candidate |
| AdMob reward gating/backend | `ios/Kabuyomi/Features/Ads/AdMobBannerView.swift`, `workers/src/routes/admob-rewards.ts`, `workers/test/admob-rewards.test.ts` | Keep in v1.0.2 candidate |
| Release/legal/App Review docs | `README.md`, `docs/INDEX.md`, `docs/release/*`, `docs/legal/*`, `docs/admob/*`, `legal-site/public/*`, `workers/src/routes/legal.ts` | Keep in v1.0.2 candidate |
| Company UI polish | `ios/Kabuyomi/Features/Company/*`, `ios/KabuyomiTests/ConversationPromptTests.swift` | Split/exclude from v1.0.2 candidate |
| v1.2 / SEC Form Router | None found | Not present |

Current total tracked dirty diff before any split:

- 33 tracked files changed
- Approximately 2012 insertions / 586 deletions
- 9 untracked v1.0.2 release report files, including this packaging report after creation

## 4. Company UI polish keep/split decision

Decision: split / exclude from TestFlight monetization candidate.

Reason:

- The Company UI files are mostly presentation / copy / source-display polish.
- Some Company UI changes mention credits or open `CreditView`, but they are not the core StoreKit, subscription store, ledger, backend reward, Account Status privacy, or App Review/legal truth changes.
- A temporary candidate without these files applied cleanly and passed validation after generating the iOS project.
- Excluding them reduces release review surface and keeps v1.0.2 focused on monetization correctness.

Exact files recommended to move to a separate UI polish branch or revert from the v1.0.2 TestFlight candidate:

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

Recommended safe workflow:

1. Create a separate branch from the current dirty state for Company UI polish preservation, or create a patch for the files above.
2. Return to `v1.0.2-subscription-rewarded-credits`.
3. Remove only the file changes listed above from the TestFlight candidate.
4. Re-run the validation commands listed in this report.

No destructive revert was performed in the main worktree during this pass.

## 5. files reverted or retained

Reverted in current worktree: none.

Retained in current worktree:

- All existing dirty changes remain present.
- This report was added.

Validated as safe to exclude in a temporary worktree:

- The 10 Company UI / `ConversationPromptTests.swift` files listed above.

## 6. final v1.0.2 candidate diff scope

After excluding Company UI polish, the candidate diff should contain only:

- Subscription / credit UI
- StoreKit / subscription store
- Account Status privacy
- AdMob reward gating/backend
- Release/legal/App Review docs
- Tests for the above

The temporary split-candidate worktree contained these tracked modified areas:

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
- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/Features/Ads/AdMobBannerView.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/Features/Settings/SettingsView.swift`
- `ios/Kabuyomi/Services/SubscriptionStore.swift`
- `ios/KabuyomiTests/AppModelTests.swift`
- `ios/project.yml`
- `legal-site/public/terms/index.html`
- `legal-site/public/tokushoho/index.html`
- `legal-site/scripts/validate.mjs`
- `workers/src/routes/admob-rewards.ts`
- `workers/src/routes/legal.ts`
- `workers/test/admob-rewards.test.ts`

## 7. validation results

Current worktree audit:

- `git branch --show-current`: `v1.0.2-subscription-rewarded-credits`
- `git status --short`: dirty; Company UI polish and monetization/docs changes both present
- `git diff --stat`: 33 tracked files changed before this report
- `git diff --check`: passed

Current worktree validation after this report was added:

- `cd workers && npm run typecheck`: passed
- `cd workers && npm test`: passed, 48 test files / 597 tests
- `cd workers && npm run dryrun:test`: passed, Wrangler dry-run only; no deploy
- `cd workers && npm run testbench:validate`: passed
- `cd legal-site && npm run validate`: passed
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`: passed, 140 tests / 0 failures
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`: passed

Temporary split-candidate worktree:

- Created from HEAD `e35a9c1` at `/tmp/kabuyomi-v102-candidate-test`
- Applied current tracked diff excluding the 10 Company UI / `ConversationPromptTests.swift` files
- `git diff --check`: passed
- `cd workers && npm install`: completed with an engine warning for `undici` and 1 moderate npm audit finding; used only to provide dependencies in the temporary worktree
- `cd workers && npm run typecheck`: passed
- `cd workers && npm test`: passed, 48 test files / 597 tests
- `cd workers && npm run dryrun:test`: passed, Wrangler dry-run only; no deploy
- `cd workers && npm run testbench:validate`: passed
- `cd legal-site && npm run validate`: passed
- `cd ios && xcodegen generate`: passed; needed because generated `Kabuyomi.xcodeproj` is not present in a fresh worktree
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`: passed, 139 tests / 0 failures
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`: passed

Note: the split candidate has 139 iOS tests because the excluded `ConversationPromptTests.swift` diff removed one added UI/source-display test from the current dirty branch.

## 8. whether candidate is ready for human TestFlight smoke

Yes, conditionally.

The v1.0.2 monetization candidate is ready for human TestFlight packaging/smoke after the Company UI polish files are split or excluded from the candidate diff.

It is not ready to merge to `main` and does not prove real StoreKit success. Human TestFlight smoke remains required.

## 9. remaining blockers before main merge

P0:

- Real TestFlight StoreKit smoke:
  - `kabuyomi.credits.50` product load and purchase
  - `kabuyomi.credits.100` compatibility behavior if StoreKit returns it
  - Lite / Pro / Max product load
  - subscription purchase
  - restore
  - duplicate grant / duplicate sync no-op
  - Apple server verification in the intended environment

P0:

- Rewarded-credit UI is now release-visible when required AdMob rewarded config is present; real AdMob SSV evidence is still required before main merge/App Store submission readiness.

P1:

- Split or intentionally retain Company UI polish before packaging. Recommendation is split.

P1:

- Confirm static legal URL deployment / App Store metadata URL smoke if the TestFlight/App Review package depends on newly updated legal copy.

## 10. explicit confirmation: no v1.2 / SEC Form Router work added

Confirmed:

- No `v1.2-sec-form-router` branch was created.
- No SEC Form Router was implemented.
- No form family registry was added.
- No 20-F / 6-K / 8-K routing was added.
- No foreign issuer detection was added.
- No filing candidate ranking was added.
- No question-aware form selection was added.
- No filing retrieval or Worker answer-quality logic was changed.
- No production deploy, push, or merge was performed.
