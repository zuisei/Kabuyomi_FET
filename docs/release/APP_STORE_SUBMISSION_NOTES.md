# App Store Submission Notes — Draft, Not Yet Submission-Approved

Status: HOLD for App Store submission; core backend release is `GO`. These are a source draft, not text approved for App Store Connect. Refresh every conditional statement from the exact uploaded archive and its live capability response after final TestFlight and external-service evidence is recorded.

Kabuyomi helps users read supported SEC 10-K and 10-Q filings in Japanese. It provides filing-grounded summaries and question answering. It does not execute trades, connect to brokerage accounts, manage portfolios, recommend buying or selling securities, predict prices, or provide target prices.

## Candidate products

- `kabuyomi.credits.50`: 50 paid credits.
- `kabuyomi.credits.100`: 100 paid credits; existing compatibility product.
- Lite: `kabuyomi.sub.lite.monthly`, 400 credits per Apple-verified period.
- Pro: `kabuyomi.sub.pro.monthly`, 900 credits per verified period.
- Max: `kabuyomi.sub.max.monthly`, 2,000 credits per verified period.
- StoreKit localized product data is the price authority.
- Free recurring monthly credits are zero. A server-verified App Attest installation may receive 50 welcome credits once.
- A normal question costs 2 credits. Free / Lite / Pro / Max have daily fair-use limits of 25 / 10 / 50 / 50 questions and saved-company limits of 3 / 3 / 20 / 20.

Do not put fixed currency amounts in review copy. Verify each product's StoreKit `displayPrice`, duration, availability, and App Store Connect record from the uploaded build.

The 50- and 100-credit purchase surface is shown only when the Worker explicitly reports both billing and consumable purchasing enabled. While `accountRecoveryReady` is false, Apple-verified, idempotent grants use verified-installation compatibility ownership and no cross-device recovery is claimed. Existing paid balances remain spendable.

Rewarded credit is conditional, not an unconditional reviewer promise. Release UI requires a fresh trusted full remote config with explicit `adsEnabled`, `rewardedCreditEnabled`, and `rewardedSsvReady` values, the production ad unit and environment, no emergency disable, and the Worker capability response. Only valid Google AdMob SSV grants 2 credits; the cap is 3 grants per JST day and credits expire after 30 days. Record whether the exact uploaded build shows or hides this action, then make the reviewer note match that observed state. Production SSV evidence remains a submission gate if it is visible.

## Public metadata URLs

- Privacy Policy: `https://kabuyomi-legal-site.pages.dev/privacy/`
- Support: `https://kabuyomi-legal-site.pages.dev/support/`
- Terms: `https://kabuyomi-legal-site.pages.dev/terms/`
- 特定商取引法: `https://kabuyomi-legal-site.pages.dev/tokushoho/`

Use the static legal site for App Store metadata. Settings opens a bundled readable legal snapshot and points to the public source; both copies must remain semantically identical. This remediation deployed and hash-verified the public pages; verify them again against the exact submitted build.

Live deployment verification on 2026-07-12: index, Privacy, Terms, Support, and 特定商取引法 all report revision `2026-07-11` and match the validated local sources exactly by SHA-256.

## Trust and privacy

- Grants require Apple signed-data verification by the Worker.
- Production anonymous identity uses a server-issued installation token and App Attest; a caller-chosen device key cannot create a welcome balance.
- Material financial numbers are matched to verified filing facts before display.
- Raw IPs/device keys, identity tokens/subjects, signed StoreKit payloads, and App Attest artifacts are not retained in application logs.
- Local reset clears local content and chat history but retains the Keychain installation credential.
- Core filing reading and questions work with an anonymous installation and do not require login.
- Sign in with Apple is a separately gated option for paid-credit recovery and new consumable ownership only; the app requests no name or email scopes.

### App Privacy questionnaire reconciliation

The App Store Connect answers must cover Kabuyomi and bundled third-party SDK behavior shown by the generated archive privacy report. At minimum, reconcile these source-visible categories before submission:

| Data category | Current use | Linked | Tracking |
|---|---|---:|---:|
| Device ID / identifier | Anonymous installation, abuse prevention, credit authority | Yes | No for Kabuyomi's own identifier |
| Purchase history | Grant, entitlement, refund, restore, duplicate prevention | Yes | No |
| Product interaction | Saved/viewed companies, usage, diagnostics | Yes | No |
| Search history | Search requests and troubleshooting | Yes | No |
| Other user content | Questions, translation input, AI response flow | Yes | No for Kabuyomi's own processing |
| Advertising and SDK diagnostics | Google AdMob delivery and diagnostics | Reconcile with archive report | Reconcile with actual consent/ad configuration |

The bundled Google SDK privacy report may include advertising data, device ID, product interaction, coarse location, crash/performance data, and other diagnostics. Do not answer “not collected” or “not used for tracking” from the app's own manifest alone. Reconcile the generated archive privacy report, AdMob configuration, consent flow, and current App Store Connect questionnaire.

Keep `accountRecoveryReady=false` for submission until the Apple capability/provisioning, two-device recovery, and an in-app account-deletion path (or documented App Review determination that no account is created) are verified. Sign-out alone is not the deletion gate.

## Reviewer path

1. Complete disclosure/consent.
2. Search for a supported U.S. ticker and open its filing.
3. View the summary and ask a filing-grounded question.
4. Verify Saved, Recently Viewed, starter companies, and older filing conversations in the drawer.
5. Verify Lite / Pro / Max descriptions separately label monthly credits, approximate questions, saved-company limit, and daily fair-use limit.
6. Verify a supported search result opens without first consuming a saved-company slot; saving it is a separate action.
7. Verify the exact capability response controls billing, consumables, account recovery, and rewarded credit. Do not instruct the reviewer to find a capability that is hidden in the uploaded build.
8. Verify Privacy, Terms, Support, 特商法, and Apple's standard EULA are reachable in-app.

Before submission, attach TestFlight StoreKit, notification, real-device App Attest, generated archive privacy report, observed capability-state screenshots, remote-config lifecycle monitor/alert evidence, and final release-gate evidence. Support requests and tester notes must ask for a redacted minimal reproduction, never identity tokens, installation credentials, full receipts/purchase IDs, App Attest artifacts, or confidential question text.
