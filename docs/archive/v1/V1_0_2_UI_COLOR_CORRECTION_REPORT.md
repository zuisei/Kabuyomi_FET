# Kabuyomi v1.0.2 UI Color Correction Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Conclusion

The narrow color correction pass is complete. Kabuyomi's global visual tone has been restored toward the warmer, softer brand palette while preserving the useful v1.0.2 layout and readability improvements from the prior UI polish pass.

No Worker logic, SEC retrieval, model config, prompt policy, answer generation, source-selection behavior, billing behavior, StoreKit behavior, credit grants, subscriptions, product IDs, API endpoint paths, D1 migrations, or pricing were changed.

## 2. Color Direction Reverted Or Softened

- Restored the global `KabuyomiTheme` background, surface, accent, ink, stroke, shadow, and card-radius direction to the warmer committed palette instead of the colder gray research-terminal direction.
- Replaced harsh white/gray local surfaces in the company drawer, overview cards, assistant metric table, and source detail metric rows with warm theme fills and strokes.
- Softened black/gray border and shadow usage where it made cards feel generic or severe.
- Kept local contrast fixes only where they support readability, without using global neutral gray as the whole app identity.

## 3. Layout Improvements Preserved

- Filing overview information architecture remains in place.
- Compact major metrics table and comparison layout remain in place.
- Improved labels such as `サマリー`, `主要指標`, `改善項目`, and `確認論点` remain in place.
- Chat answer hierarchy remains flatter and answer-focused.
- Source chip wrapping and follow-up suggestion layout improvements remain in place.
- Drawer leak fix and company header tap-target improvements remain in place.
- Source detail metric formatting remains readable instead of exposing raw XBRL-style values.
- Credits screen structure remains split into balance, current plan, add credits, and purchase management.
- `kabuyomi.credits.50` remains the primary credit pack, and `kabuyomi.credits.100` remains available as a compatibility pack.
- Account Status sensitive-info protections remain in place.

## 4. Files Changed

Files touched by this color correction / safety pass:

- `ios/Kabuyomi/App/Theme.swift`
- `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/Kabuyomi/Features/Settings/SettingsView.swift`
- `docs/archive/v1/V1_0_2_UI_COLOR_CORRECTION_REPORT.md`

The repository still contains broader dirty v1.0.2 UI polish changes from earlier work. This pass was limited to restoring warm visual tone and redacting one settings debug device-key display.

## 5. Screenshots Captured

Captured after screenshots under:

`test-results/v1.0.2-ui-color-correction/`

- `home_drawer.jpg`
- `search.jpg`
- `settings.jpg`
- `credits_main.jpg`
- `filing_overview_top.jpg`
- `major_metrics_table.jpg`
- `improvement_confirmation_points.jpg`
- `chat_answer_with_sources_followups.jpg`
- `source_detail_sheet.jpg`
- `company_header_controls_closeup.jpg`

## 6. Tests Run

All simulator verification used iOS 26.x as required.

Successful commands:

```sh
xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' -parallel-testing-enabled NO -only-testing:KabuyomiTests
```

Result: passed, 140 tests, 0 failures on iPhone 17 Pro / iOS 26.4.1.

```sh
xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' CODE_SIGNING_ALLOWED=NO
```

Result: build succeeded on iPhone 17 Pro / iOS 26.4.1.

```sh
git diff --check
```

Result: passed.

Notes:

- Earlier full `xcodebuild test` attempts against iOS 26.4.1 hit Simulator preflight busy launch failures before the test bundle could run.
- After resetting/using the iOS 26.4.1 simulator through the iOS debugger flow, the app built and launched successfully.
- One full bundle run initially showed a single AppModel assertion failure, but the focused test passed immediately afterward and the full `KabuyomiTests` rerun passed 140/140. This looks like a transient test-order/timing issue rather than a color-correction regression.

## 7. Semantic Safety Result

Semantic safety passed for this pass:

- No backend or Worker files changed.
- No SEC retrieval code changed.
- No model config or prompt policy changed.
- No answer generation or source-selection semantics changed.
- No billing, StoreKit, subscription, credit grant, product ID, API endpoint, D1, or pricing logic changed.
- The full device key display in Settings debug UI was redacted to a suffix-only display. No full device key, token, transaction ID, or Apple signed payload is exposed by this correction.

## 8. Remaining Visual Risks

- Visual screenshots were captured on iPhone 17 Pro / iOS 26.4.1 simulator, not on a physical device or TestFlight build.
- A separate smallest-device iOS 26 sweep was not completed in this pass.
- Large Dynamic Type screenshots were not recaptured in this pass.
- Final TestFlight purchase smoke still has to verify real StoreKit sheets and App Store subscription management copy.

## 9. releaseDecision

Proceed to TestFlight visual and purchase smoke after human review of the captured screenshots. Do not push or deploy from this pass.
