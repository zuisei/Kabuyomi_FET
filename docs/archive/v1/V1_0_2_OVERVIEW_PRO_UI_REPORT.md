# Kabuyomi v1.0.2 Overview Pro UI Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Conclusion

The Company chat UI polish pass is complete for the v1.0.2 monetization release branch.

This pass stayed inside SwiftUI presentation. No chat backend behavior, answer generation, source selection, billing/credit behavior, SEC retrieval, Worker logic, model config, or prompt policy was changed. No production deploy and no push were performed.

## Chat UI refinements

### Header

- Reduced the visual weight of the company chat header.
- Kept ticker, company name, refresh/menu actions, and close/action controls reachable.
- Tightened toolbar spacing, button sizes, and glass emphasis so the answer area becomes the primary focus.

### Filing context strip

- Changed the session context card to a compact research-oriented "根拠資料" row.
- Shows the selected filing as a concise `form type + filed date` summary.
- Shortened prompt chips and stacked them vertically to avoid horizontal clipping.

### User and assistant messages

- Reduced user bubble width, padding, and emphasis.
- Removed the extra user avatar so the user's question no longer visually competes with the answer.
- Flattened assistant answer cards by reducing nested card styling, shadow, padding, and large caveat treatments.
- Converted caveats into compact inline callout rows.

### Numeric answer formatting

- Added a presentation-only metric table for answers that already contain multiple financial metrics.
- The table extracts only values already present in the displayed answer text.
- No values are invented client-side, and no answer-generation behavior was changed.

### Follow-up suggestions

- Replaced horizontally scrolling suggestion cards with compact vertical chips.
- Shortened common follow-up labels:
  - `売上成長の要因は？`
  - `利益率は改善した？`
  - `前回との差は？`
- Verified that suggestions are no longer horizontally clipped in the iPhone 16 simulator viewport.

### Source chips

- Replaced the horizontal source rail with wrapping compact chips.
- Shows the top source chips inline and puts overflow behind `すべての根拠を見る`.
- Added presentation-only source label cleanup for common financial labels such as:
  - `売上高`
  - `営業利益`
  - `純利益`
- This is label presentation only; source selection and backend grounding are unchanged.

### Composer

- Made the composer slightly more compact.
- Preserved the concrete placeholder and credit-cost display.
- Preserved insufficient-credit behavior and did not auto-open purchase UI.

## Screenshots

Captured under ignored local evidence directory:

- `test-results/v1.0.2-chat-ui/chat_top_after_refinement.png`
- `test-results/v1.0.2-chat-ui/chat_answer_with_caveat.png`
- `test-results/v1.0.2-chat-ui/chat_sources_collapsed_or_compact.png`
- `test-results/v1.0.2-chat-ui/chat_followup_suggestions.png`
- `test-results/v1.0.2-chat-ui/chat_composer_credit_cost.png`

The current representative iPhone 16 screenshot includes the compact header, selected filing strip, user bubble, assistant answer, compact source chips, vertical follow-up suggestions, and composer credit-cost line in one viewport.

## Verification

Commands run:

- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`
  - Result: passed, 140 tests.
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
- XcodeBuildMCP `build_run_sim`
  - Result: passed, app launched on iPhone 16 simulator.
- iPhone 16 simulator screenshot capture
  - Result: completed.
- `git diff --check`
  - Result: passed before this report was added.

## Remaining concerns

- iPhone SE / smallest supported device visual pass remains manual.
- Dynamic Type accessibility-size visual pass remains manual.
- Light/dark mode visual contrast remains manual if both modes are supported.
- The captured answer did not naturally contain 2+ financial metrics, so the metric table was verified by unit test rather than by live screenshot.
- TestFlight StoreKit smoke remains separate from this chat UI polish pass.

## releaseDecision

Local chat UI build/test verification is green.

Proceed to TestFlight StoreKit smoke after a human visual pass on iPhone SE and Dynamic Type, if time allows. This change is release-appropriate as a narrow presentation polish pass and does not alter backend, billing, or SEC retrieval behavior.
