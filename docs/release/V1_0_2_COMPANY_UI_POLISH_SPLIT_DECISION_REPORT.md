# v1.0.2 Company UI Polish Split Decision Report

Generated: 2026-05-10 JST

Superseded current-state note, 2026-05-10 JST:

- The product decision was reversed after this split decision.
- Company UI polish has been restored into the v1.0.2 release candidate.
- Treat this report as historical evidence for the earlier split decision, not as the current candidate truth.
- Current release truth is recorded in `docs/release/V1_0_2_COMPANY_UI_POLISH_RESTORED_REPORT.md`.

## 1. Executive summary

Historical result at the time of this report: the Company UI polish changes were removed from the v1.0.2 monetization candidate.

Superseded historical decision: this report previously recommended excluding the inspected Company UI polish files from the branch's TestFlight candidate scope. That recommendation is no longer current. The later product decision restored Company UI polish into the v1.0.2 candidate.

The v1.0.2 candidate should remain focused on:

- visible subscriptions
- `kabuyomi.credits.50`
- compatibility with `kabuyomi.credits.100`
- visible rewarded ad credits
- StoreKit / Apple verification
- AdMob SSV rewarded credit grants
- credit ledger / idempotency safety
- Credits / Settings / Account Status monetization UI
- release / legal / App Review documentation and tests

No v1.2 / SEC Form Router work was added.

## 2. Branch / HEAD

- Repository: `/Users/0xt4/t4dano/Kabuyomi`
- Branch: `v1.0.2-subscription-rewarded-credits`
- HEAD: `e35a9c1`
- Main branch touched: no
- Production deploy: no
- Push: no

## 3. Company UI diff classification

| File | Classification | Decision | Reason |
| --- | --- | --- | --- |
| `ios/Kabuyomi/Features/Company/CompanyComposer.swift` | safe UI polish but unrelated | split out | Mostly composer copy/layout polish, including insufficient-credit wording. Not required because monetization entry points remain available from Credits/Settings. |
| `ios/Kabuyomi/Features/Company/CompanyInsightsSupport.swift` | risky because it changes answer/summary presentation | split out | Changes investor-overview wording and presentation tone. Unnecessary for a monetization-only candidate. |
| `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift` | safe UI polish but unrelated | split out | Drawer label/localization polish is not required for StoreKit, credits, Account Status privacy, or rewarded ads. |
| `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift` | risky because it changes source display / answer presentation / chat behavior | split out | Changes source chip behavior, source expansion, assistant metric rendering helpers, and suggestion wording. This is outside v1.0.2 monetization scope. |
| `ios/Kabuyomi/Features/Company/CompanySourceSupport.swift` | risky because it changes source display wording | split out | Changes investor-facing source labels for metrics such as revenue, operating income, and net income. This should not ride with monetization cleanup. |
| `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift` | risky because it changes summary presentation | split out | Large summary drawer presentation/copy changes are unrelated to the v1.0.2 monetization candidate. |
| `ios/Kabuyomi/Features/Company/CompanyTimeline.swift` | safe UI polish but unrelated | split out | Timeline UI/presentation polish is not required for monetization release safety. |
| `ios/Kabuyomi/Features/Company/CompanyTopBar.swift` | safe UI polish but unrelated | split out | Top bar visual polish is unrelated to v1.0.2 monetization. |
| `ios/Kabuyomi/Features/Company/CompanyView.swift` | mixed; contains unrelated presentation and limited credit-routing changes | split out | Some insufficient-credit routing touched monetization-adjacent UI, but the file also changed source preview/evidence presentation. Credits remain reachable from Credits/Settings, so keeping it is not required. |
| `ios/KabuyomiTests/ConversationPromptTests.swift` | test for unrelated Company answer presentation helper | split out | The added test covered metric row parsing introduced by Company message rendering changes, not v1.0.2 monetization. |

## 4. Files reverted

The following files were restored to the branch baseline and are no longer part of the dirty diff:

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

## 5. Files retained and why

No Company UI polish files were retained.

The retained dirty diff is limited to v1.0.2 monetization/release surfaces:

- subscription / credit UI
- StoreKit / subscription store
- Account Status privacy
- AdMob rewarded credit gating and backend SSV verification
- release, legal, App Review, and TestFlight documentation
- tests for the above

## 6. Final v1.0.2 candidate scope

The final candidate scope after splitting Company UI polish is:

- subscriptions visible in v1.0.2
- `kabuyomi.credits.50` visible
- `kabuyomi.credits.100` remains supported as compatibility if present
- rewarded ad credits visible and App Review-visible
- rewarded ads grant free/ad credits only after server-side verification
- duplicate AdMob SSV callbacks do not double grant
- invalid SSV/custom data does not grant
- daily cap remains server-enforced at 3 successful rewards/day
- Credits / Settings / Account Status UI remains in scope
- release truth, legal copy, App Review notes, and TestFlight readiness docs remain in scope

The candidate still does not include filing retrieval changes, answer-quality logic changes, SEC Form Router, form family registry, foreign issuer support, or 20-F / 6-K / 8-K support.

## 7. Validation results

Pre- and post-split checks were run from `/Users/0xt4/t4dano/Kabuyomi`:

- `git branch --show-current`: passed, branch remained `v1.0.2-subscription-rewarded-credits`
- `git status --short`: passed for inspection
- `git diff --stat`: passed for inspection
- `git diff --check`: passed

iOS validation from `/Users/0xt4/t4dano/Kabuyomi/ios`:

- `xcodegen generate`: passed
- `xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`: passed, 139 tests, 0 failures
- `xcodebuild build -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`: passed

Worker validation from `/Users/0xt4/t4dano/Kabuyomi/workers`:

- `npm run typecheck`: passed
- `npm test`: passed, 48 test files / 598 tests
- `npm run dryrun:test`: passed, dry-run only; no deploy
- `npm run testbench:validate`: passed

## 8. Remaining blockers before main merge

This branch is not main-merge-ready yet.

Remaining blockers:

- real AdMob SSV smoke on device/TestFlight is still required
- real TestFlight StoreKit smoke is still required
- human App Review metadata check is still required before submission
- human review of the final dirty diff and untracked release reports is still required before staging/commit

## 9. v1.2 / SEC Form Router confirmation

No v1.2 / SEC Form Router work was added.

This cleanup did not add or modify:

- form family registry
- 20-F / 6-K / 8-K routing
- foreign issuer detection
- filing candidate ranking
- question-aware form selection
- SEC source extraction changes
- filing retrieval logic
- answer-quality logic
