# Apple Account Recovery Configuration

Kabuyomi preserves verified-installation compatibility ownership while account recovery is disabled. New consumable sales require both `creditBillingEnabled=true` and `consumablePurchasesEnabled=true`; `accountRecoveryReady` separately upgrades ownership to a recoverable Apple account. Core filing reading and questions remain anonymous and do not require login. The implementation uses Sign in with Apple only as verified purchase-recovery proof; the Worker stores an HMAC-derived principal and subject digest, never Apple's raw `sub` or identity token.

## Required external configuration

1. Enable **Sign in with Apple** for App ID `app.kabuyomi.ios` in the Apple Developer portal and regenerate the development, Ad Hoc, and App Store provisioning profiles.
2. Apply D1 migrations `0014_account_recovery.sql` and `0015_installation_principal_migration.sql` to the test environment before deploying code that enables account recovery.
3. Configure independent, high-entropy Worker secrets:

```bash
wrangler secret put ACCOUNT_PRINCIPAL_HMAC_KEY_V1 --config wrangler.test.toml
wrangler secret put ACCOUNT_SESSION_HMAC_KEY_V1 --config wrangler.test.toml
```

After the complete test gate passes, provision different values in production with the same commands without `--config wrangler.test.toml`; do not copy test secrets into production.

Generate each value independently (for example, 48 random bytes). Never rotate the principal key without a versioned migration because it defines durable account ownership. A session-key rotation invalidates existing local sessions and requires users to sign in again, but must not delete account balances.

`APPLE_SIGN_IN_CLIENT_ID` is optional for the native app and falls back to `APPLE_BUNDLE_ID=app.kabuyomi.ios`. Configure it explicitly if a separate Services ID is later introduced.

## Safe activation order

1. Keep `accountRecoveryReady=false` and preserve the current trusted value of `consumablePurchasesEnabled`; do not remove the released purchase surface merely to stage account recovery.
2. Apply migrations `0014` and `0015` to test D1 and deploy the test Worker.
3. Validate on two physical devices: the same Apple user must produce one account, one `appAccountToken`, and one shared balance; a different Apple user must not see that balance.
4. Run the paid-credit migration in preview and apply modes using a test account with known transaction history. Repeat it to confirm `already_applied` and confirm the legacy principal cannot mutate after tombstoning.
5. Verify a StoreKit sandbox purchase carries the server-issued `appAccountToken`, and verify a mismatched transaction is rejected without credit.
6. Verify sign-out clears only the local session, sign-in on a replacement device restores the server balance, and no raw identity token or Apple subject appears in logs.
7. Implement and verify an in-app account-deletion path, including server-side unlink/deletion semantics and legally required purchase/ledger retention, or record an App Review determination that this recovery binding does not create an account. Sign-out alone does not close this gate.
8. After the complete real-device, StoreKit, and App Review account-deletion gate passes, enable `accountRecoveryReady`. Leave `consumablePurchasesEnabled` unchanged unless an actual purchase-safety incident requires the emergency switch.

No step in this repository change applies remote migrations, deploys a Worker, changes Apple capabilities, or mutates either production flag.

## Disable and recovery

Set `consumablePurchasesEnabled=false` immediately to stop new sales while preserving account sessions, transaction evidence, and balances. If account authentication is impaired, also set `accountRecoveryReady=false`; do not delete principals, migration rows, purchase records, or Durable Object state. Repair forward and re-enable only after the two-device gate passes again.
