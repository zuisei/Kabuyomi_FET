# PR-12 Paid Credit Account Recovery Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion

Stable paid-credit account recovery is implemented locally and remains disabled until externally verified. Sign in with Apple identity tokens are verified by the Worker; Apple subjects become versioned HMAC principals; one deterministic UUID `appAccountToken` is bound to StoreKit purchases; signed account sessions select the shared quota principal; and the one-time verified-installation migration preserves the exact balance buckets plus purchase and ledger evidence. The released consumable UI remains available in verified-installation compatibility mode; `accountRecoveryReady` upgrades ownership without becoming a visibility prerequisite. External Apple, D1, physical-device, and StoreKit validation is still required, so release remains HOLD.

## 2. Audit-claim verification table

| Claim | Local result | Remaining evidence |
|---|---|---|
| Stable account principal | Closed in code/tests | Real Apple identity token on test deployment |
| Apple token verification | Closed in code/tests | Apple JWKS/network canary |
| No raw Apple subject at rest | Closed in code/tests | Deployed log/data inspection |
| Persist and pass `appAccountToken` | Closed in code/tests | StoreKit sandbox transaction inspection |
| Reject mismatched transaction token | Closed in code/tests | Sandbox negative canary |
| Credit and spend through account | Closed in code/tests | Physical device A/B shared-balance test |
| One-time legacy migration | Closed in code/tests | Test-D1 preview/apply/repeat dry run |
| Lost-device recovery and sign-out safety | Closed in local flow/tests | Replacement physical-device exercise |

## 3. Implementation summary

- Added Apple identity JWT verification against Apple JWKS with issuer, audience, expiry, algorithm, key, and signature checks.
- Added independent versioned HMAC account principals, hashed subject storage, stable RFC 4122 `appAccountToken`, opaque signed sessions, and verified-installation bindings.
- Made the account principal the quota/read/spend identity while retaining a verified subscription's plan context.
- Required the same `appAccountToken` in Apple-verified consumable transactions before granting to the account.
- Added Sign in with Apple UI and entitlement, Keychain session persistence, local-only sign-out, preview/apply migration, and StoreKit purchase options.
- Kept account recovery independently disabled while preserving released product purchase actions under the consumable capability; once recovery is enabled, product actions require a signed-in recoverable account.

## 4. Files changed

Core files include `0014_account_recovery.sql`, `account-recovery.ts`, the account routes, quota selection, Apple transaction verification, Worker contracts/env, `DeviceIdentityStore.swift`, `APIClient.swift`, `APIModels.swift`, `SubscriptionStore.swift`, `AppModel.swift`, `CreditView.swift`, project entitlements, and their tests.

## 5. Schema and migration changes

Migration `0014` adds `account_principals`, `account_device_bindings`, and `paid_credit_account_migrations`. Raw Apple subjects, raw identity tokens, and raw installation principals are not schema fields. Migration IDs and legacy-principal digests are unique, applied migrations short-circuit as `already_applied`, conflicting claims fail, and a positive purchased balance without transaction evidence fails closed.

PR-06 first transfers any raw legacy-device state into the authenticated installation principal. PR-12 then transfers that verified installation's exact credit state, purchase records, monthly-grant evidence, and credit-operation ledger into the account, refuses an occupied target, and tombstones the installation source after a successful apply. A new device with no paid balance or purchase evidence is a migration no-op and simply uses the existing account. No remote migration was executed.

## 6. State-machine or data-flow changes

Verified installation + App Attest -> Apple identity-token verification -> HMAC account/session issuance -> local Keychain session -> preview legacy paid state -> apply once or no-op -> account quota identity -> StoreKit purchase with stable `appAccountToken` -> Apple server verification and token match -> idempotent paid-credit grant -> shared read/spend on signed-in devices.

Sign-out deletes only the local session. It sends no server deletion and does not mutate account balance, purchase evidence, or migration state.

## 7. Tests added or updated

Worker coverage proves two verified installations with one Apple subject map to one account/token, sessions round-trip and reject tampering, the account becomes the quota identity, only paid state is selected for migration, and Apple transaction-token mismatches are rejected. Existing Durable Object tests prove migration apply-once, occupied-target conflict, and legacy tombstoning. iOS tests prove session persistence, account/legacy headers on migration, and local-only sign-out followed by installation usage refresh.

## 8. Commands run and exact results

- Worker typecheck: PASS.
- Worker full suite: PASS, 63/63 files and 814/814 tests.
- Focused iOS account tests: PASS, 2/2.
- iOS Debug simulator build with the account UI and entitlement: PASS.
- Full iOS suite and unsigned Release rebuild are recorded in the final PR-14 report after the consolidated gate rerun.

## 9. Security and privacy review

Apple `sub` is transformed before persistence; account and installation values in logs are hashed; identity/session tokens, JWS values, assertions, and raw subjects are not logged. Account and session HMAC keys are independent. The principal key is rotation-sensitive and must not be changed without a versioned ownership migration.

## 10. Backward-compatibility review

Existing paid balances remain usable through the installation principal while account recovery flags are off. Existing unfinished transactions still use the verified completion path. When enabled, new sales require account sign-in, but sign-out does not delete the account or its purchased balance. The legacy migration is additive and rejects ambiguous/double ownership.

## 11. Unresolved risks

- Migration `0014`, Worker secrets, and Apple capability/provisioning are not configured remotely.
- Apple identity/JWKS, StoreKit sandbox `appAccountToken`, two-device balance sharing, and lost-device recovery have no physical-device evidence.
- The account principal and session key rotation procedures have not been rehearsed.

## 12. Rollback or disable procedure

Keep or set `consumablePurchasesEnabled=false`; if necessary also set `accountRecoveryReady=false`. Preserve account, purchase, and migration state. Do not rotate the principal key, delete mappings, or reverse balances. Repair forward, repeat the preview and two-device gate, then re-enable.

## 13. releaseDecision

`releaseDecision: HOLD`
