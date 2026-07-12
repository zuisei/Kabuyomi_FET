# Feature Parity and Compatibility Contract

Status: authoritative companion to `CURRENT_SHIPPING_TRUTH.md`

As of: 2026-07-12 JST

## Outcome

The remediation preserves the existing core SEC-reading product and existing credit liabilities while changing the security authority around identity, model metering, billing grants, remote configuration, and legacy clients. No capability is treated as production-available solely because its code or test exists.

## Compatibility matrix

| Surface | Existing user continuity | Candidate authority and boundary | Current exposure |
|---|---|---|---|
| Search/company/filings | Preserved | Public search plus authenticated or expiring legacy-bridge company routes; SEC cache/read paths remain available | Production core available |
| Watchlist and recent | Existing local history and saved companies preserved | Server quota remains authoritative; drawer has one dedicated Search route and explicit empty Recent state | Production server core available; corrected iOS client validated but not yet App Store-shipped |
| Chat | Existing questions continue to cost 2 credits | Request fingerprint + atomic reservation + immutable replay; every non-`dev_unlimited` caller is metered regardless of StoreKit flags | Hardened production path deployed |
| Quote translation | Preserved at 1 credit | Same metering and replay boundary as chat; no billing-flag free path | Hardened production path deployed |
| Existing paid balances | Preserved | Durable Object balance and ledger remain server authority | Spendable |
| Welcome grant | No recurring Free grant | Exactly 50 once, only after verified App Attest; arbitrary device-key rotation cannot grant | Disabled without real attestation |
| New consumable purchase | Product IDs preserved | Requires complete trusted config, Apple transaction verification, idempotent grant, and no paid-grant emergency disable | Disabled |
| Subscription purchase/restore | Lite/Pro/Max catalog preserved | Requires complete trusted config and Apple verification; client state is never authority | Disabled pending external validation |
| Existing subscription state | No blind client grant | Stable HMAC principal, period identity, read-time expiry, terminal revocation, and dedupe | Server state preserved; externally unverified candidate transitions stay disabled |
| Account recovery | No claim of cross-device recovery before proof | Sign in with Apple principal, account session, matching `appAccountToken`, audited migration | Disabled |
| Rewarded ads | Existing code preserved | UI requires ads + reward + SSV readiness, production ad unit/environment, App Attest, and no emergency disable; SSV is sole grant authority | Disabled |
| App Store notifications | Endpoint implementation preserved | Verified JWS/certificate/bundle/environment, notification UUID dedupe, per-entitlement ordering | Disabled/unverified externally |
| Legal pages | Routes and local July content preserved | Live Pages revision/hash must match local validated source | Live revision and all five hashes match |

## Shipped-client bridge

The current released iOS client still presents a UUID `x-device-key`. Removing that path immediately would strand core users, so production uses a narrow bridge expiring at `2026-08-11T14:14:00.000Z`.

The bridge permits only:

- usage;
- company read and refresh;
- watchlist add and remove;
- metered chat;
- metered quote translation.

It never permits:

- welcome or monthly grant;
- consumable, subscription, or rewarded grant;
- Sign in with Apple session/recovery;
- internal evaluation or migration grant;
- arbitrary non-UUID device keys;
- test or mixed-environment activation;
- operation beyond the reviewed fixed expiry.

The compatibility principal remains `free:device:sha256(...)`, allowing the later one-time migration into a server installation principal. New `legacy_chat` reservations are rejected defense-in-depth; an already-completed historical replay remains readable.

## Identity compatibility

New release clients use a server-issued token and opaque installation principal in Keychain. The token is bound to its reference and principal, expires after 90 days, rotates after 14 days, and is rejected after revocation. A rejected credential is cleared and bootstrapped once; local content is not erased.

Unsupported App Attest is a safe degraded mode, not an identity grant. It can use core reads and public search but receives zero welcome credit. Pending or failed attestation cannot reach reward, purchase, subscription, account, internal-grant, or migration-grant paths.

Test automation is secret-backed, requires the exact dual test environment, and cannot be enabled in production by setting only one environment variable.

## Credit compatibility

The shared catalog is authoritative:

- Free: 0 monthly, 3 saved, 25 daily fair-use;
- Lite: 400 monthly, 3 saved, 10 daily fair-use;
- Pro: 900 monthly, 20 saved, 50 daily fair-use;
- Max: 2,000 monthly, 20 saved, 50 daily fair-use;
- welcome: 50 once after verified installation;
- rewarded: 2 per SSV, 3 per JST day, 30-day expiry;
- normal chat: 2;
- quote translation: 1.

Disabling StoreKit purchasing does not disable credit metering. Existing balances remain usable. Refund debt is settled before a later purchase becomes spendable, and a refund reversal restores only the amounts removed or settled by that refund.

## Remote-config compatibility

A deployed Worker accepts only a complete typed envelope with authored `updatedAt`, bounded 45-day lifetime, compatible catalog numbers, and an explicit `legacyClientCompatibility` object. Missing or malformed capability fields do not inherit permissive values.

KV outage may use D1 LKG only within the same authored lifetime. At 14 days the config is review-due, at 35 days critical, and at 45 days hard-disabled. A storage read never refreshes age. Environment emergency switches always win.

Old Worker code cannot parse the new nested envelope. The rollout therefore requires one complete dated flat maintenance bridge, a full-cache quiescence wait, schema migration, 100% new Worker deployment, then the strict nested final envelope. Percentage splitting old and new code is not supported.

## UI and App Review consistency

The candidate copy consistently states one-time welcome credit and zero recurring Free monthly credit. StoreKit localized prices are authoritative. Disabled purchase, subscription, reward, and account-recovery capabilities are hidden or show an unavailable state before any external transaction work.

The app preserves cached read-only startup, uses non-blocking authentication status, and removes the startup alert regression. Recent conversations have an explicit empty state, and the company drawer routes search through `SearchView` only.

App Review notes must describe the exact capability state of the uploaded build. They must not promise rewarded ads, consumable purchases, account recovery, or cross-device restore while those capabilities are disabled.

## Activation gates

| Capability | Required activation evidence |
|---|---|
| Welcome/App Attest | Physical-device production App Attest attestation and assertion matrix, replay/path/body checks, shared-network behavior |
| Consumables | StoreKit sandbox/TestFlight purchase, duplicate, restore expectation, refund/reversal, and production credential checks |
| Subscriptions | Two-device restore, same-period dedupe, upgrade/downgrade, expiry/revoke/refund transitions |
| Account recovery | Apple capability/profiles, real identity/JWKS, matching `appAccountToken`, device A/B, sign-out, lost-device recovery, account-deletion determination |
| Notifications V2 | App Store Connect endpoint delivery, valid production/sandbox signed payload, replay and ordering evidence |
| Rewarded credits | Production ad unit plus genuine Google SSV, duplicate/late/cap behavior, return navigation |
| Remote config | Daily monitor/alert, reviewed hash approval, KV/D1 outage drill, expiry alert evidence |

Until a row is complete, its capability remains disabled and cannot be advertised as user-available.

## Validation contract

The repository gate requires Worker, iOS, SEC-fetcher, legal, migration, test deployment, production deployment, smoke, balance-preservation, and documentation-consistency evidence. Current evidence is Worker 75 files / 1,113 tests, iOS 192 tests, SEC fetcher 15 tests, legal validation and live hash parity, test Worker identity/release smokes, the balanced 150-row final-candidate quality gate with complete human review, production migrations `0010`-`0017`, production Worker `0e6ebcdb-3305-4aa9-b9d5-bf714457dff7` at 100%, strict KV/D1 LKG config parity, billing-safe smoke, and exact balance reconciliation.

Release decision: `GO` for the core release. Every activation-gate row above remains disabled until its external evidence is complete.
