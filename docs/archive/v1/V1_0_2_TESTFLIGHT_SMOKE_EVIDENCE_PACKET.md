# Kabuyomi v1.0.2 TestFlight Smoke Evidence Packet

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Generated: 2026-05-10 JST

## 1. Purpose

This packet is superseded by `docs/archive/v1/RELEASE_TRUTH.md`, `docs/release/CURRENT_SHIPPING_TRUTH.md`, and the final RC audit report. It remains a historical TestFlight smoke template, but the current RC hides the rewarded-credit UI until real Google AdMob SSV grant evidence is recorded in-repo.

Do not mark any item as passed unless the evidence was captured from the installed TestFlight candidate or the explicitly named App Store Connect / backend surface.

Result values:

- `PASS`: verified with evidence
- `FAIL`: attempted and failed
- `BLOCKED`: could not execute because a prerequisite was unavailable
- `N/A`: not applicable, with a note
- `UNTESTED`: not yet executed

Sensitive evidence rules:

- Paste transaction ID suffix only, never full transaction IDs.
- Do not paste raw device keys, full Apple transaction payloads, AdMob callback URLs, AdMob unit IDs, SSV signatures, or internal secrets.
- Use screenshot file paths, not embedded private screenshots, if the evidence is stored locally.
- Backend response summary should be short and sanitized.

## 2. Candidate Identity

| Field | Value |
| --- | --- |
| Branch | `v1.0.2-subscription-rewarded-credits` |
| HEAD | `e35a9c1` at the time this packet was created |
| Scope | v1.0.2 monetization plus visible Company UI polish candidate |
| Company UI polish | Included |
| v1.2 / SEC Form Router | Not included |
| Production deploy in this packet | No |
| Push in this packet | No |

## 3. Fixed v1.0.2 Scope To Verify

- Subscriptions are visible when StoreKit returns them.
- `kabuyomi.credits.50` is visible.
- `kabuyomi.credits.100` remains supported as compatibility when StoreKit returns it.
- Rewarded-credit UI is hidden in the current RC until real Google AdMob SSV grant evidence is recorded in-repo.
- StoreKit / Apple server verification is authoritative for paid credit and subscription grants.
- AdMob SSV is authoritative for rewarded ad grants.
- Credit ledger and idempotency behavior prevent double grants.
- Credits / Settings / Account Status monetization UI is reviewable.
- Company UI polish, source display polish, answer presentation polish, and overview / summary UI polish are included.
- Release / legal / App Review documentation matches the build.

Not in this smoke:

- v1.2 SEC Form Router
- 20-F / 6-K / 8-K support
- filing retrieval changes
- answer-quality logic changes

## 4. Pre-Smoke Setup

| Item | Expected evidence | Result | Evidence / notes |
| --- | --- | --- | --- |
| TestFlight build installed | Build number and screenshot path | UNTESTED |  |
| Device / iOS version recorded | Device model and iOS version | UNTESTED |  |
| App Store Connect product configuration visible | Screenshot or human note for v1.0.2 product set | UNTESTED |  |
| Sandbox Apple Account ready | Account country/storefront note; no full Apple ID | UNTESTED |  |
| Backend environment identified | Account Status / API environment screenshot path | UNTESTED |  |
| Legal/public URLs reachable | URL smoke summary | UNTESTED |  |

## 5. App Store Connect Product Visibility

Confirm in App Store Connect before device smoke.

| Product / group | Expected | Result | Evidence / notes |
| --- | --- | --- | --- |
| `kabuyomi.credits.50` | Consumable, JPY 100, 50 paid credits | UNTESTED |  |
| `kabuyomi.credits.100` | Existing compatibility consumable, supported if returned | UNTESTED |  |
| `Kabuyomi_sus` | Subscription group exists | UNTESTED |  |
| `kabuyomi.sub.lite.monthly` | Auto-renewable, JPY 640/month, 400 credits/month | UNTESTED |  |
| `kabuyomi.sub.pro.monthly` | Auto-renewable, JPY 1,280/month, 900 credits/month | UNTESTED |  |
| `kabuyomi.sub.max.monthly` | Auto-renewable, JPY 2,560/month, 2,000 credits/month | UNTESTED |  |
| IAPs attached to app version / review as needed | App Review-visible product setup | UNTESTED |  |

## 6. StoreKit / Paid Monetization Smoke Checklist

Use the installed TestFlight candidate. Capture StoreKit diagnostics after product load.

| Check | Expected pass condition | Result | Evidence / notes |
| --- | --- | --- | --- |
| TestFlight product load | `returnedProductIds` includes expected available v1.0.2 products | UNTESTED |  |
| `kabuyomi.credits.50` visible | 50 paid credits product appears with localized StoreKit price | UNTESTED |  |
| `kabuyomi.credits.50` purchase | Purchase succeeds; backend verifies; paid credits increase by exactly +50 | UNTESTED |  |
| `kabuyomi.credits.100` compatibility purchase if returned | If StoreKit returns it, purchase path still works and grants compatibility amount; if not returned, app handles absence safely | UNTESTED |  |
| Lite subscription purchase | `kabuyomi.sub.lite.monthly` purchase succeeds; backend verifies; subscription credits reflect 400/month entitlement | UNTESTED |  |
| Pro product visibility | `kabuyomi.sub.pro.monthly` visible or safely disabled/retry if not returned | UNTESTED |  |
| Max product visibility | `kabuyomi.sub.max.monthly` visible or safely disabled/retry if not returned | UNTESTED |  |
| Restore purchases | Restore/sync succeeds for current sandbox account | UNTESTED |  |
| Duplicate restore no double grant | Repeating restore does not grant paid/subscription credits twice | UNTESTED |  |
| Apple server verification path | Worker/App Store Server verification succeeds in intended TestFlight environment; no client-authoritative grant | UNTESTED |  |
| `/v1/usage` refresh after purchase | App/backend usage refresh reflects post-purchase credits | UNTESTED |  |
| Cancel purchase path | Cancel does not grant credits and UI returns cleanly | UNTESTED |  |
| Failed backend grant path, if observed | Transaction is not treated as granted unless Worker confirms grant/already-granted | UNTESTED |  |

## 7. Rewarded Ad / AdMob SSV Re-Enable Checklist

Rewarded-credit UI is not part of the current RC/App Review build. Use this section only for a future re-enable smoke build or branch where the UI is intentionally visible. Do not describe rewarded ads or ad credits in App Review material for the current RC.

| Check | Expected pass condition | Result | Evidence / notes |
| --- | --- | --- | --- |
| Rewarded-credit UI hidden in RC | Credits / Account Status does not show rewarded-ad entry point in the RC/App Review build | UNTESTED |  |
| Optional/free-ad-credit copy | UI says ad is optional and reward is free/ad credit, not paid credit | UNTESTED |  |
| Ad unavailable fallback | If no ad is served, app shows non-granting unavailable/load-failure state | UNTESTED |  |
| Reward intent created before ad | Backend creates pending intent before ad presentation | UNTESTED |  |
| Client-only completion grants nothing | iOS ad completion callback alone does not mutate credits | UNTESTED |  |
| Real AdMob SSV callback receipt | Worker receives real Google AdMob SSV callback for the reward | UNTESTED |  |
| `/v1/admob/reward-status` becomes granted | Reward status for the intent changes to `granted` after valid SSV | UNTESTED |  |
| Exactly +2 ad credits | `/v1/usage` and UI reflect exactly +2 free/ad credits | UNTESTED |  |
| Paid balance remains separate | Paid credit balance does not increase from rewarded ad | UNTESTED |  |
| 3/day cap | Three successful rewards in the same JST day are allowed, for max +6 ad credits/day | UNTESTED |  |
| 4th reward blocked | Fourth same-day successful reward is blocked server-side | UNTESTED |  |
| Duplicate SSV no double grant | Duplicate callback/transaction does not add credits again | UNTESTED |  |
| Pending state | If SSV is delayed, UI shows pending/refresh state without implying credits were already granted | UNTESTED |  |

## 8. Account Status / Privacy / App Review Smoke Checklist

| Check | Expected pass condition | Result | Evidence / notes |
| --- | --- | --- | --- |
| Account Status privacy check | Normal Account Status does not show raw device key, full transaction ID, raw callback URL, AdMob unit ID, or internal secret | UNTESTED |  |
| Account Status usage values | Free/promotional, ad, paid, and subscription credit state is understandable and separated where available | UNTESTED |  |
| Product copy consistency | UI copy matches v1.0.2 products and does not mention stale "no subscriptions" truth | UNTESTED |  |
| No investment advice copy | App Review-facing copy does not imply buy/sell recommendations, price targets, guaranteed performance, or investment advice | UNTESTED |  |
| App Review metadata consistency | Metadata matches 10-K / 10-Q filing reader scope, paid products, subscriptions, rewarded ads, and no-investment-advice positioning | UNTESTED |  |
| Company UI polish visible smoke | Company overview, answer presentation, source display, summary drawer, timeline, and top bar render without layout breakage or misleading investment-advice copy | UNTESTED |  |
| Rewarded ad review note | Review note does not claim visible rewarded ads or ad credits in the current RC | UNTESTED |  |
| Legal links | Privacy, Terms, Tokushoho, and Support URLs open from App Store metadata / app UI | UNTESTED |  |

## 9. Evidence Table

Add one row per concrete observation. Use suffixes and sanitized summaries only.

| Date/time JST | TestFlight build | Device / iOS | Product ID / flow | Transaction ID suffix only | Credits before | Credits after | Backend response summary | Screenshot path | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  | App Store Connect product visibility | N/A | N/A | N/A |  |  | UNTESTED |  |
|  |  |  | TestFlight product load | N/A | N/A | N/A |  |  | UNTESTED |  |
|  |  |  | `kabuyomi.credits.50` purchase |  |  |  |  |  | UNTESTED |  |
|  |  |  | `kabuyomi.credits.100` compatibility purchase |  |  |  |  |  | UNTESTED |  |
|  |  |  | `kabuyomi.sub.lite.monthly` purchase |  |  |  |  |  | UNTESTED |  |
|  |  |  | Restore purchases |  |  |  |  |  | UNTESTED |  |
|  |  |  | Duplicate restore |  |  |  |  |  | UNTESTED |  |
|  |  |  | Rewarded-credit UI hidden in RC | N/A |  |  |  |  | UNTESTED |  |
|  |  |  | AdMob SSV callback |  |  |  |  |  | UNTESTED |  |
|  |  |  | Reward status granted |  |  |  |  |  | UNTESTED |  |
|  |  |  | Rewarded ad +2 ad credits |  |  |  |  |  | UNTESTED |  |
|  |  |  | Rewarded ad daily cap / 4th blocked |  |  |  |  |  | UNTESTED |  |
|  |  |  | Account Status privacy | N/A | N/A | N/A |  |  | UNTESTED |  |
|  |  |  | App Review metadata consistency | N/A | N/A | N/A |  |  | UNTESTED |  |
|  |  |  | Company UI polish visible smoke | N/A | N/A | N/A |  |  | UNTESTED |  |

## 10. Backend / Log Evidence To Capture

StoreKit / Apple verification:

- Product load diagnostic screenshot from Settings purchase diagnostics.
- Sanitized `mini_iap_*` device log lines from product load through transaction finish.
- Worker log summary showing Apple server verification success or clear failure reason.
- `/v1/usage` before/after summary.

AdMob rewarded credits:

- Pending reward intent creation summary.
- Real Google SSV callback receipt summary.
- `/v1/admob/reward-status?id=<intent>` sanitized result.
- `/v1/usage` before/after summary showing exactly +2 ad credits.
- Evidence that paid credits did not increase from the ad reward.
- Evidence that duplicate SSV did not double grant if duplicate callback/replay is observed.

Do not paste raw SSV signatures, full callback URLs, full custom data, raw transaction payloads, or full device identifiers.

## 11. Final Go / No-Go

| Gate | Required before main merge | Current result | Evidence / notes |
| --- | --- | --- | --- |
| Local validation | `git diff --check`, iOS build/test, Worker tests, legal/docs validation as applicable | Local validation previously passed; this packet only ran lightweight checks | See current release reports and validation section below |
| StoreKit smoke | Real TestFlight product load, purchase, restore, duplicate no-op, Apple verification, `/v1/usage` refresh | UNTESTED | Must be executed by human |
| AdMob SSV smoke | N/A for current RC because rewarded-credit UI is hidden. Required before any future UI re-enable: real rewarded ad SSV callback, `reward-status=granted`, +2 ad credits, paid balance separate, cap behavior | UNTESTED | Must be executed by human before re-enable |
| App Review metadata | Metadata matches v1.0.2 scope and no-investment-advice requirements | UNTESTED | Human App Store Connect review required |
| Legal/public URLs | Privacy / Terms / Tokushoho / Support URLs reachable and consistent | UNTESTED | Human/public URL smoke required |
| Final git state | Candidate diff reviewed, Company UI polish included, no v1.2, no main changes | PARTIAL | Branch is correct; final staging/commit not done in this packet |

Go criteria:

- All P0 StoreKit smoke rows are `PASS` or intentionally documented `N/A` where product absence is expected.
- Real AdMob SSV callback path has at least one `PASS` for granted reward and exactly +2 ad credits before any future rewarded-credit UI re-enable.
- Duplicate restore / duplicate SSV no-double-grant behavior is either directly proven or has a documented accepted residual risk by the human release owner.
- App Review metadata and public legal URLs are consistent with v1.0.2.
- Final git diff contains the intended Company UI polish and contains no v1.2 / SEC Form Router, filing retrieval, or Worker answer-quality changes.

No-go criteria:

- StoreKit returns no v1.0.2 products in TestFlight and the cause is not understood.
- Paid or subscription credits are granted without Apple server verification.
- Rewarded ad credits are granted without real Google AdMob SSV.
- Duplicate purchase restore or duplicate SSV grants extra credits.
- Rewarded ad grants paid credits instead of free/ad credits.
- App Review-facing metadata implies investment advice, buy/sell recommendations, price targets, guaranteed performance, or stock-picking recommendations.
- Any v1.2 / SEC Form Router work appears in the final candidate.

## 12. Validation Performed For This Packet

This packet is documentation-only. It does not claim TestFlight, StoreKit, or real AdMob SSV success.

Required lightweight validation:

- `git diff --check`: passed

Relevant optional validation if legal-site docs are considered part of the evidence packet:

- `cd legal-site && npm run validate`: passed

Update this section after running validation:

| Command | Result | Notes |
| --- | --- | --- |
| `git diff --check` | PASS | Whitespace/conflict-marker check passed after adding this packet |
| `cd legal-site && npm run validate` | PASS | Static legal site validation passed |

## 13. References

- `docs/archive/v1/RELEASE_TRUTH.md`
- `docs/release/CURRENT_SHIPPING_TRUTH.md`
- `docs/archive/v1/TESTFLIGHT_READINESS_CHECKLIST.md`
- `docs/release/APP_STORE_SUBMISSION_NOTES.md`
- `docs/archive/v1/V1_0_2_REWARDED_AD_RELEASE_VISIBLE_REPORT.md`
- `docs/archive/v1/V1_0_2_COMPANY_UI_POLISH_SPLIT_DECISION_REPORT.md`
- `docs/legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md`
- `docs/admob/release-admob-checklist.md`
- `docs/admob/rewarded_admob_credits_runbook.md`
