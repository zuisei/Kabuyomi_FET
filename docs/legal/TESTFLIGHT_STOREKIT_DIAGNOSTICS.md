# TestFlight StoreKit Diagnostics

This note is for Kabuyomi v1.0.2 TestFlight troubleshooting when StoreKit returns no products for the expected monetization products:

- `kabuyomi.credits.50`: consumable, 50 paid credits, price truth JPY 100.
- `kabuyomi.credits.100`: existing compatibility consumable, 100 paid credits when App Store Connect returns it.
- `kabuyomi.sub.lite.monthly`: auto-renewable subscription, group `Kabuyomi_sus`, 400 credits/month, price truth JPY 640/month.
- `kabuyomi.sub.pro.monthly`: auto-renewable subscription, group `Kabuyomi_sus`, 900 credits/month, price truth JPY 1,280/month.
- `kabuyomi.sub.max.monthly`: auto-renewable subscription, group `Kabuyomi_sus`, 2,000 credits/month, price truth JPY 2,560/month.

The diagnostics are read-only. They do not expose the deferred 500 yen pack, environment switching, or any manual credit grant.

## How to Open

1. Install the latest TestFlight or Release build.
2. Open Kabuyomi.
3. Open Settings.
4. Find the `購入診断` section.
5. Tap `診断表示を更新` after opening the credit purchase screen or after retrying product load.

## Screenshots to Capture

Capture one screenshot that includes the full `購入診断` section after the product load attempt. The important fields are:

- `appVersion`
- `buildNumber`
- `bundleIdentifier`
- `requestedProductIds`
- `returnedProductCount`
- `returnedProductIds`
- `canMakePayments`
- `storefrontCountryCode`
- `storefrontId`
- `productLoadStatus`
- `productLoadStartedAt`
- `productLoadCompletedAt`
- `lastProductLoadError`
- `localStoreKitConfiguration`
- `purchaseButtonVisibilityReason`

Also capture the credit purchase UI showing whether the 50-credit pack, 100-credit compatibility pack, and Lite / Pro / Max subscription rows are available or correctly disabled with retry state.

## Logs to Filter

Use macOS Console or device logs and filter for:

```text
subsystem == app.kabuyomi.ios
category == subscription
mini_iap_
```

Relevant events:

- `mini_iap_can_make_payments_result`
- `mini_iap_storefront_loaded`
- `mini_iap_product_load_started`
- `mini_iap_product_load_success`
- `mini_iap_product_load_empty`
- `mini_iap_product_load_failed`
- `mini_iap_purchase_started`
- `mini_iap_purchase_succeeded`
- `mini_iap_purchase_failed`
- `mini_iap_backend_grant_started`
- `mini_iap_backend_grant_succeeded`
- `mini_iap_backend_grant_already_granted`
- `mini_iap_backend_grant_failed`
- `mini_iap_transaction_finished`

## Interpreting Common States

### `returnedProductCount: 0`

StoreKit completed the request but did not return the expected v1.0.2 product IDs. If the product IDs in `requestedProductIds` are correct, likely causes are outside the app binary:

- App Store Connect propagation delay.
- The TestFlight build is stale and does not contain the current bundle/configuration.
- The uploaded build is not tied to the expected App Store Connect app record.
- Provisioning/profile or entitlement mismatch.
- Sandbox account/storefront mismatch.
- Temporary Apple sandbox issue.

### `canMakePayments: false`

The device or account cannot make payments. Check:

- Screen Time / purchase restrictions.
- Sandbox Apple Account sign-in.
- Test device account state.
- Apple sandbox availability.

### Missing Storefront

`storefrontCountryCode: unknown` means StoreKit did not provide a storefront for this runtime at the time diagnostics were captured. Check:

- Sandbox account country/region.
- App Store account sign-in state.
- Network state.
- Whether the app was freshly installed after changing sandbox/account settings.

### `localStoreKitConfiguration: environment_present`

A local StoreKit configuration file appears to be active. That is useful for simulator development, but TestFlight diagnostics should normally show `not_detected`.

## App Store Connect Settings Already Checked

As of this diagnostics pass, the repo-side and App Store Connect checklist from the owner says:

- Paid Apps Agreement is active.
- Bank and tax setup are active.
- Bundle ID is `app.kabuyomi.ios`.
- In-App Purchase capability is enabled.
- IAP products exist for the intended v1.0.2 set.
- Product IDs include `kabuyomi.credits.50`, `kabuyomi.credits.100`, `kabuyomi.sub.lite.monthly`, `kabuyomi.sub.pro.monthly`, and `kabuyomi.sub.max.monthly`.
- Subscription group is `Kabuyomi_sus`.
- Product types are consumable for credit packs and auto-renewable subscription for Lite / Pro / Max.
- Price truth is JPY 100 for the 50-credit pack, JPY 640/month for Lite, JPY 1,280/month for Pro, and JPY 2,560/month for Max. The 100-credit compatibility product price should match App Store Connect if it is returned.
- Availability has been expanded.
- IAP is attached to the app version.
- IAP review screenshot exists.
- Sandbox Apple Account login was attempted.

Do not treat these as newly verified by code. Re-check App Store Connect if screenshots or logs contradict them.

## Next Steps After Capturing Evidence

1. Save the `購入診断` screenshot.
2. Save the `mini_iap_` log lines from launch through product load.
3. Confirm the `buildNumber` matches the uploaded TestFlight build.
4. Confirm `bundleIdentifier` is `app.kabuyomi.ios`.
5. Confirm `requestedProductIds` contains the intended v1.0.2 product set.
6. If `returnedProductCount` remains `0` with `canMakePayments: true`, wait for App Store Connect propagation, reinstall the build, and retry with a Japanese storefront sandbox account.
7. If the same result continues after propagation, open Apple Developer support / feedback with the screenshot, logs, bundle ID, product ID, build number, and App Store Connect product status.

## If Product Load and Purchase Succeed but Backend Grant Fails

If device logs show `mini_iap_product_load_success` and `mini_iap_purchase_succeeded`, but the backend returns:

```text
HTTP 503: Apple transaction verification is not configured
```

StoreKit is no longer the blocker. Configure the Worker App Store Server API values in [APPLE_STORE_SERVER_CONFIG.md](./APPLE_STORE_SERVER_CONFIG.md), then redeploy the Worker and retry the same TestFlight purchase/recovery path.

If Worker logs show `apple_transaction_verification_failed status=401 environment=production` while `APPLE_APP_STORE_SERVER_ENVIRONMENT=auto`, the Worker should attempt sandbox next for TestFlight compatibility. A successful TestFlight grant should then show:

```text
apple_transaction_verified environment=sandbox
credit_purchase_grant productId=kabuyomi.credits.50 delta=50
```

If both production and sandbox fail, no paid credits should be granted. Keep `auto` for production release; use `sandbox` only for isolated TestFlight verification.
