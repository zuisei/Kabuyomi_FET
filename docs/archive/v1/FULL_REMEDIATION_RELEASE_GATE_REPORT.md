# Full Remediation and PR-14 Release Gate Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST
Base commit: `b61602ef55e2499cccd46e32f53e29bb61c83aa7`
Working tree: uncommitted
Test deployment: `kabuyomi-api-test` version `7226f5e4-39e3-4d0b-bb31-7713df1b3b0c`; test D1 migrations `0010`-`0015` applied. Production unchanged.

## 1. Conclusion

PR-00 through PR-13 remediation code and the locally executable PR-14 automated gate were completed. The six audited P0 implementation defects now have local code and regression coverage: numeric claim reconciliation, payload-bound idempotency, atomic reservation, stable subscription principals, server-authoritative entitlement, and server-issued/attested installation identity. PR-12 now also includes verified Sign in with Apple account recovery, stable `appAccountToken` binding, shared account quota identity, and idempotent legacy/install-to-account migrations.

The repository is not yet a submission candidate. Banner-ad, rewarded-credit, consumable, and subscription implementations and existing balances are preserved, while deployed capability surfaces now require a fresh trusted full config with explicit typed fields; partial legacy payloads fail closed. Account recovery remains separately disabled. The test D1 schema, test-only HMAC secrets, Worker deployment, identity bootstrap, capability payload, read paths, App Attest fail-closed gate, and Apple verifier runtime were validated remotely. Real-device App Attest/verifier, Apple capability/provisioning, StoreKit, live benchmark, human review, notification, production AdMob SSV, TestFlight, and production rollout gates remain open. Final decision is HOLD.

## 2. Audit-claim verification table

| ID | Local remediation status | Remaining release evidence |
|---|---|---|
| KBY-P0-01 | Closed in code/tests | Live Standard/out-of-sample/oracle and human numeric review |
| KBY-P0-02 | Closed in code/tests | Test-Worker exact response-loss canary |
| KBY-P0-03 | Closed in code/tests | Test-Worker orphan/timeout metrics |
| KBY-P0-04 | Closed in code/tests | Real two-device StoreKit and migration dry run |
| KBY-P0-05 | Closed in code/tests | Real expiry/renewal/refund/revoke notification validation |
| KBY-P0-06 | Closed in code/tests | Real-device App Attest/shared-network matrix and verifier configuration |
| KBY-P1-01 | Gate redesigned | Live scores and human review outstanding |
| KBY-P1-02 | Closed in code/tests | Remote KV/D1 outage drill plus lifecycle monitor/alert activation and first reviewed refresh outstanding |
| KBY-P1-03/04 | Closed in code/tests | Production balance dry run outstanding |
| KBY-P1-05 | Closed in code/tests | Production SSV evidence outstanding; UI is available only under explicit trusted reward capabilities |
| KBY-P1-06 | Closed in code/tests | Apple console endpoint evidence outstanding |
| KBY-P1-07 | Closed in local code/tests; capability remains false | Apple identity, StoreKit `appAccountToken`, and physical device A/B/lost-device evidence |
| KBY-P2-01/02/03 | Closed locally | Manual Release UI review outstanding |

## 3. Implementation summary

- Added fingerprinted RequestExecution with immutable replay and atomic credit/quota reservations.
- Rebuilt entitlement and subscription ownership around Apple-verified stable principals, bounded bindings, migration preview/apply, read-time expiry, and terminal revocation.
- Added Apple signed-data verification and Notifications V2 deduplication/propagation.
- Added server-signed installation identity, bootstrap limiting, App Attest challenge/assertion binding, and one-time verified welcome credits.
- Added exact, idempotent legacy-device -> installation quota migration so hardened identity does not strand existing paid/welcome state.
- Added Sign in with Apple token verification, HMAC account principals, stable StoreKit `appAccountToken`, shared account quota selection, account Keychain sessions, and auditable installation -> account migration with conflict handling.
- Added typed verified financial facts, deterministic formatting, numeric claim alignment, and layered quality gates.
- Added fail-closed remote config/LKG, complete server capability payloads, and a reviewed 14/35/45-day lifecycle with explicit hash-approved republish tooling; no storage read silently renews trust.
- Unified product truth, retained monetization implementations behind explicit fail-closed capability gates, retained emergency disables, restored Recent, removed dead search state, and aligned current docs/legal/App Review copy.

## 4. Files changed

Changes span Worker request/quota/entitlement/identity/billing/chat/config/reward routes and libraries, six additive D1 migrations, iOS identity/API/models/settings/company flows, Sign in with Apple entitlement, shared catalog, legal pages, CI/validation scripts, tests, and phase reports. `git status --short` is the authoritative file inventory.

## 5. Schema and migration changes

Added migrations `0010` subscription authority, `0011` App Store notifications, `0012` installation identity, `0013` remote-config LKG, `0014` account recovery, and `0015` installation-principal migration. Validation passes for 15 ordered migrations. Migrations `0010`-`0015` were applied successfully to the dedicated test D1 and a subsequent remote list reported no pending migrations. Production D1 was not changed. Rollback is disable/forward-repair, not destructive down-migration.

## 6. State-machine or data-flow changes

The principal request flow is authenticated identity -> fingerprint -> atomic begin/reserve -> exactly one provider leader -> complete/commit or fail/release -> immutable replay. Anonymous upgrade is legacy quota -> server installation -> App Attest. Paid consumable recovery is verified Apple account -> HMAC account/appAccountToken -> preview/apply migration -> account read/spend -> Apple transaction token match -> idempotent grant. Subscription flow is Apple verify -> stable principal -> entitlement transition -> stable period grant. Numeric flow is selected sources -> verified fact pack -> answer -> claim alignment -> pass/repair/block.

## 7. Tests added or updated

Coverage includes concurrency/replay/reservation expiry, entitlement expiry/revocation/binding, principal migration, Apple verification/notification replay/refund, bootstrap flood/attestation replay/body mismatch, numeric magnitude/unit/sign/period alignment, remote-config LKG/emergency/lifecycle behavior and operator-script hash refusal, welcome/catalog truth, SSV duplicate/cap handling, shipping-doc truth, and iOS credential/capability/request behavior.

## 8. Commands run and exact results

| Command/gate | Result |
|---|---|
| Worker `npm run typecheck` | PASS, 0 errors |
| Worker `npm test` | PASS, 68/68 files and 897/897 tests |
| Worker `npm run test:quality-gate` | PASS, 25/25 tests |
| Worker `npm run migrations:validate` | PASS, 15 migrations (`0001`-`0015`) |
| Worker `npm run testbench:validate` | PASS, 5 default tickers / 12 templates |
| Full-smoke check-only | PASS preflight, 15 tickers / 10 templates / 150 rows; no network run |
| Worker test-config dry run | PASS, 2427.66 KiB / gzip 469.14 KiB |
| Test Worker secret-name preflight (`wrangler secret list`) | PASS; names/types only, no values printed |
| Test-only HMAC provisioning | PASS; five independent random values uploaded directly, none printed or written locally |
| Test D1 remote migration | PASS, `0010`-`0015`; subsequent list: no migrations to apply |
| Test Worker deployment | PASS, version `7226f5e4-39e3-4d0b-bb31-7713df1b3b0c`, startup 23 ms |
| Identity-aware live smoke | PASS: bootstrap/no-credit, feature-parity capabilities, search, company, App Attest mutation rejection, Apple JWS controlled rejection |
| SEC fetcher | PASS, 15/15 tests |
| Legal site | PASS validation |
| iOS test, iPhone 17 Pro / iOS 26.2, parallel disabled | PASS, 188/188 tests |
| iOS unsigned generic Release build | PASS, Xcode 26.4.1 |
| Release-gate validation | PASS after this report update |

One prior parallel iOS rerun had a transient simulator clone launch denial. Earlier serial stabilization also exposed fractional ISO-8601 expiry parsing and account/UI fixture defects, which were corrected. The post-remediation exact-device serial run then exposed two final consistency issues: one account-status fixture still modeled welcome credits as monthly credits, and a delayed installation-auth usage refresh could capture its mutation generation after a later local watchlist update. The fixture now matches the four-bucket credit contract, and bootstrap captures the usage-generation baseline synchronously before suspension. The focused startup regressions passed 2/2, and the authoritative serial suite passed 188/188 with result bundle `/tmp/KabuyomiReleaseRuntimeAudit-20260711-1823.xcresult`. The first test deployment attempt was safely rejected before activation because Apple's library evaluated `jsrsasign` at Worker global scope; request-time loading fixed the incompatibility, focused Apple tests passed 66/66, and the next deployment succeeded. No result is reported for live Minimal/Standard/rotating/oracle, human review, TestFlight, real devices, StoreKit/Apple/AdMob consoles, or production migrations.

## 9. Security and privacy review

Security-sensitive fallbacks fail closed. Logs use hashes/suffixes and exclude raw questions, conversation text, source excerpts, device/network identity, Apple identity subjects/tokens, Apple JWS, transaction/operation IDs, session tokens, private keys, App Attest objects/assertions, and signatures. Account and session HMAC keys are independent. Test assertion injection exists only in DEBUG and release-binary inspection confirms its symbol is absent.

## 10. Backward-compatibility review

Old iOS billing fields remain safely accepted but are not authority. Legacy identity is migration evidence only. Existing paid/reward/welcome balances and ledger/purchase evidence are preserved through exact one-time transfer; no blind sum occurs. Account sign-out deletes only the local session. Until account recovery's external gate passes, consumable purchases retain verified-installation compatibility ownership; after activation, signed-in account ownership and matching `appAccountToken` are required.

## 11. Unresolved risks

- Account recovery code, test schema, and test HMAC configuration are present, but Apple Sign in capability/profiles, real identity/JWKS, StoreKit `appAccountToken`, physical device A/B, lost-device validation, and the App Review account-deletion gate are incomplete.
- Every external/live hard gate listed in `RELEASE_GATE_STATE.json` remains open.
- Remote-config lifecycle code and local tooling are present, but daily log/inspector alerts and the first human-reviewed test/production KV refresh are not configured or executed.
- The four public legal URLs still served their May revisions during the 2026-07-11 read-only check; all differed from the validated local July source and require a deliberate legal-site deploy/recheck.
- Test-only HMAC secrets are provisioned; external App Attest verifier, Apple Store Server credentials/notifications, and production SSV configuration remain unvalidated.
- The identity-aware remote smoke is intentionally read-only because CLI cannot generate real App Attest artifacts; authenticated mutation/chat canaries require a physical attested device and configured verifier.
- No live benchmark scores, latency distribution, human-review completion, archive/signing, TestFlight, or App Review evidence exists for this working tree.
- GitHub CI has not run because changes were not committed or pushed; repository protection remains an administrative task.

## 12. Rollback or disable procedure

Use fail-closed config/emergency flags for an actual incident without removing released features as a staging technique. The test rollout is complete; production still requires a reviewed rollout plan. If a canary fails, disable only the affected capability, preserve audit/dedupe/reservation/migration records, and forward-fix; never reset balances, entitlements, or principals.

## 13. releaseDecision

`releaseDecision: HOLD`

Not `LIMITED_BETA_READY` and not `SUBMIT_CANDIDATE`.
