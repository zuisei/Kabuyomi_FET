# Production Capability Activation Evidence — 2026-07-13

Status: current runtime evidence companion; current decisions remain authoritative in `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md`

## Outcome

Production config enables paid consumables/subscriptions and rewarded credits. Account recovery remains disabled. Candidate `ff298a10` is deployed with invalid App Attest key rotation in addition to numeric `APPLE_APP_ID`, production verification, and migration `0018`.

The signed physical Release canary completed production App Attest attestation/assertion and one genuine Google AdMob SSV grant. Physical StoreKit/TestFlight and App Store notification-delivery remain open verification debts.

## Production runtime

- Worker version: `e60580e7-e7f5-449d-97b2-d36854c24896`
- deployment: 100%
- release candidate ID: `ff298a1053695e2df4399177be2a28d4c148a4594c9d12dfbc1d0d71c071b7ea`
- config version: `production-capabilities-restored-20260713-v1`
- config authored at: `2026-07-13T01:20:28.597Z`
- D1 LKG stored at: `2026-07-13T01:48:13.372Z`
- legacy compatibility expiry: `2026-08-11T14:14:00.000Z`

## Capability readback

| Capability | Current production value |
|---|---:|
| `creditBillingEnabled` | `true` |
| `consumablePurchasesEnabled` | `true` |
| `rewardedCreditEnabled` | `true` |
| `rewardedSsvReady` | `true` |
| `accountRecoveryReady` | `false` |
| `emergencyPaidGrantsDisabled` | `false` |

KV and D1 LKG returned the same values. The D1 verification read one row and wrote zero rows.

## Apple verifier repair deployment

Cloudflare version readback for Worker `e60580e7-e7f5-449d-97b2-d36854c24896` contains the App Store credentials, bundle ID, `auto` environment, and `APPLE_APP_ID=6762764426`. Invalid production Apple JWS reaches configured signature verification and is rejected without a grant.

Deployed repair candidate `ff298a1053695e2df4399177be2a28d4c148a4594c9d12dfbc1d0d71c071b7ea` additionally:

- adds `APPLE_APP_ID=6762764426` to production Worker vars;
- requires valid Apple verification environment metadata and a numeric app ID for `production`/`auto` before `/v1/usage` exposes billing and consumable capabilities;
- keeps sandbox verification valid without a production app ID;
- updates the production smoke to require active billing/reward flags and prove invalid Apple JWS reaches configured signature rejection without granting;
- implements the previously missing App Attest verifier in the Worker, including pinned Apple-root chain and certificate-time validation, nonce/App-ID/environment/key binding, authenticator flags, validation-category/build checks, assertion verification, stored-environment enforcement, and monotonic counters;
- adds forward-only D1 migration `0018` for the verified public key and environment, without storing private keys or raw attestation/assertion artifacts;
- forces legacy externally verified identities that lack `0018` key material through same-principal rebootstrap and re-attestation instead of leaving their credit actions permanently blocked;
- pins signed Debug builds to the test Worker with the development entitlement and Release builds to production with the production entitlement;
- fixes the screenshot-confirmed `/v1/chat` cache miss by automatically refreshing company data and retrying once with the latest filing key, while removing raw route/URL details from all user-facing 404 alerts;
- automatically retries same-principal App Attest recovery when a supported physical device taps the rewarded-ad action, so a previously stored `unavailable` credential is upgraded without reinstalling or losing its principal;
- rotates Apple code 3 (`invalidKey`) once only when the opaque bootstrap operation and legacy installation key still resolve to the same principal; mismatched pairs remain rejected;
- passes Worker type-check, all 77 Worker test files / 1,130 tests, iOS 201/201, signed Release build, and active production smoke. The release owner explicitly waived the 150-row answer-quality rerun once for this identity-only hotfix; the accepted quality manifest remains bound to candidate `56c0c209`.

The repair is deployed. Production logged `installation_app_attest_key_rotated`, `app_attest_attestation_verified`, and a successful assertion-protected reward intent. Google SSV then applied exactly +2 credits (`903 → 905`), with daily remaining `3 → 2`; D1 now contains one verified production App Attest key. Purchased credits remain 2,088 / ¥4,176 liability and monthly/free remains 6,390. StoreKit/TestFlight and App Store notification delivery remain external follow-up evidence.

## GitHub evidence

PR #16, `Restore purchase and rewarded-credit UI`, merged as `4a2e8bf6e64c0179f3027dd3449ebd62b4c51eb0`. Its Pull Request CI run `29217494685` passed all nine jobs:

- Repository sanity
- Worker
- Worker dry-run
- Testbench
- D1 migration order
- SEC fetcher
- Legal site
- iOS unit tests
- iOS unsigned Release

`main` protection requires those nine checks with strict status checks, one approving review, admin enforcement, and conversation resolution. Force pushes and branch deletion are disabled.

## Evidence still required

- broader physical-device App Attest reinstall/replay matrix beyond the successful production canary;
- StoreKit sandbox/TestFlight consumable and subscription lifecycle, including duplicate, restore, upgrade/downgrade, expiry/revoke, refund/reversal, and two-device reconciliation;
- App Store Server Notifications V2 console delivery and delayed/out-of-order scenarios;
- additional genuine AdMob duplicate, late, and daily-cap scenarios beyond the successful impression/SSV/return-navigation/balance canary;
- Sign in with Apple recovery and matching `appAccountToken` two-device evidence before account recovery is enabled.

## Concrete risk

The rewarded and Apple paths have strong local, CI, server-verification, idempotency, fail-closed, migration, and production-smoke coverage, but neither Apple nor Google has recorded every end-to-end lifecycle. A binding readback or simulator screen cannot prove those external lifecycles. Any release or App Review statement must preserve that distinction.
