# Kabuyomi Current Shipping Truth

Status: authoritative release truth

As of: 2026-07-12 JST

Starting commit: `b61602ef55e2499cccd46e32f53e29bb61c83aa7`

Catalog authority: `shared/product-catalog.json` (`2026-07-11.v1`)

Release decision: `GO` for the core release; externally unverified grant/recovery capabilities remain disabled

This document distinguishes the deployed core remediation from capabilities that remain disabled. Code, tests, or routes do not make an externally unverified capability user-available.

## User-available production product

The currently deployed product provides the core SEC-reading experience: ticker search, company navigation, saved/recent companies, 10-K and 10-Q retrieval, current and historical filing selection, up-to-three-year comparisons, filing source display and SEC links, filing-grounded Japanese answers and follow-ups, quote translation, conversation history, and safe source-backed fallback answers.

Kabuyomi does not provide investment advice or execute trades.

Production now runs the full-remediation Worker candidate with stricter financial-number reconciliation, source-ID enforcement, request replay, atomic credit reservations, hardened installation identity, refund accounting, and strict remote configuration. The corrected iOS client is locally validated but is not claimed as App Store/TestFlight-shipped.

## Deployment truth

| Runtime | Current authoritative state |
|---|---|
| Working-tree candidate | Worker 75 files / 1,113 tests; balanced 150-row Q01-Q10 release gate and 150/150 human review pass; iOS 192 tests; SEC fetcher 15 tests; unsigned iOS Release build and legal validation pass |
| Test D1 | Migrations `0010` through `0017` applied; no pending migration was reported after apply |
| Test Worker | Version `6756d037-cdf1-45df-87a0-1babbb8ec9da` at 100%; final candidate `07eae11a`; identity and full release smokes pass |
| Production Worker before final rollout | Rollback version `78971adf-324f-4d27-8f06-b18fd95d81ae` |
| Production D1 | Migrations `0010` through `0017` applied; no pending migrations; schema probes pass |
| Final production candidate | Version `0e6ebcdb-3305-4aa9-b9d5-bf714457dff7` at 100%; candidate `07eae11a`; billing-safe smoke `PASS_WITH_CAPABILITY_DISABLED` |

Production was freshly exported immediately before the rollout to `/Users/0xt4/.codex/backups/Kabuyomi/2026-07-12-production-remediation/kabuyomi-history-before.sql`; SHA-256 `e04e8d209c810b55fc641e8472c94ea28d3ece3c063bc0e5ef1c53bbf4dc50d5`. Pre/post projections match exactly: 140 principals, 7,602 total, 6,390 monthly, 1,188 purchased, 24 rewarded, 742 ledger rows, 11 purchases, and 1,000 granted purchased credits.

## Identity and compatibility

New release clients bootstrap a server-issued installation credential. The credential is stored in Keychain, expires after 90 days, and is rotated after 14 days. A caller-chosen `x-device-key` is not authority for a fresh balance or grant.

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
| Consumables | `kabuyomi.credits.50` and `kabuyomi.credits.100`; existing verified paid balances remain spendable; new purchase capability is disabled until its external gate passes |
| Rewarded credit | 2 credits per verified Google AdMob SSV, maximum 3 grants per JST day, expiring after 30 days; capability disabled until production SSV evidence exists |
| Price display | StoreKit localized price is authoritative; repository copy does not hard-code a shipping price |

Every non-`dev_unlimited` model request is metered even while StoreKit purchase UI is disabled. Disabling `creditBillingEnabled` cannot make chat or quote translation free.

Consumption uses earliest-expiring subscription/promotional/reward lots first, then non-expiring welcome credits, then purchased credits. Reservations record exact bucket allocation. Release restores only still-valid source buckets; an ad lot that expires while reserved is not converted to another bucket. Paid credits do not expire.

Consumable refunds remove available purchased credits first and record any shortfall as refund debt. Later purchases settle refund debt before adding spendable credit. Refund reversal restores only the amount actually removed or settled, idempotently.

## Billing, subscriptions, and recovery

Apple-verified data is the only authority for purchase grants and subscription entitlement. The client cannot declare itself subscribed. One `originalTransactionId` maps to one HMAC-derived subscription principal; one period grants once across restore, retry, or another device.

The code implements Apple JWS and certificate-chain verification, bundle/environment checks, `appAccountToken` ownership, Sign in with Apple account principals, App Store Server Notifications V2 ordering/deduplication, entitlement terminal states, and consumable refund/reversal accounting. These are not user-available merely because the code and local tests pass.

The final reviewed production configuration keeps these external capabilities disabled until evidence exists:

- `creditBillingEnabled=false`;
- `consumablePurchasesEnabled=false`;
- `accountRecoveryReady=false`;
- `rewardedCreditEnabled=false`;
- `rewardedSsvReady=false`;
- `emergencyPaidGrantsDisabled=true`.

Existing balances remain readable and spendable. New grants, purchase completion, subscription sync, and account recovery fail before Apple work while disabled.

## Remote configuration and emergency controls

Deployed environments require a complete, typed, dated envelope. Missing, malformed, partial, unsupported, or stale configuration falls back to a fresh D1 last-known-good envelope only when that envelope is itself valid and within the original authored lifetime. Otherwise the Worker selects `safe_fail_closed`.

Lifecycle policy:

- human review due at 14 days;
- critical at 35 days;
- hard fail-closed at 45 days;
- KV and D1 reads never rewrite `updatedAt`;
- environment emergency disables always override remote enablement;
- legacy-client compatibility expires independently and cannot exceed 30 days.

Emergency controls cover chat/model calls, free grants, paid grants, subscription paths, rewarded ads, web context, SEC refresh, scheduled/background work, and internal migration/evaluation grants. The rollout used the dated flat maintenance bridge, observed live maintenance, applied schema, deployed the new Worker at 100%, and only then published the nested envelope. Production config `production-safe-release-20260711-v3` is fresh in KV and D1 LKG with reviewed config hash `aab7ec76878c3a400c6c08a29e7be7d83cc65aee130901022574eac6266825b3`.

## iOS behavior

Startup is local-first. Cached companies, filings, conversations, and public search remain reachable during temporary installation-authentication or App Attest failure. The app retries with bounded backoff, does not present a blocking startup dialog, shows one non-blocking status only after repeated failure, and offers manual retry. Credit-mutating actions remain disabled until identity is authoritative.

The candidate UI is verified on iPhone 17 Pro / iOS 26.4 and covers dark appearance, Dynamic Type, Reduced Motion, company/search navigation, filing summary, credit states, and an explicit empty Recent-conversation state. The drawer uses the dedicated Search screen instead of a dead competing inline-search state.

## Legal and privacy

Privacy, terms, support, commercial-disclosure, and index pages validate at revision `2026-07-11`. Pages deployment `cf7a3e20` completed, and all five canonical live URLs match the local sources exactly by SHA-256.

Production diagnostics retain state names, bounded counters, hashes, and redacted suffixes. They do not retain raw credentials, installation/device identifiers, Apple identity tokens or subjects, full transaction IDs, Apple JWS, App Attest objects/assertions, AdMob signatures, user questions, conversation content, or filing source text.

## Release decision

`GO` for the core release

The executable local, test, production, balance-preservation, quality, and legal gates are green. Physical-device App Attest, StoreKit/TestFlight lifecycle, Sign in with Apple recovery, App Store Server Notifications delivery, and production AdMob SSV remain unverified. They stay hidden, fail-closed, and disabled; this `GO` does not authorize enabling or advertising them.
