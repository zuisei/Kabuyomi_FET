# Kabuyomi v1.0.2 UI Verification Report

## 1. Conclusion

The v1.0.2 monetization UI verification pass is complete for static code review, automated build/test gates, and a limited iPhone 16 simulator UI hierarchy check.

No billing grant semantics, Worker answer-quality logic, SEC retrieval, model config, prompt policy, filing router logic, or chat quality logic were changed. No new products were added. No production deploy and no push were performed.

Release readiness is good for TestFlight StoreKit smoke, with remaining human checks focused on real App Store product metadata, purchase sheets, and sandbox account flows.

## 2. Screens inspected

- Settings > Credits main screen
- Monthly plan comparison sheet
- Add credits flow
- More packs flow by static inspection
- Account Status sheet by static inspection
- Credit rules / legal info sheet by static inspection
- Company chat composer insufficient-credit prompt by static inspection
- Entry/company simulator UI hierarchy used to reach Credits

## 3. Issues found

- The Add credits missing-product state had an error message but no local retry button, while the subscription plan sheet already had a retry path.
- Plan and credit-pack rows used side-by-side summary/action layout even for accessibility Dynamic Type sizes, which could crowd long Japanese strings.
- Account Status normal rows were understandable but still too developer-English-heavy for a normal user-facing section.
- A manual simulator tap on the purchase management area can invoke the App Store account sign-in sheet when Restore is tapped, which is expected for StoreKit restore but still needs human sandbox review.

No issue was found that would imply client-side credit grants or accidental backend trust widening.

## 4. Fixes implemented

- Added a retry button to the Add credits missing-product state.
- Made monthly plan rows stack vertically at accessibility Dynamic Type sizes.
- Made credit-pack rows stack vertically at accessibility Dynamic Type sizes.
- Added multiline/scale handling to Account Status metric values.
- Localized Account Status normal row labels:
  - current plan
  - total credits
  - monthly/free bucket
  - paid credits
  - ad/free credits
  - next renewal/reset
  - last usage refresh
  - last billing sync
- Clarified a purchase error mapping condition with parentheses without changing behavior.

## 5. App Review subscription clarity result

Pass by static inspection and simulator hierarchy for the plan sheet.

The plan sheet clearly shows:

- Lite / Pro / Max
- monthly credit amounts
- localized StoreKit price slot
- monthly auto-renewal wording
- current plan state when applicable
- purchase/change button state
- restore/sync action
- App Store account management/cancellation wording

No external purchase links were found in the monetization UI. No investment-advice, guaranteed-return, target-price, buy/sell recommendation, or stock-prediction wording was found in the monetization UI.

Risky-copy search hits were either legal disclaimers, chat safety logic/tests, or non-UI quality fixtures. Legitimate filing/business terms such as revenue and share repurchase were not treated as monetization UI issues.

## 6. Insufficient-credit UI result

Pass by static inspection and tests.

The insufficient-credit flow shows:

- required credits for the attempted chat
- current credits
- explicit choices to add 50 credits, view monthly plans, or cancel

The purchase sheet does not open automatically. No client-side credit grant path was added. Purchase/restore paths still refresh usage from the backend after successful sync/grant.

## 7. Account Status / debug exposure result

Pass by static inspection and tests.

Normal Account Status shows only server/runtime state. Debug details are inside a disclosure. The debug area uses only:

- API environment/base URL
- app version/build
- redacted device key suffix
- route health summary
- route-missing detail when present

The UI does not display full device keys, full transaction IDs, tokens, Apple signed transaction payloads, or raw secrets.

## 8. Accessibility / layout result

Pass for static layout review and limited iPhone 16 simulator hierarchy.

Verified:

- Credits main screen remains sectioned, not a wall of product/legal/debug text.
- Credits screen scrolls; lower management and debug/reward sections are reachable in the hierarchy.
- Plan sheet rows fit in the iPhone 16 hierarchy.
- Missing StoreKit product states are disabled and show retry paths.
- Large/accessibility Dynamic Type row crowding was reduced by stacking plan and pack rows.

Remaining human visual checks:

- iPhone SE / smallest supported device
- Dynamic Type accessibility sizes rendered in Simulator or on device
- light/dark mode visual contrast if both are supported by the app
- real localized StoreKit prices in TestFlight

## 9. Rewarded ad visibility result

Pass for release/TestFlight path by static inspection.

Superseded by the later 2026-05-10 product decision: rewarded-credit UI is now release-visible in v1.0.2 when required AdMob rewarded config is present. The earlier DEBUG-only/static hidden result is retained as historical context only.

No SEC Form Router, filing retrieval, or answer-quality functionality was added.

## 10. Version/build result

Pass.

- `MARKETING_VERSION` is `1.0.2`.
- `CURRENT_PROJECT_VERSION` is `4`.
- Bundle ID remains `app.kabuyomi.ios`.
- Visible app version/build display continues to use bundle metadata.

## 11. Tests/commands run

- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`
  - Result: passed, 139 tests.
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
- `cd workers && npm run typecheck`
  - Result: passed.
- `cd workers && npm test -- billing-catalog purchase billing quota subscription`
  - Result: passed, 46 tests.
- `cd workers && npm run dryrun:test`
  - Result: passed.
- XcodeBuildMCP `build_run_sim`
  - Result: passed, app launched on iPhone 16 simulator.
- XcodeBuildMCP UI hierarchy snapshots
  - Result: reached entry, company screen, Credits screen, and monthly plan sheet.
- `git diff --check`
  - Result: passed after this report was added.

## 12. Remaining human visual checks

- TestFlight StoreKit product loading for Lite / Pro / Max.
- TestFlight product loading for `kabuyomi.credits.50` and `kabuyomi.credits.100`.
- TestFlight real localized prices and App Store purchase sheet text.
- Subscription purchase, restore, duplicate restore, and cancel flows with a sandbox Apple Account.
- Consumable purchase for 50 credits and compatibility purchase for 100 credits if visible.
- iPhone SE / small-screen manual visual pass.
- Accessibility Dynamic Type manual visual pass.
- Account Status debug disclosure on a real TestFlight build to confirm no sensitive values are exposed.

## 13. releaseDecision

Local verification gate is green.

Proceed to TestFlight StoreKit smoke. Do not mark v1.0.2 ready for release until real sandbox product loading, purchase, restore, duplicate restore, and consumable grant flows are verified.
