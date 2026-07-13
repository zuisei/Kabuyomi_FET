# Kabuyomi Current Shipping Truth

Status: authoritative release truth

As of: 2026-07-13 JST

Starting commit: `b61602ef55e2499cccd46e32f53e29bb61c83aa7`

Catalog authority: `shared/product-catalog.json` (`2026-07-11.v1`)

Release decision: `GO` for the core release; paid consumables and rewarded credits are production-enabled, while account recovery remains disabled

This document distinguishes deployed code, current runtime exposure, and external lifecycle evidence. On 2026-07-13, candidate `ff298a10` replaced `56c0c209` in production to recover Apple `invalidKey` failures without changing installation principal or balances. A signed Release build then completed production App Attest attestation/assertion, created a genuine rewarded-ad intent, displayed the production ad, received Google SSV, and granted two credits. StoreKit/TestFlight and App Store notification lifecycles remain open.

## User-available production product

The currently deployed product provides the core SEC-reading experience: ticker search, company navigation, saved/recent companies, 10-K and 10-Q retrieval, current and historical filing selection, up-to-three-year comparisons, filing source display and SEC links, filing-grounded Japanese answers and follow-ups, quote translation, conversation history, and safe source-backed fallback answers.

Kabuyomi does not provide investment advice or execute trades.

Production now runs the full-remediation Worker candidate with stricter financial-number reconciliation, source-ID enforcement, request replay, atomic credit reservations, hardened installation identity, refund accounting, and strict remote configuration. The corrected iOS client is locally validated but is not claimed as App Store/TestFlight-shipped.

## Deployment truth

| Runtime | Current authoritative state |
|---|---|
| Working-tree candidate | Candidate `ff298a10`; Worker 77 files / 1,130 tests; iOS 201/201 and signed Release device build pass. The last 150-row/150-review quality packet is candidate `56c0c209`; the release owner explicitly waived rerunning answer quality once for this identity-only hotfix. The release-evidence manifest remains bound to `56c0c209`, so the normal deploy guard will fail until fresh exact-candidate evidence is recorded. |
| Test D1 | Migrations `0010` through `0018` applied; no pending migration |
| Test Worker | Version `3f377477-74f2-419b-b4cf-cc703d8ffc84` at 100%; final candidate `56c0c209`; identity, release, and physical development App Attest attestation smokes pass |
| Production Worker before final rollout | Rollback version `78971adf-324f-4d27-8f06-b18fd95d81ae` |
| Production D1 | Migrations `0010` through `0018` applied; App Attest public-key/environment columns verified; no pending migration |
| Prior guarded baseline | Version `0e6ebcdb-3305-4aa9-b9d5-bf714457dff7`; candidate `07eae11a`; historical billing-disabled smoke only |
| Current production Worker | Version `e60580e7-e7f5-449d-97b2-d36854c24896` at 100%; candidate `ff298a10`; active-capability production smoke passes with `APPLE_APP_ID=6762764426` and production App Attest bindings |
| Current production config | `production-capabilities-restored-20260713-v1`; KV and D1 LKG agree that billing, consumables, rewarded credit, and rewarded SSV are enabled; account recovery is disabled; paid-grant emergency stop is off |
| Apple/App-Attest repair | Deployed in candidate `ff298a10`; Apple code 3 (`invalidKey`) rotates the App Attest key once only for the same strict bootstrap-operation/legacy-key identity, then re-attests without changing principal or balances. Production attestation, assertion, and rewarded intent passed on the signed Release build. |

Production was freshly exported immediately before migration `0018` to `/Users/0xt4/.codex/backups/Kabuyomi/2026-07-13-app-attest-release/kabuyomi-history-before-0018.sql`; SHA-256 `cd0407e6107e95f7d82af0687059311b164df2ccb6a0d6ef1a30c0a084738386`. Paid liability remained exactly 2,088 purchased credits / ¥4,176 and monthly/free remained 6,390. The genuine rewarded-ad canary intentionally changed rewarded balance from 24 to 26 and the tested installation from 903 to 905.

## Identity and compatibility

New release clients bootstrap a server-issued installation credential. The credential is stored in Keychain, expires after 90 days, and is rotated after 14 days. A caller-chosen `x-device-key` is not authority for a fresh balance or grant. The iOS client distinguishes a transient Keychain failure, incompatible stored data, and a locally unsigned build; only recoverable states expose a retry action, and older identity-state payloads decode missing replay-protection arrays as empty. Simulator UI validation must use a normally signed local build because `CODE_SIGNING_ALLOWED=NO` deliberately omits the Keychain entitlement.

Verified App Attest is required for the one-time welcome grant and grant-producing identity paths. When App Attest is unsupported or temporarily unavailable, safe core reads remain usable, but the installation receives no welcome credit and cannot use reward, purchase, subscription, account-recovery, internal-grant, or migration-grant paths.

For already shipped clients, the candidate contains a production-only compatibility bridge with these hard boundaries:

- only syntactically valid shipped UUID device keys;
- only usage, company read/refresh, watchlist add/remove, chat, and quote translation;
- no welcome, monthly, paid, subscription, rewarded, account, internal, or migration grants;
- a fixed expiry no more than 30 days after the reviewed config timestamp;
- exact production environment only;
- no new `legacy_chat` reservation; only existing terminal replay remains readable.

The production bridge expires at `2026-08-11T14:14:00.000Z` and must be removed after the current App Store client adoption window. Its lifecycle is surfaced by the remote-config inspector at review-due, critical, and expired thresholds.

## Credits and products

| Surface | Current contract |
|---|---|
| Normal chat | 2 credits |
| Quote translation | 1 credit |
| Welcome | 50 credits once for a verified App Attest installation; never recurring |
| Free | 0 monthly credits; 3 saved companies; 25-question daily fair-use limit |
| Lite | `kabuyomi.sub.lite.monthly`; 400 credits per Apple-verified period; 3 saved companies; 10-question daily fair-use limit |
| Pro | `kabuyomi.sub.pro.monthly`; 900 credits per Apple-verified period; 20 saved companies; 50-question daily fair-use limit |
| Max | `kabuyomi.sub.max.monthly`; 2,000 credits per Apple-verified period; 20 saved companies; 50-question daily fair-use limit |
| Consumables | `kabuyomi.credits.50` and `kabuyomi.credits.100`; existing verified paid balances remain spendable; production Apple signature verification is configured, while the real StoreKit/TestFlight lifecycle packet is not yet recorded |
| Rewarded credit | 2 credits per verified Google AdMob SSV, maximum 3 grants per JST day, expiring after 30 days; a genuine production impression/SSV canary granted exactly 2 credits, changed the tested installation from 903 to 905, and reduced daily remaining from 3 to 2 |
| Price display | StoreKit localized price is authoritative; repository copy does not hard-code a shipping price. Product metadata loads even while server purchase mutations are gated, and every load resolves within 10 seconds to a localized price or an explicit retryable unavailable/failed state instead of remaining at `価格を確認中`. Signed Simulator evidence resolved the current storefront to `$3.99`, `$7.99`, `$14.99`, and `$0.49`; this is UI/product-metadata evidence, not purchase-lifecycle proof. |

Every non-`dev_unlimited` model request is metered even while StoreKit purchase UI is disabled. Disabling `creditBillingEnabled` cannot make chat or quote translation free.

Consumption uses earliest-expiring subscription/promotional/reward lots first, then non-expiring welcome credits, then purchased credits. Reservations record exact bucket allocation. Release restores only still-valid source buckets; an ad lot that expires while reserved is not converted to another bucket. Paid credits do not expire.

Consumable refunds remove available purchased credits first and record any shortfall as refund debt. Later purchases settle refund debt before adding spendable credit. Refund reversal restores only the amount actually removed or settled, idempotently.

## Billing, subscriptions, and recovery

Apple-verified data is the only authority for purchase grants and subscription entitlement. The client cannot declare itself subscribed. One `originalTransactionId` maps to one HMAC-derived subscription principal; one period grants once across restore, retry, or another device.

The code implements Apple JWS and certificate-chain verification, bundle/environment checks, `appAccountToken` ownership, Sign in with Apple account principals, App Store Server Notifications V2 ordering/deduplication, entitlement terminal states, and consumable refund/reversal accounting. Runtime enablement is not evidence that every real Apple/Google lifecycle has passed.

The current production configuration exposes these capabilities:

- `creditBillingEnabled=true`;
- `consumablePurchasesEnabled=true`;
- `accountRecoveryReady=false`;
- `rewardedCreditEnabled=true`;
- `rewardedSsvReady=true`;
- `emergencyPaidGrantsDisabled=false`.

Existing balances remain readable and spendable. Production App Attest and one genuine rewarded-ad SSV grant are now physically verified. Purchase/subscription UI is exposed, and production Apple signed-data verification is configured and rejects invalid JWS at the signature boundary. Account recovery remains unavailable. Physical StoreKit/TestFlight and App Store notification delivery remain open evidence.

## Remote configuration and emergency controls

Deployed environments require a complete, typed, dated envelope. Missing, malformed, partial, unsupported, or stale configuration falls back to a fresh D1 last-known-good envelope only when that envelope is itself valid and within the original authored lifetime. Otherwise the Worker selects `safe_fail_closed`.

Lifecycle policy:

- human review due at 14 days;
- critical at 35 days;
- hard fail-closed at 45 days;
- KV and D1 reads never rewrite `updatedAt`;
- environment emergency disables always override remote enablement;
- legacy-client compatibility expires independently and cannot exceed 30 days.

Emergency controls cover chat/model calls, free grants, paid grants, subscription paths, rewarded ads, web context, SEC refresh, scheduled/background work, and internal migration/evaluation grants. The rollout used the dated flat maintenance bridge, observed live maintenance, applied schema, deployed the new Worker at 100%, and only then published the nested envelope. Production config `production-capabilities-restored-20260713-v1` is fresh in KV and D1 LKG with authored timestamp `2026-07-13T01:20:28.597Z`. A read-only D1 check confirmed the same enabled billing/consumable/reward flags, disabled account recovery, and disabled paid-grant emergency stop; its LKG `stored_at` was `2026-07-13T01:48:13.372Z`.

## iOS behavior

Startup is local-first. Cached companies, filings, conversations, and public search remain reachable during temporary installation-authentication or App Attest failure. The app retries with bounded backoff, does not present a blocking startup dialog, shows one non-blocking status only after repeated failure, and offers manual retry. Credit-mutating actions remain disabled until identity is authoritative.

The candidate UI is verified on iPhone 17 Pro / iOS 26.4 and covers dark appearance, Dynamic Type, Reduced Motion, company/search navigation, filing summary, credit states, and an explicit empty Recent-conversation state. The drawer uses the dedicated Search screen instead of a dead competing inline-search state. A `/v1/chat` filing-cache miss now forces a company refresh and retries the question once with the latest filing key. Only if recovery fails does the app show a company-data refresh action; it is no longer misclassified as a purchase-route failure, and DEBUG alerts no longer expose route paths, Worker URLs, or raw server messages.

The signed physical-device Debug artifact carries the `development` App Attest entitlement and is pinned to the isolated test Worker. Release carries the `production` entitlement and production Worker URL. The deployed verifier validates the pinned Apple certificate chain and validity period, nonce, App ID, environment, credential/public-key binding, authenticator flags, validation category, bundle version, assertion signature, request binding, stored environment, and monotonic counter. Migration `0018` stores only the verified public key and environment and is applied in test and production. Production key rotation, attestation, assertion, reward intent, Google SSV, and exact +2 balance application passed on the physical Release build.

## Legal and privacy

Privacy, terms, support, commercial-disclosure, and index pages validate at revision `2026-07-11`. Pages deployment `cf7a3e20` completed, and all five canonical live URLs match the local sources exactly by SHA-256.

Production diagnostics retain state names, bounded counters, hashes, and redacted suffixes. They do not retain raw credentials, installation/device identifiers, Apple identity tokens or subjects, full transaction IDs, Apple JWS, App Attest objects/assertions, AdMob signatures, user questions, conversation content, or filing source text.

## Release decision

`GO` for the core release; rewarded credit and Apple monetization are active with external lifecycle evidence open

Candidate `ff298a10` is live with all 77 Worker files / 1,130 tests green, active-capability production smoke green, physical production App Attest green, and a genuine production AdMob SSV +2 grant green. The exact-candidate answer-quality rerun was explicitly waived once; the accepted quality packet still belongs to `56c0c209` and must be refreshed before the next normal guarded deploy. StoreKit/TestFlight, Sign in with Apple recovery, and App Store Server Notifications delivery remain unverified. Account recovery remains disabled.
