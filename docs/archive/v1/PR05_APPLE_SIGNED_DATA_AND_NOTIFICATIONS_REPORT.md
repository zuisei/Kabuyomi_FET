# PR-05 Apple Signed Data and Notifications V2 Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## 1. Conclusion

Apple transaction and notification authority now uses Apple's App Store Server Library verifier with trusted Apple roots, bundle/environment checks, nested transaction verification, notification deduplication, and stable-principal entitlement/grant propagation.

## 2. Audit-claim verification table

| Claim | Result | Evidence |
|---|---|---|
| KBY-P1-06 decoded but unverified JWS | Remediated locally | `apple-signed-data.ts` uses `SignedDataVerifier` |
| Missing Notifications V2 | Remediated locally | `/v1/apple/notifications/v2` route and dedupe table |

## 3. Implementation summary

Pinned `@apple/app-store-server-library` 3.1.0, embedded audited root certificates/hashes, rejected client-only JWS authority, and added renewal/refund/revoke notification processing.

## 4. Files changed

Primary files: `apple-root-certificates.ts`, `apple-signed-data.ts`, `apple-store-server.ts`, `apple-notifications-v2.ts`, index/env/wrangler configuration, and tests.

## 5. Schema and migration changes

`0011_app_store_notifications.sql` adds notification dedupe/audit storage. It is additive and was not applied remotely.

## 6. State-machine or data-flow changes

Signed payload -> certificate/signature/bundle/environment verification -> nested transaction verification -> dedupe claim -> stable principal -> entitlement transition -> idempotent monthly grant or revocation.

## 7. Tests added or updated

Tests cover malformed/untrusted payloads, exact notification replay, renewal, refund/revoke, sandbox/production transaction behavior, expiry, revocation, and rejection of client-provided JWS.

## 8. Commands run and exact results

Worker full suite PASS after consolidation: 814/814; notification route tests PASS: 3/3; typecheck PASS.

## 9. Security and privacy review

Raw signed payloads, certificates, signatures, and full transaction IDs are not logged or persisted in application logs.

## 10. Backward-compatibility review

Existing verified transaction sync remains; verification is stricter and intentionally fails closed.

## 11. Unresolved risks

The public notification URL, Apple console configuration, and real sandbox/production signed traffic were not exercised locally.

## 12. Rollback or disable procedure

Remove the Apple notification registration externally and disable paid grants. Retain dedupe rows and entitlement history.

## 13. releaseDecision

`releaseDecision: READY_FOR_NEXT_PHASE`
