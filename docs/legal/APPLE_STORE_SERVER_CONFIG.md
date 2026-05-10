# Apple Store Server API Configuration

Kabuyomi v1.0.2 grants paid and subscription credits only after the Worker verifies the StoreKit transaction with Apple's App Store Server API. The iOS client payload and client JWS are not sufficient to grant credits.

## Required Worker Values

Set these in the deployed Worker environment:

| Name | Type | Source | Notes |
| --- | --- | --- | --- |
| `APPLE_APP_STORE_ISSUER_ID` | Wrangler secret | App Store Connect API issuer ID | From App Store Connect API access. |
| `APPLE_APP_STORE_KEY_ID` | Wrangler secret | App Store Connect API key ID | The key must have App Store Server API access for this app. |
| `APPLE_APP_STORE_PRIVATE_KEY` | Wrangler secret | Downloaded `.p8` private key contents | Store the full PEM text, including begin/end lines. Do not commit it. |
| `APPLE_BUNDLE_ID` | Wrangler var | App Store Connect app bundle ID | For v1 this is `app.kabuyomi.ios`. |
| `APPLE_APP_STORE_SERVER_ENVIRONMENT` | Wrangler var | Kabuyomi deployment choice | Use `auto` for production release. Use `sandbox` only for TestFlight-only verification. |

`workers/wrangler.toml` contains the non-secret defaults:

```toml
APPLE_BUNDLE_ID = "app.kabuyomi.ios"
APPLE_APP_STORE_SERVER_ENVIRONMENT = "auto"
```

The three credential values must be configured as Cloudflare secrets.

For the current v1 App Store Connect In-App Purchase key, the expected non-secret values are:

```text
APPLE_APP_STORE_ISSUER_ID=33b3d98d-ad68-4d93-874a-b9bc38db405d
APPLE_APP_STORE_KEY_ID=QT2X2QH4G6
APPLE_BUNDLE_ID=app.kabuyomi.ios
APPLE_APP_STORE_SERVER_ENVIRONMENT=auto
```

The matching private key is the `.p8` file downloaded from App Store Connect. Do not commit it or paste it into docs.

## Secret Commands

Run from `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
wrangler secret put APPLE_APP_STORE_ISSUER_ID
wrangler secret put APPLE_APP_STORE_KEY_ID
wrangler secret put APPLE_APP_STORE_PRIVATE_KEY
```

For the private key, paste the full `.p8` content. It should look like:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

Do not place the private key in `.dev.vars`, source files, docs, screenshots, or App Review notes.

## Runtime Behavior

The public iOS completion route is:

```text
POST /v1/ios/purchases/credits/complete
```

The route verifies the transaction with Apple before calling the paid-credit grant path. Subscription sync uses `POST /v1/ios/subscriptions/sync` and also requires Apple-verifiable transaction data before subscription credits are granted.

Expected behavior:

- Missing Apple config returns `503` with `Apple transaction verification is not configured`.
- Invalid or fake Apple transaction returns no grant.
- `kabuyomi.credits.50` grants exactly 50 paid credits only after Apple verification.
- `kabuyomi.credits.100` remains supported as an existing compatibility product when present and grants exactly 100 paid credits only after Apple verification.
- Lite / Pro / Max subscriptions grant server-authoritative monthly subscription credits only after Apple verification.
- Duplicate transaction IDs return `already_granted` and do not double grant.
- iOS finishes the StoreKit transaction only after backend grant or `already_granted`.

## Diagnosing `Apple transaction verification is not configured`

This means the Worker could not build the App Store Server API JWT, or Apple rejected the server credentials.

Check Worker logs for:

```text
apple_transaction_verification_config_missing
```

If present, the log lists missing names among:

- `APPLE_APP_STORE_ISSUER_ID`
- `APPLE_APP_STORE_KEY_ID`
- `APPLE_APP_STORE_PRIVATE_KEY`
- `APPLE_BUNDLE_ID`

If the missing-config log is absent but the public error is still `Apple transaction verification is not configured`, Apple likely returned `401`; re-check issuer ID, key ID, private key, key permissions, and bundle ID.

For Apple `401`, the Worker logs non-secret JWT context in `apple_transaction_verification_failed`:

- attempted environment
- key ID
- issuer ID prefix and short hash
- bundle ID
- JWT header `alg` / `kid` / `typ`
- JWT payload `aud` / `bid`
- ES256 signature byte length

The log must not contain the bearer token, full issuer ID, or private key.

A valid App Store Server API JWT for Kabuyomi should have:

- header: `alg=ES256`, `kid=QT2X2QH4G6`, `typ=JWT`
- payload: `iss=<issuer id>`, `aud=appstoreconnect-v1`, `bid=app.kabuyomi.ios`
- lifetime: `exp` within 20 minutes of `iat`
- signature: JOSE ES256 raw `r || s`, 64 bytes

If the Worker log shows the expected JWT shape but Apple still returns `401`, re-enter the three Wrangler secrets from the App Store Connect key screen and the matching `.p8` file. The most common remaining issue is pasting the wrong `.p8`, omitting the PEM begin/end lines, or using an API key that is not the same In-App Purchase key shown in App Store Connect.

## Environment Selection

Supported values:

- `sandbox`: calls only Apple's sandbox App Store Server API endpoint.
- `production`: calls only Apple's production App Store Server API endpoint.
- `auto`: calls production first, then falls back to sandbox only for transaction-not-found responses or the narrow TestFlight compatibility case where production returns `401` and sandbox can verify the transaction.

For TestFlight-only verification, `sandbox` is acceptable and can confirm the key, bundle ID, and transaction verification path.

For production release, use `auto`. Do not leave the production release Worker permanently set to `sandbox`, because real App Store purchases must be verified against Apple's production endpoint.

In `auto`, Kabuyomi never treats fallback itself as success. A paid-credit grant happens only if one Apple endpoint returns a valid `signedTransactionInfo` whose transaction ID, product ID, and bundle ID match the request. If production returns `401` and sandbox also fails, the Worker returns an authentication/configuration failure and grants nothing.

## Next TestFlight Verification

1. Deploy the Worker only after the three secrets are set.
2. Install the latest TestFlight build.
3. Purchase `kabuyomi.credits.50`.
4. Confirm logs include `apple_transaction_verified` with `environment=sandbox`.
5. Confirm the backend response is `granted` or `already_granted`.
6. Confirm `mini_iap_transaction_finished` appears after backend success.
7. Confirm `/v1/usage` shows `purchasedRemaining` increased by 50 once.
8. Repeat for `kabuyomi.credits.100` if App Store Connect returns the compatibility product.
9. Run a Lite subscription purchase/restore smoke and confirm `/v1/ios/subscriptions/sync` refreshes usage with 400 subscription credits and no duplicate grant on restore.
