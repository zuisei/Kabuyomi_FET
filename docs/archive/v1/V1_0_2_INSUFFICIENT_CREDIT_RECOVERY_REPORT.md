# v1.0.2 Insufficient Credit Recovery Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Executive summary

Kabuyomi now opens a concrete recovery flow when a chat cannot be sent because credits are insufficient. The flow keeps the draft question and current company context intact, then offers optional rewarded ads, the primary `kabuyomi.credits.50` credit pack, subscription plans, and purchase restore.

No Worker code, filing retrieval logic, answer-quality logic, model config, StoreKit safety, AdMob SSV safety, credit ledger safety, or reward grant amounts/caps were changed.

## User-facing behavior

When the user does not have enough credits for a chat, the app opens Credits in an insufficient-credit recovery mode instead of only showing a weak alert.

The recovery card shows:

- `クレジットが不足しています`
- The required credit count for the attempted question.
- Optional rewarded ad recovery for `無料/ad credit`.
- `50 creditsを購入`.
- `サブスクを見る`.
- `購入を復元`.
- A success state: `送信できます。元の画面で質問をもう一度送信してください。`

The app does not auto-send the preserved draft after recovery. The user returns to the original company/chat context and taps send again.

## Trigger points implemented

Implemented:

- Local chat preflight: if loaded usage shows `totalRemaining < chatCreditCost`, `AppModel.sendChat` creates an insufficient-credit recovery request before starting the network send.
- Composer action: when the user taps the send arrow with insufficient credits, `ComposerBar` opens the recovery path instead of doing nothing behind a disabled send button.
- Server response: if `/v1/chat` returns `402` with `insufficient_credits`, `AppModel.sendChat` opens the same recovery state using the server-provided required/remaining counts.

## Files changed

- `ios/Kabuyomi/App/AppModel.swift`
  - Added `InsufficientCreditRecoveryState`.
  - Added recovery request state and request/clear methods.
  - Routes local insufficient-credit preflight and server `APIError.insufficientCredits` into recovery state.
  - Keeps existing rewarded-ad return destination behavior.

- `ios/Kabuyomi/Features/Company/CompanyComposer.swift`
  - Allows the send arrow to open recovery when the draft is non-empty but credits are insufficient.
  - Keeps normal send behavior when credits are sufficient.

- `ios/Kabuyomi/Features/Company/CompanyView.swift`
  - Replaces the previous insufficient-credit confirmation dialog with the Credits recovery flow.
  - Observes recovery requests from `AppModel`.
  - Opens `CreditView` with `.insufficientCredits(requiredCredits:)`.

- `ios/Kabuyomi/Features/Settings/CreditView.swift`
  - Adds insufficient-credit recovery mode.
  - Adds recovery CTAs for optional rewarded ads, primary 50-credit pack, subscription plans, and restore purchases.
  - Shows a sufficient-credit message after usage reflects recovery.

- `ios/KabuyomiTests/AppModelTests.swift`
  - Adds/updates tests for local preflight, composer recovery request, server insufficient-credit response, sufficient-credit recovery state, and closing recovery state.

Existing uncommitted rewarded-ad return navigation files remain part of the current working tree and were preserved:

- `ios/Kabuyomi/App/AppRootView.swift`
- `ios/Kabuyomi/Services/RewardedAdService.swift`

## Recovery UI behavior

The recovery UI is hosted inside the existing Credits full-screen flow for visual consistency with v1.0.2 Credits / Account Status.

Recovery mode appears above the normal balance, credit pack, purchase management, and optional rewarded-ad sections. This keeps the recovery actions immediate while still preserving the full Credits screen.

The close button dismisses the recovery flow and clears the recovery request without clearing the draft question.

## Rewarded ad integration

The recovery card uses the existing rewarded-ad flow:

- It calls `prepareRewardedAdReturnDestination(.credits, visibleSurface: "insufficient_credit_recovery")`.
- It calls the existing rewarded-ad button logging.
- It calls `earnRewardedAdCredits()`.

The implementation does not duplicate reward logic, does not grant credits locally, does not bypass AdMob SSV, and does not change the +2 reward amount or 3/day cap.

Existing rewarded-ad states remain visible:

- Loading/presenting.
- Pending SSV.
- Granted message.
- Daily cap reached.
- Dismissed/unavailable/failure messages.

The rewarded-ad return navigation fix is preserved, so ad scene transitions should return to Credits rather than forcing Home.

## Purchase/subscription integration

The recovery card uses existing StoreKit/backend paths:

- `50 creditsを購入` calls `purchaseCreditPack(productId:)` with the primary `kabuyomi.credits.50` product when available.
- `サブスクを見る` opens the existing subscription plan sheet.
- `購入を復元` calls `restorePurchases()`.

Credit grants still depend on StoreKit purchase/restore plus backend verification. The app does not grant paid credits from a client transaction alone, and `kabuyomi.credits.100` compatibility remains in the regular Credits screen.

## Draft/context preservation

Draft and context are preserved by the existing `CompanyView.submitQuestion` behavior:

- The draft is only cleared while a send attempt is in progress.
- If send returns `false`, the original prompt is restored when the composer is empty.
- Local insufficient-credit preflight returns before the draft is cleared.
- Server insufficient-credit response returns `false`, causing the original prompt to be restored.
- `currentTicker` / company context is not reset.
- No Home navigation was added.

## Tests added/updated

Updated:

- `testSendChatBlocksLocallyWhenCreditBalanceIsZero`

Added:

- `testRequestCreditOptionsOpensRecoveryStateFromComposer`
- `testSendChatServerInsufficientCreditsOpensRecoveryState`
- `testInsufficientCreditRecoveryTracksWhenCreditsBecomeSufficient`
- `testClosingInsufficientCreditRecoveryClearsRecoveryState`

Existing rewarded-ad tests remain in place, including tests proving the ad callback alone does not locally grant credits.

## Validation results

Commands run:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/ios
xcodegen generate
xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO
xcodebuild build -project Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO
cd /Users/0xt4/t4dano/Kabuyomi
git diff --check
```

Results:

- `xcodegen generate`: passed.
- `xcodebuild test`: passed, 150 tests executed, 0 failures.
- `xcodebuild build`: passed.
- `git diff --check`: passed.

Worker validation was not run because no Worker files were changed.

## Remaining manual smoke steps

1. Open a TestFlight/release build with a device/account whose total credits are below 2.
2. Open a company conversation and type a draft question.
3. Tap send.
4. Confirm the draft remains intact and the company/ticker context does not change.
5. Confirm Credits opens with `クレジットが不足しています`.
6. Confirm the recovery card shows the required credit count.
7. Confirm rewarded ad is optional and says `無料/ad credit`, not paid credit.
8. Tap rewarded ad, complete/pending/dismiss/cap flows, and confirm the app stays in or returns to Credits.
9. After a verified grant, confirm usage reflects +2 ad/free credits and paid credits are unchanged.
10. Close Credits and confirm the original draft can be sent manually.
11. Repeat with `50 creditsを購入`; confirm StoreKit + backend verification is required and usage refreshes.
12. Repeat with `サブスクを見る`; confirm Lite / Pro / Max appear or the existing safe fallback is shown.
13. Repeat with `購入を復元`; confirm restore/sync runs without exposing sensitive values.
14. Trigger server-side insufficient credits, if possible, and confirm the same recovery flow appears.

## Scope confirmation

Confirmed:

- No `v1.2-sec-form-router` branch was created.
- No SEC Form Router work was added.
- No 20-F / 6-K / 8-K support was added.
- No Worker filing retrieval code was changed.
- No Worker answer-quality logic was changed.
- No model config was changed.
- No Worker files were changed.
- No StoreKit, AdMob SSV, or credit ledger safety was weakened.
- No reward amount or daily cap was changed.
- Company UI polish was not removed or reverted.
- No push, merge, or production deploy was performed.
