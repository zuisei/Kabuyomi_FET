# Kabuyomi v1.0.2 UI Polish Report

## 1. Conclusion

The v1.0.2 monetization UI polish pass is implemented without changing billing grant semantics, Worker answer-quality logic, SEC retrieval, model config, prompt policy, filing router logic, or chat quality logic.

The Credits screen now keeps the main path compact, moves detailed plan/legal/debug information into sheets or disclosures, and preserves the safety invariant that the backend remains authoritative for credits, subscriptions, and purchase grants.

No production deploy and no push were performed in this pass.

## 2. Screens changed

- Settings > Credits
- Settings > Credits > Monthly plan sheet
- Settings > Credits > Account Status sheet
- Settings > Credits > Credit rules / legal info sheet
- Company chat composer insufficient-credit prompt

## 3. Credits screen changes

- Kept the main screen organized into:
  - balance card
  - current plan card
  - add credits card
  - purchase management card
- Balance card now shows the server-confirmed balance, active plan badge, next renewal/reset when provided, and last sync time when available.
- Current plan card now summarizes Free / Lite / Pro / Max and opens a focused plan sheet.
- The 50-credit pack remains the primary visible paid-credit pack.
- The 100-credit compatibility pack remains available behind the secondary “other packs” flow.
- Detailed plan comparison and credit rules were kept out of the main screen.

## 4. Account Status changes

- Account Status is split into a normal account section and a debug disclosure.
- Normal section shows server/runtime state only:
  - current plan
  - total credits
  - monthly/subscription credits if provided
  - paid credits if provided
  - ad/free credits if provided
  - next renewal/reset if provided
  - last usage refresh
  - last billing sync status
  - restore/sync action
- Debug disclosure shows:
  - API environment and base URL
  - app version/build
  - redacted device key suffix only
  - billing route health result
  - route-missing detail when available
- Full device keys, transaction IDs, tokens, and Apple signed payloads are not displayed.

## 5. Insufficient-credit UI changes

- The chat composer now shows clearer insufficient-credit copy when the current balance cannot cover a chat.
- The insufficient-credit action presents choices instead of opening purchase UI automatically:
  - add 50 credits
  - view monthly plans
  - cancel
- The message includes the required credits and current balance.
- No local credit grant path was added.

## 6. Purchase/sync error copy changes

- User-cancelled purchases show: “購入はキャンセルされました。”
- Pending purchases show: “購入は保留中です。App Store側の処理が完了すると反映されます。”
- Route-missing / 404 sync failures show the safe user copy and keep endpoint/status detail in debug builds and Account Status diagnostics.
- Apple/backend verification failures ask the user to restore purchases.
- Network failures ask the user to check the connection and restore purchases.
- Successful StoreKit transactions are still not treated as granted unless backend sync/grant confirms them.

## 7. Version/build changes

- `MARKETING_VERSION` is set to `1.0.2`.
- `CURRENT_PROJECT_VERSION` is set to `4`.
- Visible version/build display continues to use bundle metadata.
- Bundle ID was not changed.

## 8. Tests/commands run

- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - Result: passed.
- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`
  - Result: passed, 139 tests.
- Focused AppModel test run:
  - `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO -only-testing:KabuyomiTests/AppModelTests`
  - Result: passed, 62 tests.
- `cd workers && npm run typecheck`
  - Result: passed.
- `cd workers && npm test -- billing-catalog purchase billing quota subscription`
  - Result: passed, 46 tests.
- `cd workers && npm run dryrun:test`
  - Result: passed.
- `git diff --check`
  - Result: passed after this report was added.

## 9. Remaining TestFlight smoke

- Confirm TestFlight build shows version `1.0.2` and build `4`.
- Load Lite / Pro / Max StoreKit products.
- Buy Lite and confirm subscription sync, usage refresh, active Lite plan, and 400 monthly credits.
- Buy the 50-credit paid pack and confirm paid credits increase separately from subscription credits.
- Confirm the 100-credit compatibility pack remains buyable if visible in App Store Connect/TestFlight.
- Restore purchases and confirm repeated restore does not double grant credits.
- Exercise a cancelled purchase and confirm no backend grant.
- Exercise a temporary network/backend failure and confirm no local credit grant.
- Confirm Account Status debug section does not expose full device keys, transaction IDs, tokens, or signed Apple payloads.

## 10. releaseDecision

Local build/test readiness is green for this UI polish pass.

Release remains gated on the remaining TestFlight sandbox smoke above. Production Worker deploy was not performed in this pass.
