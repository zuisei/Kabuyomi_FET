# V1.0.2 Production Log Redaction Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## Conclusion

PR1 production log redaction is implemented for the Worker credit/quota, StoreKit verification, AdMob rewarded SSV, and adjacent quote-translation credit log paths.

The patch is intentionally log-only:

- No credit balance behavior changed.
- No credit ledger or idempotency semantics changed.
- No StoreKit verification behavior changed.
- No AdMob SSV verification or reward grant behavior changed.
- No chat answer-quality, source selection, filing retrieval, iOS, deploy, push, or SEC Form Router work was performed.

Local validation passed. Release remains on hold for the next P1 hardening patch.

## Files Changed

- `workers/src/lib/logging.ts`
- `workers/src/lib/quota.ts`
- `workers/src/lib/apple-store-server.ts`
- `workers/src/routes/admob-rewards.ts`
- `workers/src/routes/translate-quote.ts`
- `workers/test/logging.test.ts`
- `workers/test/credit-quota.test.ts`
- `workers/test/apple-store-server.test.ts`
- `workers/test/admob-rewards.test.ts`
- `docs/release/V1_0_2_PRODUCTION_LOG_REDACTION_REPORT.md`

Existing dirty iOS files were not modified by this patch.

## Redaction Helpers Added

`workers/src/lib/logging.ts` now exports shared helpers:

- `suffixForLog(value, visibleChars = 8)`
- `hashForLog(value)`
- `redactForLog(value)`

The helpers:

- handle `null` and `undefined` safely
- avoid throwing from log helper paths
- avoid returning the full input as a suffix
- provide stable correlation metadata for duplicate/idempotency debugging

`hashForLog` currently returns a stable internal log hash in the form `hash:<16 hex chars>`. It is intended for production log correlation, not cryptographic proof. Sensitive/stable identifiers should prefer hash fields, with suffix fields used only for operational correlation.

Raw identifiers remain in D1/DO storage and API contracts where required for idempotency, verification, or client recovery.

## Credit / Quota Log Changes

`workers/src/lib/quota.ts` now redacts stable identifiers in credit events.

Updated event payloads replace raw fields such as:

- `quotaSubject`
- `userId`
- `operationId`
- `refundOperationId`
- purchase transaction references
- AdMob reward references
- monthly grant operation references

with safe fields such as:

- `quotaSubjectHash`
- `operationIdSuffix`
- `refundOperationIdSuffix`
- `transactionIdSuffix`
- `rewardIntentIdSuffix`

Numeric values and business fields are preserved, including:

- `creditSource`
- `creditDelta`
- `creditsRemaining`
- `creditsRequired`
- `identityKind`
- bucket balance fields

Affected events include credit consume/refund, quota denial, purchase grants, eval grants, rewarded ad grants, monthly grants, and ledger write warnings.

## Apple / StoreKit Log Changes

`workers/src/lib/apple-store-server.ts` now logs Apple transaction verification events with `transactionIdSuffix` instead of raw `transactionId`.

The patch keeps non-secret Apple auth diagnostics, such as key ID, issuer prefix/hash, bundle ID, environment, JOSE header presence, and signature byte count.

The patch does not log:

- raw JWS values
- Apple signed payloads
- bearer tokens
- private keys
- full transaction IDs
- full original transaction IDs
- full web order line item IDs

Purchase and subscription verification behavior is unchanged.

## AdMob Log Changes

`workers/src/routes/admob-rewards.ts` now redacts stable identifiers in SSV and reward intent logs.

Updated event payloads replace raw fields such as:

- `transaction_id` / `transactionId`
- `ad_unit` / `adUnit`
- `expectedAdUnit`
- `rewardIntentId`
- `customData`
- `quotaSubject`
- SSV signature values

with safe fields such as:

- `transactionIdSuffix`
- `adUnitSuffix`
- `expectedAdUnitSuffix`
- `rewardIntentIdSuffix`
- `customDataSuffix`
- `quotaSubjectHash`
- `signaturePresent`

Callback URLs and raw SSV signatures are not emitted in production log payloads. AdMob SSV signature verification, reward intent lookup, duplicate handling, daily cap behavior, and grant semantics are unchanged.

## Related Credit Log Change

`workers/src/routes/translate-quote.ts` also used the shared credit quota path and emitted raw quota/operation identifiers in failure logs. This patch redacts those fields with:

- `quotaSubjectHash`
- `operationIdSuffix`

Quote translation API behavior and refund behavior are unchanged.

## Tests Added / Updated

Added:

- `workers/test/logging.test.ts`
  - verifies `suffixForLog` does not return full input
  - verifies short values are not emitted verbatim
  - verifies `hashForLog` is stable and does not reveal input
  - verifies `redactForLog` combines hash and suffix metadata without returning the raw value

Updated:

- `workers/test/credit-quota.test.ts`
  - verifies credit consume/refund logs do not include full quota subject or operation ID
- `workers/test/apple-store-server.test.ts`
  - verifies Apple verification logs do not include full transaction ID or signed transaction JWS
- `workers/test/admob-rewards.test.ts`
  - verifies AdMob SSV logs do not include full transaction ID, full ad unit ID, full reward intent ID, full quota subject, custom data, or SSV signature

Existing StoreKit, credit ledger, AdMob SSV, chat route, and compact diagnostics tests still pass.

## Commands Run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm test -- logging
npm test -- credit-quota
npm test -- apple-store-server
npm test -- admob-rewards
npm test -- index
npm test -- quote-translation-route
npm run typecheck
npm test
npm run dryrun:test
```

From `/Users/0xt4/t4dano/Kabuyomi`:

```bash
git diff --check
git status --short
rg "logEvent|logErrorEvent|console\\.(log|warn|error)" workers/src
rg "deviceKey|operationId|transactionId|originalTransactionId|webOrderLineItemId|signedTransaction|signedTransactionInfo|signedPayload|adUnit|expectedAdUnit|rewardIntentId|customData|callback|signature" workers/src workers/test
git diff --stat -- workers/src/lib/logging.ts workers/src/lib/quota.ts workers/src/lib/apple-store-server.ts workers/src/routes/admob-rewards.ts workers/src/routes/translate-quote.ts workers/test/logging.test.ts workers/test/credit-quota.test.ts workers/test/apple-store-server.test.ts workers/test/admob-rewards.test.ts
```

## Failed Commands

None.

## Scan Notes

The final identifier scan still finds raw identifier strings in expected places:

- D1/DO storage fields required for idempotency
- Apple and AdMob request/response parsing fields
- existing API response contracts
- test fixtures and assertions
- unrelated non-monetization Worker logs outside PR1 scope

The redacted production log payload assertions cover the PR1 credit/quota, StoreKit, and AdMob SSV targets.

## Remaining Risks

- This patch does not address the remaining P1 hardening items from the Worker hardening audit, including AdMob daily-cap concurrency, best-effort D1 audit completeness after DO mutation, or same-period subscription downgrade audit semantics.
- This patch does not perform a full non-monetization log audit. Some unrelated logs still include operational URLs, filing identifiers, search terms, or request-oriented fields and should be reviewed in a later observability/privacy pass.
- `suffixForLog` is only redaction for operational correlation. For highly sensitive stable identifiers, prefer `hashForLog` fields in production logs.
- API responses still intentionally expose some raw identifiers where existing app recovery or purchase/subscription contracts require them.

## Deploy Recommendation

Deploy may be considered after code review and the normal predeploy gate because validation passed and the patch is log-only. No deploy was performed in this task.

This is not a release approval. The release should remain on hold until the next P1 hardening patch is reviewed.

## releaseDecision

releaseDecision: HOLD - NEXT P1 HARDENING PATCH REQUIRED
