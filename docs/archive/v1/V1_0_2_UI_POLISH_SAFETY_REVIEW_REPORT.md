# Kabuyomi v1.0.2 UI Polish Safety Review Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Conclusion

The semantic safety review found no accidental Worker, SEC retrieval, model, prompt, answer-generation, source-selection, billing grant, StoreKit, product ID, or API endpoint contract changes.

The local iPhone 16 build/test gate remains green. The visual sweep found one concrete release-readiness issue: at `accessibility-large` Dynamic Type, the chat composer can overlap the lower answer/follow-up area. That has to be fixed before release if accessibility-large is part of the release gate.

No deploy, push, or commit was performed.

## 2. Semantic diff review result

Pass with one presentation-only note.

- `AppModel.swift` changes are copy/status/error-message changes and insufficient-credit UI support.
- No purchase, sync, restore, backend credit grant, transaction finish, or usage accounting behavior changed.
- No Worker/API endpoint paths changed.
- No product IDs changed.
- No SEC filing retrieval behavior changed.
- No answer-generation or prompt policy behavior changed.
- No source selection logic changed.
- Source label cleanup can collapse multiple visible chips with the same investor-facing label, but it does not change the underlying source references, source IDs, source selection, or open-source routing.
- No new investment-advice wording was introduced.
- No full device key, token, transaction ID, or Apple signed transaction payload is exposed in normal UI.

## 3. Files reviewed

- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/App/Theme.swift`
- `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift`
- `ios/Kabuyomi/Features/Company/CompanyComposer.swift`
- `ios/Kabuyomi/Features/Company/CompanyInsightsSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanySourceSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanyTimeline.swift`
- `ios/Kabuyomi/Features/Company/CompanyTopBar.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/Services/SubscriptionStore.swift`
- `ios/KabuyomiTests/AppModelTests.swift`
- `ios/KabuyomiTests/ConversationPromptTests.swift`
- `ios/project.yml`
- `docs/archive/v1/V1_0_2_OVERVIEW_PRO_UI_REPORT.md`
- `docs/archive/v1/V1_0_2_UI_POLISH_REPORT.md`
- `docs/archive/v1/V1_0_2_UI_VERIFICATION_REPORT.md`

## 4. Screenshots captured

Captured under ignored local evidence directory:

- `test-results/v1.0.2-ui-safety-review/iphone16_overview_top_summary.png`
- `test-results/v1.0.2-ui-safety-review/iphone16_overview_major_metrics.png`
- `test-results/v1.0.2-ui-safety-review/iphone16_overview_confirmation_watch_points.png`
- `test-results/v1.0.2-ui-safety-review/iphone16_chat_answer_sources_followups.png`
- `test-results/v1.0.2-ui-safety-review/iphone16_credits_main.png`
- `test-results/v1.0.2-ui-safety-review/iphone16e_overview_top_summary.png`
- `test-results/v1.0.2-ui-safety-review/iphone16e_overview_major_metrics.png`
- `test-results/v1.0.2-ui-safety-review/iphone16e_chat_answer.png`
- `test-results/v1.0.2-ui-safety-review/iphone16e_credits_main.png`
- `test-results/v1.0.2-ui-safety-review/dynamic_type_accessibility_large_overview_metrics.png`
- `test-results/v1.0.2-ui-safety-review/dynamic_type_accessibility_large_chat_sources_followups.png`
- `test-results/v1.0.2-ui-safety-review/dynamic_type_accessibility_large_credits_main.png`

## 5. iPhone SE result

iPhone SE was not installed in the available simulator list. The smallest available iPhone simulator was iPhone 16e, so the small-screen sweep used iPhone 16e.

iPhone 16e result:

- Overview top/summary: readable; close action reachable.
- Overview major metrics: readable; accessibility-sized metric rows stack cleanly.
- Chat answer: readable at normal content size; source chips and follow-up chips are not horizontally clipped.
- Credits main: readable; restore/purchase management remains reachable by scrolling.

## 6. Dynamic Type result

Dynamic Type was tested on iPhone 16e with:

- `xcrun simctl ui DFC7A7BE-35BA-482A-86AA-E0FE535C8DB7 content_size accessibility-large`

Result:

- Overview major metrics: acceptable. The metric table switches into stacked rows and avoids horizontal overflow.
- Credits main: acceptable but visually dense. Primary actions remain reachable.
- Chat answer/source/follow-up area: not acceptable for release. The composer can overlap the lower answer/follow-up area at `accessibility-large`, making part of the content hard to read.

The content size was reset to `large` after capture.

## 7. Sensitive-info exposure result

Pass by static review.

- Account/debug UI uses a redacted device key suffix only.
- Full device key is not shown.
- Full transaction IDs are not shown.
- Tokens are not shown.
- Apple signed transaction payloads/JWS strings are not shown.
- Billing route details remain in debug disclosure rather than primary UI.

## 8. Billing/product/API invariant result

Pass.

- Subscription sync path remains `/v1/ios/subscriptions/sync`.
- Consumable completion path remains `/v1/ios/purchases/credits/complete`.
- Compatibility paths remain referenced only where already supported.
- Product IDs remain:
  - `kabuyomi.credits.50`
  - `kabuyomi.credits.100`
  - `kabuyomi.sub.lite.monthly`
  - `kabuyomi.sub.pro.monthly`
  - `kabuyomi.sub.max.monthly`
- StoreKit purchase/restore/sync behavior was not changed in this review pass.
- Client-side credit grant behavior was not added.

## 9. Dirty-checkout screenshot limitation

Known limitation: before/after screenshot evidence for this UI polish work was captured from the current dirty checkout, not from a clean `HEAD` baseline. The screenshots prove the current working tree state, not a clean-branch visual delta.

## 10. Tests/commands run

- `git status --short`
  - Result: dirty working tree, no commit performed.
- `git diff --stat`
  - Result: reviewed.
- `git diff -- ios/Kabuyomi/App/AppModel.swift`
  - Result: reviewed; copy/status only.
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`
  - Result: passed, 140 tests.
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
- XcodeBuildMCP `build_run_sim` on iPhone 16
  - Result: passed.
- XcodeBuildMCP `build_run_sim` on iPhone 16e
  - Result: passed.
- `xcrun simctl ui ... content_size accessibility-large`
  - Result: Dynamic Type sweep completed.
- `xcrun simctl ui ... content_size large`
  - Result: content size restored.

## 11. releaseDecision

No-go for final release commit until the Dynamic Type chat composer overlap is fixed or explicitly accepted as a known limitation.

Semantic safety is green. Local iPhone 16 tests/build are green. Normal-size iPhone 16 and iPhone 16e visual sweeps are acceptable. The remaining blocker is the accessibility-large chat overlap.
