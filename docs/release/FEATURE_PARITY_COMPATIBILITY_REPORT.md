# Feature Parity and Compatibility Contract

Status: authoritative companion to `CURRENT_SHIPPING_TRUTH.md`

As of: 2026-07-13 JST

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
| New consumable purchase | Product IDs preserved | Requires complete trusted config, Apple transaction verification, idempotent grant, and no paid-grant emergency disable | Production-enabled with `APPLE_APP_ID` and Apple signature verification configured; external StoreKit/TestFlight lifecycle evidence remains incomplete |
| Subscription purchase/restore | Lite/Pro/Max catalog preserved | Requires complete trusted config and Apple verification; client state is never authority | Production-enabled with complete verifier metadata; real two-device, restore, and transition evidence remains incomplete |
| Existing subscription state | No blind client grant | Stable HMAC principal, period identity, read-time expiry, terminal revocation, and dedupe | Server state preserved; externally unverified candidate transitions stay disabled |
| Account recovery | No claim of cross-device recovery before proof | Sign in with Apple principal, account session, matching `appAccountToken`, audited migration | Disabled |
| Rewarded ads | Existing code preserved | UI requires ads + reward + SSV readiness, production ad unit/environment, App Attest, and no emergency disable; SSV is sole grant authority | Production-enabled; physical App Attest and one genuine production AdMob SSV +2 grant verified, with duplicate/late/cap scenarios still open |
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

The candidate copy consistently states one-time welcome credit and zero recurring Free monthly credit. StoreKit localized prices are authoritative. Monthly-plan, consumable-purchase, and restore surfaces remain visible while capability, connection, or device authentication is pending; StoreKit product metadata loads independently of the server mutation gates, while only the purchase/restore controls remain disabled until their exact runtime gates pass. Product loading has a shared 10-second bound and ends in a localized price or an explicit retryable unavailable/failed state. Reward surfaces follow their server and environment gates; on an App-Attest-capable physical device, tapping the reward action automatically retries same-principal authentication recovery before creating the reward intent. Account recovery remains hidden until its capability is advertised. Deployed candidate `ff298a10` also rotates an Apple-invalid App Attest key once for the same strict bootstrap identity. Production App Attest, reward intent, advertisement, Google SSV, return navigation, and exact +2 grant passed; StoreKit/TestFlight evidence remains open.

The app preserves cached read-only startup, uses non-blocking authentication status, and removes the startup alert regression. Recent conversations have an explicit empty state, and the company drawer routes search through `SearchView` only.

App Review notes must describe the exact capability state of the uploaded build. They may describe currently enabled rewarded ads and consumable purchases only as implemented runtime behavior, without claiming the missing external lifecycle checks passed. They must not promise account recovery or cross-device recovery while that capability remains disabled.

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

The July 13 production activation departed from the prior "disabled until complete" posture for consumables/subscriptions and rewarded credits. The deployed Worker now has `APPLE_APP_ID` and reaches Apple signature verification, but the physical StoreKit lifecycle rows remain incomplete evidence gates. Account recovery remains disabled. Do not rewrite an incomplete row as externally verified merely because configuration exposes it.

## Validation contract

The repository gate requires Worker, iOS, SEC-fetcher, legal, migration, test deployment, production deployment, smoke, balance-preservation, and documentation-consistency evidence. Candidate `ff298a10` passes Worker 77 files / 1,130 tests, focused invalid-key recovery, signed physical-device Release build, production App Attest/AdMob canary, production smoke, backup, binding readback, and balance reconciliation. Production Worker `e60580e7-e7f5-449d-97b2-d36854c24896` serves it at 100%. The prior 150-row/150-review packet remains bound to `56c0c209`; the release owner waived rerunning it once for this identity-only hotfix, and the normal deploy guard remains blocked until fresh exact-candidate evidence exists.

Release decision: `GO` for the core release. Rewarded credits and consumables/subscriptions are production-enabled; production-device App Attest and one genuine AdMob SSV +2 grant are verified. StoreKit/TestFlight and Apple notification lifecycle evidence remain incomplete. Account recovery remains disabled. The one-time answer-quality waiver for candidate `ff298a10` remains explicit and does not alter the normal deploy guard.
