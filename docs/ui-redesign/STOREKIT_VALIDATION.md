# StoreKit validation

Date: 2026-07-14

## Safe test boundary

`KabuyomiTest.storekit` is a local Xcode StoreKit configuration containing the five unchanged production product identifiers. Its prices are test placeholders and are never used as production prices. The configuration is copied only into unit/UI test bundles and is explicitly excluded from the application target.

The Debug-only purchase-sheet harness calls the existing `SubscriptionStore.purchaseSubscription` handler. It never calls Kabuyomi's backend, never grants credits, and is removed by `#if DEBUG` from Release. Release bundle inspection confirmed that neither the harness strings nor a `.storekit` file are present.

## Scenarios

| Scenario | Result | Evidence |
|---|---|---|
| Product catalog, IDs, quantities, localized metadata | PASS | `StoreKitEndToEndTests.testProductionCatalogLoadsFromLocalStoreKitConfiguration` |
| Verified subscription purchase and restore through `AppStore.sync` | PASS | `StoreKitEndToEndTests.testSubscriptionPurchaseAndRestoreUseVerifiedStoreKitTransactions` |
| Verified consumable remains unfinished until the server-grant boundary finishes it | PASS | `StoreKitEndToEndTests.testConsumablePurchaseRemainsUnfinishedUntilServerGrantFinishesIt` |
| Ask to Buy maps to pending without grant or finish | PASS | `StoreKitEndToEndTests.testAskToBuyMapsToPendingWithoutGrantingOrFinishing` |
| Xcode purchase sheet: user cancellation returns `nil`/cancelled, never success | PASS | `StoreKitCancellationUITests.testCancellingStoreKitSheetReturnsCancelledWithoutSuccess` |
| Xcode purchase sheet: verified success returns a transaction | PASS | `StoreKitCancellationUITests.testCompletingStoreKitSheetReturnsVerifiedSuccess` |

Result bundles:

- `artifacts/ui-redesign-2026-07-14/results/storekit-e2e.xcresult` — 4 passed, 0 failed.
- `artifacts/ui-redesign-2026-07-14/results/storekit-purchase-sheet-ui.xcresult` — 2 passed, 0 failed.

No production purchase, sandbox account charge, production backend grant, or destructive API write was performed.
