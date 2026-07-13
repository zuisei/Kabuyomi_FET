# Full Product Discovery and Remediation Report

Status: authoritative implementation and release evidence

As of: 2026-07-13 JST

Evidence boundary: exact release candidate, local validation, recorded test runtime, completed production rollout evidence, and explicitly excluded physical-device/external-console checks

Authoritative companions: `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, and `RELEASE_GATE_STATE.json`

## Post-audit current-state update

The guarded July 12 rollout evidence remains valid as a point-in-time baseline. Production changed again on July 13: Worker `e60580e7-e7f5-449d-97b2-d36854c24896` now serves candidate `ff298a10` at 100%, and config `production-capabilities-restored-20260713-v1` enables billing, consumable purchases, rewarded credits, and rewarded SSV while leaving account recovery disabled. KV and D1 LKG readback agree. The deployed bindings include numeric `APPLE_APP_ID=6762764426`, and invalid Apple signed data reaches configured signature verification.

Candidate `ff298a10` extends the verifier/migration repair with one-time invalid-key rotation for the same strict bootstrap identity. A physical production Release canary completed attestation, assertion, reward intent, genuine AdMob SSV, return navigation, and exact +2 balance application. StoreKit/TestFlight and App Store notification-delivery remain open. Its identity-only delta has 77/77 Worker files and 1,130/1,130 tests green; the release owner explicitly waived rerunning answer quality once, so the accepted 150-row/150-review packet remains bound to `56c0c209` and the normal deploy guard stays blocked until refreshed.

## 1. Starting commit

The remediation started from commit `b61602ef55e2499cccd46e32f53e29bb61c83aa7` on `main`. That commit is the audit snapshot and the last committed baseline. Claims in older phase and RC reports were treated as hypotheses and rechecked against the working tree, deployed runtime, migrations, configuration, tests, and visible iOS product.

## 2. Starting working-tree state

The starting tree was already dirty and contained a large, intentional, uncommitted remediation spanning Worker routes and Durable Objects, additive migrations, iOS identity/startup/billing/UI changes, shared catalog data, legal pages, CI workflows, testbench tooling, smoke scripts, and phase reports. No clean-baseline assumption was made and no unrelated user change was reset.

The starting production runtime was behind the working tree. The production Worker record was `78971adf-324f-4d27-8f06-b18fd95d81ae`; production D1 had not yet applied migrations `0010`-`0017`. The dedicated test D1 later applied `0010`-`0017`, while deployed test Worker version `42bc4f6b-8254-4f7f-8434-a7360e942b3d` still predates the final local candidate at the time of this draft.

## 3. Repository areas inspected

Inspection covered:

- `ios/`: app startup, identity storage, API signing, StoreKit, account recovery, credit/subscription/reward UI, company/search/conversation surfaces, local persistence, entitlements, privacy manifest, project generation, unit tests, and exact Simulator evidence;
- `workers/`: routing, identity, App Attest, Durable Objects, request execution, quotas, credit ledger/repair, billing, subscriptions, Apple verification/notifications, AdMob SSV, remote config, SEC ingestion/caching, AI orchestration, numeric/source validation, logging, scripts, smoke tests, testbench, Wrangler configuration, and all unit tests;
- `workers/d1/migrations/`: ordered schema history `0001` through `0018` plus remote apply state;
- `sec-fetcher/`: SEC retrieval and parsing tests;
- `legal-site/`: privacy, terms, support, commercial disclosure, index, app-ads, validation, and live revision drift;
- `shared/`: product catalog and cross-surface copy/limit authority;
- `.github/`: pull-request CI, live test benchmark, and remote-config lifecycle monitor;
- `docs/`, `artifacts/`, and `scripts/`: current truth, stale/contradictory reports, audit screenshots, rollout runbooks, gate validators, and production backup evidence;
- current git status/history, test/runtime commands, Cloudflare deployment/migration/config evidence, and observable iOS Simulator screens.

## 4. Complete feature matrix

Classification values are restricted to the required enum: `USER_AVAILABLE_PRODUCTION`, `USER_AVAILABLE_TEST_ONLY`, `IMPLEMENTED_CAPABILITY_DISABLED`, `IMPLEMENTED_NOT_CONNECTED`, `PARTIALLY_IMPLEMENTED`, `TESTED_ONLY`, `DEPLOYED_NOT_EXTERNALLY_VERIFIED`, `BROKEN_OR_REGRESSED`, `NOT_IMPLEMENTED`, and `STALE_DOCUMENTATION_ONLY`.

The matrix describes the post-rollout evidence state. “Production” means the remediated Worker is live; corrected iOS surfaces remain locally validated until a signed build is distributed.

| # | Domain | Classification | Code paths | Tests | Migration | Config dependency | iOS exposure | Test Worker exposure | Production Worker exposure | External/user evidence | Defect and required action |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ticker search and company navigation | USER_AVAILABLE_PRODUCTION | `routes/search.ts`, `routes/company.ts`, `lib/company/*`, `lib/pipeline.ts` | `ticker-routes`, `pipeline`, `sec` | Existing `0001`-`0009` data | SEC refresh/model emergency controls | `SearchView`, `CompanyView` | Read smoke exists | Core route deployed | Users can search/open without saving | Preserve; final production read smoke required |
| 2 | watchlist and recent companies | USER_AVAILABLE_PRODUCTION | `watchlist-*`, `history-store`, local Core Data | `history-*`, `AppModelTests`, persistence tests | Durable Object/local schema | Plan stock limits | `CompanyLibraryDrawer` | Test round-trip covered | Core feature deployed | Saved and recent navigation observable | Candidate empty-state polish must ship |
| 3 | filing retrieval and caching | USER_AVAILABLE_PRODUCTION | `filings/*`, `sec-fetcher-service`, R2/D1 cache | `filing-cache`, `ingest`, `content-upgrade` | Existing cache tables | Extractor version, SEC refresh switches | Company timeline/loading | Cached-company smoke | Core feature deployed | 10-K/10-Q reads observable | Verify final cache read after deploy |
| 4 | historical filings and comparisons | USER_AVAILABLE_PRODUCTION | `history-persistence`, `historical`, filing aliases | `historical-chat`, `history-persistence`, `latest-filing` | Existing history metadata | Extractor and refresh config | Filing picker/summary drawer | Covered by route/unit evidence | Existing production feature | Current/older filing navigation available | Final production regression smoke |
| 5 | source display and SEC navigation | USER_AVAILABLE_PRODUCTION | source assets, company response, source validation | `filing-source-assets`, `company-response`, `chat-source-validation` | None new | Web supplement remains off | `CompanySourceSupport`, `CompanyMessageRow` | Source payload exercised | Existing production feature | Source cards and SEC links visible | Keep URL/source validation strict |
| 6 | AI question answering | USER_AVAILABLE_PRODUCTION | `routes/chat.ts`, orchestrator, providers, grounding | `chat-route`, `pipeline`, provider tests | Durable Object state | `chatEnabled`, model/prompt version | Composer/timeline | Test automation and benchmark paths exist | Existing production chat available | Filing-grounded Japanese answers observable | Deploy hardened metering/validation candidate |
| 7 | follow-up context | USER_AVAILABLE_PRODUCTION | `context-pack`, `historical`, intent/usecase | context, factual-pack, historical tests | Request history in Durable Object | Chat/model config | Conversation timeline | Testbench contains follow-ups | Existing production feature | Conversation context is user-visible | Preserve context fingerprinting on deploy |
| 8 | numeric validation | USER_AVAILABLE_PRODUCTION | `verified-financial-facts`, `material-numeric-claims`, `numeric-alignment`, formatter | `numeric-alignment`, `sec-metrics`, benchmark quality | None | Extractor `v9` and chat enabled | Receives finalized safe answer | Exact 150-row candidate gate | Candidate deployed to production | Typed-fact reconciliation and 150/150 review pass | Monitor without template overfitting |
| 9 | source-ID validation | PARTIALLY_IMPLEMENTED | `source-validation`, `source-gate`, response finalizer | source validation/gate, benchmark quality | None | Chat enabled | Source IDs rendered | Local and older test evidence | Older validation deployed | Source evidence exists, final strict path not current | Deploy and require zero invalid IDs in live gate |
| 10 | fallback behavior | USER_AVAILABLE_PRODUCTION | evidence/fallback response, deterministic answer paths | fallback, language, route-policy tests | None | Chat/model availability | Japanese fallback rows | Exercised locally/testbench | Existing fallback deployed | Honest source-backed fallback visible | Preserve zero-charge release semantics |
| 11 | quote translation | USER_AVAILABLE_PRODUCTION | `routes/translate-quote.ts`, provider fallback | quote translation/provider tests | Request state in Durable Object | Model/chat emergency gate | Company quote action | Test release smoke covers | Existing production route | User feature exists | Deploy corrected always-metered path |
| 12 | request idempotency | USER_AVAILABLE_PRODUCTION | `request-execution.ts`, `request-fingerprint.ts`, chat/quote routes | fingerprint, route, user-quota concurrency | Durable Object schema-less state | None beyond route gates | Stable operation IDs | Test release smoke replay/conflict/concurrency pass | Exact candidate deployed | Adversarial local and remote evidence green | Monitor conflict/pending rates |
| 13 | model-result replay | USER_AVAILABLE_PRODUCTION | immutable execution result/cache and route replay | response-loss, duplicate begin/complete tests | Durable Object state | Model config independent after completion | Transparent to UI | Exact replay passes remotely | Exact candidate deployed | Stable stored result and current usage verified | Monitor replay cache expiry |
| 14 | credit reservations | DEPLOYED_NOT_EXTERNALLY_VERIFIED | `user-quota.ts`, request execution, credit operation | 10-way concurrency, exact allocations, commit/release | Durable Object state | Metering independent of StoreKit flags | Credits UI consumes authoritative usage | Full Worker suite green | Candidate `ff298a10` deployed | Production smoke preserves aggregate balances; live contention drill remains open | Monitor reservation metrics and run a controlled contention canary |
| 15 | reservation expiry and recovery | DEPLOYED_NOT_EXTERNALLY_VERIFIED | alarm/lazy expiry in `user-quota.ts` | orphan, expiry, duplicate release/commit tests | Durable Object state | Fixed reservation TTL | Recovery messaging | Full Worker suite green | Candidate `ff298a10` deployed | No permanent local orphan in tests; live expiry drill remains open | Verify alarm/lazy-expiry metrics in production |
| 16 | free welcome credits | DEPLOYED_NOT_EXTERNALLY_VERIFIED | installation bootstrap/attest and quota grant | identity, index, user-quota, catalog tests | `0012`, `0015`, `0016`, `0018` | Verified App Attest installation + free-grant emergency switch | Credit onboarding/copy | Unsupported identity gets zero | App Attest verifier and key storage deployed | Physical attestation/assertion passed; a fresh welcome-grant canary remains open | Verify exactly-once 50-credit grant on a fresh production installation |
| 17 | paid credits | USER_AVAILABLE_PRODUCTION | quota buckets, purchase records, refund debt | user-quota, liability, purchase/refund tests | `0017` plus existing purchases | New grants enabled only through Apple verification; spending remains metered | Credits balance UI and purchase surface | Existing balance paths plus tests | Existing balances are production liabilities; purchase route is active | Existing credits remain spendable and pre/post liability projection is equal | Complete StoreKit transaction and refund lifecycle evidence |
| 18 | subscription credits | DEPLOYED_NOT_EXTERNALLY_VERIFIED | entitlement DO, billing sync, stable principal | entitlement, billing, principal tests | `0010` | Billing enabled; Apple proof still required | Subscription/credit UI exposed by capability | Simulation/local evidence | Grant path production-enabled | No two-device current-candidate proof | Complete StoreKit lifecycle evidence and reconcile results |
| 19 | rewarded-ad credits | USER_AVAILABLE_PRODUCTION | reward intents/status, SSV, quota lots | AdMob duplicate/signature/cap/expiry tests | Existing reward records | Ads + reward + SSV + App Attest + no emergency | Reward card visible when runtime prerequisites pass | Test simulation plus signed physical Release canary | Production capability enabled | Genuine Google SSV granted exactly +2; duplicate, late, and cap canaries remain open | Run the remaining adversarial Google callback scenarios |
| 20 | purchase verification | IMPLEMENTED_EXTERNAL_EVIDENCE_OPEN | credit purchase route, Apple server client/signed data | Apple server/signed-data/purchase tests | Purchase tables + `0017` | Billing/consumable flags, credentials, bundle ID, numeric Apple app ID | StoreKit completion exposed | Invalid/simulated paths | Production Apple signature verifier active | Candidate `ff298a10` deployed; no current sandbox/TestFlight packet | Validate Apple lifecycle and reconcile grants/refunds |
| 21 | refunds and revocations | DEPLOYED_NOT_EXTERNALLY_VERIFIED | notification transitions, entitlement and refund accounting | notification, entitlement, user-quota refund debt tests | `0011`, `0017` | Billing/notification readiness | Usage reflects server state | Local simulation | Runtime deployed for active billing | No real refund/reversal delivery packet | Exercise sandbox/console and reconcile ledger |
| 22 | App Store Server Notifications | DEPLOYED_NOT_EXTERNALLY_VERIFIED | `apple-notifications-v2.ts`, signed-data verifier | notification ordering/replay/JWS tests | `0011` | Apple environment/credentials, numeric Apple app ID, and endpoint | No direct surface | Invalid JWS controlled rejection | Endpoint deployed with `APPLE_APP_ID` and signature verification | Configured verifier rejects invalid JWS; no real console delivery yet | Confirm App Store Connect delivery and reconcile valid signed events |
| 23 | appAccountToken ownership | IMPLEMENTED_CAPABILITY_DISABLED | account recovery, purchase binding, API client/StoreKit | account recovery/purchase mismatch tests | `0014` | `accountRecoveryReady` + account HMACs | StoreKit supplies stable token only when ready | Local tests | Disabled | No real StoreKit token proof | Validate matching/mismatch on two devices |
| 24 | Sign in with Apple recovery | IMPLEMENTED_CAPABILITY_DISABLED | account session/recovery and migration routes | account recovery/principal migration/API tests | `0014` | Apple identity/JWKS, account HMACs, capability false | Recovery card hidden | Local/test-disabled rejection | Disabled | Capabilities/profiles/device A-B absent | Complete account/deletion and recovery evidence |
| 25 | installation identity | USER_AVAILABLE_PRODUCTION | `installation-identity.ts`, bootstrap/challenge routes | installation identity/index/API tests | `0012`, `0016`, `0018` | Five independent HMAC secrets | `DeviceIdentityStore`, `APIClient` | Final identity smoke passes | Five production HMAC authorities installed; candidate deployed | Physical production App Attest and same-principal invalid-key recovery pass | Expand reinstall, reset, and replay coverage |
| 26 | Keychain persistence | TESTED_ONLY | `DeviceIdentityStore.swift` | API/startup/AppModel tests | Local Keychain only | Release vs DEBUG behavior | Credential retained across local reset | iOS local tests | App binary candidate not shipped | Simulator unit evidence | Verify physical reinstall/reset expectations |
| 27 | App Attest | USER_AVAILABLE_PRODUCTION | challenge, built-in Apple-root attestation/assertion verifier | identity replay/path/body/counter, synthetic assertion, and official Apple vector tests | `0012`, `0016`, `0018` | Apple App Attest service plus exact Team/App/build/environment metadata | Debug targets test; Release targets production | Signed artifacts, synthetic ECDSA assertion, and Apple's published attestation vector pass | Candidate `ff298a10` and verifier key storage deployed | Physical production attestation/assertion and one stored production key pass | Expand fresh-install, reinstall, and adversarial replay matrix |
| 28 | challenge and assertion replay protection | USER_AVAILABLE_PRODUCTION | consumed challenge, expected client-data hash, Apple public-key verification, assertion counter | replay, expiry, wrong path/body, signature, App ID, counter tests | `0012`, `0016`, `0018` | Built-in App Attest verifier | API client binds method/path/body | Local focused and cryptographic tests pass | Candidate `ff298a10` deployed | Assertion-protected production reward intent passed; broader replay canary remains open | Run remote replay/path/body/counter adversarial checks |
| 29 | legacy identity migration | DEPLOYED_NOT_EXTERNALLY_VERIFIED | installation/account/principal migration code | repeated migration/conflict/tombstone tests | `0010`, `0014`, `0015`, `0016`, `0018` | Internal auth plus grant emergency controls | Automatic after bootstrap/sign-in | Test smoke green | Production schema and same-principal key rotation deployed | Invalid App Attest key rotation preserved principal and balances; broader account migration remains open | Exercise the remaining physical legacy/account migration matrix |
| 30 | remote config | USER_AVAILABLE_PRODUCTION | strict envelope, KV/D1 LKG, inspector/refresh script | config/lifecycle/index tests | `0013` | Reviewed typed envelope, 14/35/45 lifecycle | Usage capabilities gate UI | Test envelope read back | Production KV/D1 LKG hash-match and fresh | Mixed-version cutover completed | Operate daily lifecycle monitor |
| 31 | emergency kill switches | DEPLOYED_NOT_EXTERNALLY_VERIFIED | index route gate, config overrides, scheduled gates | emergency controls/index/internal eval tests | None | Environment overrides + remote flags | Disabled states | Local/test coverage | Candidate deployed with active paid/reward flags and emergency overrides available | No full production incident drill | Drill each affected class and prove grants stop without balance loss |
| 32 | fail-closed behavior | DEPLOYED_NOT_EXTERNALLY_VERIFIED | `SAFE_FAIL_CLOSED_CONFIG`, capability rejection | missing/malformed/stale/type tests | `0013` LKG | Complete strict envelope required | UI hides/blocks mutation | Local/test failure evidence | Final strict code deployed; invalid billing paths smoke green | KV/D1 outage drill not run live | Schedule controlled outage/stale drill |
| 33 | production logging and redaction | DEPLOYED_NOT_EXTERNALLY_VERIFIED | logging/metrics and route diagnostics | logging, chat diagnostics, Apple/index redaction tests | Audit tables store digests only | Production compact diagnostics | Local logs avoid content | Test evidence | Final candidate deployed | Smoke prints no credentials, identifiers, content, JWS, or signatures | Inspect sampled retained logs operationally |
| 34 | iOS startup behavior | TESTED_ONLY | `AppModel`, `AppRootView`, API/identity store | `StartupAuthenticationTests`, AppModel/API tests | None | Server capability and auth status | Local-first, bounded retry, manual retry | Uses public/search and identity routes | Corrected client not shipped | Simulator behavior/tests and screenshots | Ship build; physical offline/maintenance pass |
| 35 | credits UI | IMPLEMENTED_EXTERNAL_EVIDENCE_OPEN | `CreditView`, usage models, subscription store | AppModel/API/copy tests | None | Billing/reward/account capabilities plus complete verifier metadata | Purchase, subscription, restore, and reward surfaces exposed by live capabilities | Reads test usage | Live payload and executable Apple verifier agree | Candidate deployed; no TestFlight transaction packet | Verify signed-build transactions |
| 36 | subscription UI | DEPLOYED_NOT_EXTERNALLY_VERIFIED | `CreditView`, `SubscriptionStore` | AppModel/StoreKit diagnostics tests | None | `creditBillingEnabled=true` | Product loading/purchase/restore enabled | Disabled-response tests still preserved | Production capability enabled | No current sandbox proof | Complete StoreKit/TestFlight evidence without hiding the active surface |
| 37 | rewarded-ad UI | USER_AVAILABLE_PRODUCTION | reward service/config and `CreditView` | AppModel reward visibility/return tests | None | ads/reward/SSV/App Attest/environment | Card remains visible through temporary attestation recovery; action remains server-gated | Test simulations plus signed physical Release canary | Production capability enabled | Genuine ad display, Google SSV, return navigation, and exact +2 refresh pass | Validate duplicate, late, cap, and additional device states |
| 38 | recent conversation UI | TESTED_ONLY | `CompanyLibraryDrawer`, timeline/context card | `ConversationPromptTests`, AppModel tests | Local persistence | None | Explicit empty/recent state | Client-only | Corrected client not shipped | Simulator screenshot `13-recent-conversation-empty.png` | Ship and manual TestFlight review |
| 39 | drawer search | TESTED_ONLY | drawer cleanup + `SearchView` | AppModel/navigation tests | None | None | One dedicated search path | Client-only | Corrected client not shipped | Simulator screenshot evidence | Ship and manual navigation review |
| 40 | legal pages | USER_AVAILABLE_PRODUCTION | local July HTML and validator | legal `npm run validate` | None | Pages deployment | In-app legal links | Local pages validate | Pages deployment `cf7a3e20` | Five live URLs match local hashes | Keep revision synchronized |
| 41 | App Review consistency | PARTIALLY_IMPLEMENTED | submission notes, catalog/legal/privacy copy | shipping truth/catalog/legal validation | None | Must match actual enabled flags | Runtime surfaces are enabled but older notes still describe disabled state | Local artifact only | No submitted build evidence | No reviewer session | Update submission packet from the exact uploaded build and active config |
| 42 | CI and required checks | USER_AVAILABLE_PRODUCTION | three workflows and gate scripts | PR #16 passed all nine required jobs | None | GitHub branch protection active | Build/test jobs defined | Live benchmark protected by secret | Not a runtime feature | `main` requires nine checks, one approval, conversation resolution, admin enforcement | Keep checks current and retain force-push/deletion blocks |
| 43 | test migrations | USER_AVAILABLE_TEST_ONLY | ordered SQL `0010`-`0018` | D1 migration validator/tests | `0010`-`0018` applied | Test D1 binding | Indirect | No pending reported after apply | Not production | Remote test schema evidence | Recheck immediately before the next test deploy |
| 44 | production migrations | USER_AVAILABLE_PRODUCTION | ordered SQL `0010`-`0018` | migration tests/validator | `0010`-`0018` applied | Maintenance bridge used | Indirect | Test schema compatible | Production no-pending and App Attest key schema probe pass | Pre/post balances equal | Retain backup and forward-repair only |
| 45 | test deployment parity | PASS_PRIOR_QUALITY_CANDIDATE | candidate `56c0c209` and test config | 77/1,129 local; smoke scripts | Test `0010`-`0018` applied | Test strict envelope | iOS Debug is build-pinned to test | Version `3f377477...`; identity/release and physical development attestation pass | Not applicable | Prior quality candidate deployed and verified | Production hotfix `ff298a10` validated by unit/physical production canary under the documented waiver |
| 46 | production deployment parity | PASS_WITH_DOCUMENTED_ONE_TIME_QUALITY_WAIVER | final Worker + production smoke/runbook | 77/1,130 and active-capability smoke | Production `0010`-`0018` applied | Strict nested config plus required runtime vars | Expiring released-client bridge | Identity hotfix green; prior quality candidate retained | Version `e60580e7...` at 100% with `APPLE_APP_ID` and App Attest verifier | App Attest and genuine SSV canary pass | Complete StoreKit/notification lifecycles and refresh exact-candidate quality |

## 5. User-available production features

Current users can use the core product: ticker search, company opening without saving, watchlist and recent companies, SEC 10-K/10-Q retrieval, current and older filing navigation, comparisons, filing summaries, source cards and SEC navigation, filing-grounded Japanese Q&A and follow-ups, conversation history, quote translation, and safe fallback answers. Existing purchased/reward/subscription/welcome balances remain liabilities and are spendable under authoritative usage accounting.

These are production capabilities of the remediated Worker runtime. Corrected iOS presentation remains a validated unsigned candidate until distribution evidence exists.

## 6. Test-only features

The dedicated test environment and local test automation cover server installation identity, unavailable-App-Attest zero-credit bootstrap, safe capability payloads, public search/company reads, watchlist round trip, exact replay, changed-payload conflict, concurrent duplicates, quote translation, controlled invalid Apple JWS, strict reward intent gating, and simulation-only billing/reward paths. Secret-backed automation is accepted only when both declared environments are exactly test.

The final working-tree candidate is deployed to the dedicated test Worker and passed identity/release smokes plus the balanced 150-row Standard Release gate.

## 7. Disabled capabilities

The current runtime keeps the following implemented capabilities disabled or unavailable:

- new welcome grants without verified App Attest;
- Sign in with Apple recovery and account migration;
- `appAccountToken` ownership mode;
- production internal evaluation grants;
- web supplement and scheduled refresh unless explicitly enabled;
- any billing/account/reward path during `emergencyPaidGrantsDisabled`.

Paid consumables/subscriptions and rewarded-credit intent/UI/SSV are no longer on this disabled list. They are production-enabled with incomplete external lifecycle evidence. Disabled means unavailable at runtime, not merely missing a test packet.

## 8. Disconnected implementations

No remaining disconnected implementation is intentionally presented to users. Apple account recovery and `appAccountToken` recovery ownership remain disconnected from user exposure. StoreKit purchasing/subscription remains connected and production-enabled with its external lifecycle open. App Attest and one genuine AdMob SSV grant are physically verified; broader replay/duplicate/late/cap matrices remain follow-up coverage. GitHub CI and branch protection now have live evidence. Legal Pages are live and hash-matched.

## 9. Defects discovered

Discovery identified these material defects beyond the originally reported startup alert:

- StoreKit capability disablement selected `legacy_chat` or an unmetered quote mode, allowing model work without credits;
- the currently shipped UUID-only client would be rejected by a hard cutover to installation credentials;
- the internal evaluation-credit route could bypass maintenance/config grant disablement;
- startup authentication failure produced an overly blocking experience and could strand cached content;
- installation tokens lacked complete expiry/rotation/revocation and assertion counter/client-data binding;
- request operation IDs did not prove immutable canonical payload identity across all model paths;
- model execution and credit mutation were not an atomic leader/reservation state machine;
- consumable refunds lacked debt accounting for already-spent purchases and exact reversal restoration;
- subscription ownership and period grants could depend on unstable client/device identity;
- remote config accepted incomplete permissive deployed payloads and storage freshness could be misrepresented;
- material numeric claims were not all reconciled against typed fact metadata;
- recent-conversation empty state and drawer search contained dead/ambiguous UI state;
- active reports contradicted current runtime and external verification status;
- test and production deployments were behind the final working tree;
- live legal pages were older than validated local copy;
- GitHub required checks/ruleset were not connected.

## 10. Defects fixed

The working tree fixes the code-addressable defects:

- every non-`dev_unlimited` chat and quote request now reserves credits regardless of billing-UI flags;
- new `legacy_chat` reservations are rejected; old completed replay remains readable;
- a strict, expiring, production-only shipped-client bridge preserves core routes with zero grants;
- internal evaluation grants honor the paid-grant/maintenance gate before identity or Durable Object mutation;
- startup is local-first, uses bounded retry, manual retry, one non-blocking status, and no repeated dialog;
- installation credentials have 90-day expiry, 14-day rotation, revocation, principal/reference binding, and replay counters;
- operation fingerprints bind route, filing, question/text, and conversation context before mutation/model work;
- RequestExecution elects one provider leader and atomically reserves/commits/releases exact credit buckets;
- refund debt and refund reversal accounting are idempotent and auditable;
- subscription and account principals use independent HMAC authorities and verified Apple identifiers;
- strict remote config requires a complete dated envelope, bounded LKG, emergency precedence, and lifecycle monitoring;
- numeric claims are reconciled against typed facts including unit, scale, sign, currency, and period;
- Recent has an explicit empty state and drawer search uses `SearchView` only;
- authoritative docs now distinguish implemented, deployed, externally verified, and user-available states;
- GitHub now enforces the nine required CI checks, one approval, conversation resolution, and admin protection on `main`.

## 11. Architecture changes

The principal request flow is now:

`authenticated principal -> canonical fingerprint -> atomic begin/reserve -> one provider leader -> complete/commit OR fail/release -> immutable replay`

Identity is:

`server bootstrap -> Keychain token -> optional App Attest challenge/attestation -> path/body-bound assertion -> verified installation grant eligibility`

Legacy transition is:

`shipped UUID core bridge -> server installation bootstrap -> one-time exact quota migration -> legacy mutation tombstone`

Billing is:

`Apple signed-data verify -> stable HMAC subscription/account principal -> entitlement/ownership transition -> idempotent period or purchase grant`

Numeric answer finalization is:

`selected SEC sources -> typed verified fact pack -> model/deterministic answer -> material claim extraction -> unit/scale/sign/period/source alignment -> pass, repair, or safe block`

Remote configuration is:

`strict KV envelope -> bounded D1 LKG -> safe_fail_closed`, with environment emergency overrides applied last.

## 12. Migrations added

The remediation adds eight additive migrations:

- `0010_subscription_authority.sql`: stable subscription entitlement index, bindings, and migration manifests;
- `0011_app_store_notifications.sql`: notification dedupe, ordering, and minimal verified audit metadata;
- `0012_installation_identity.sql`: server installation principals, bootstrap limits, and App Attest challenges;
- `0013_remote_config_lkg.sql`: dated last-known-good configuration;
- `0014_account_recovery.sql`: account principals, device bindings, and paid-credit account migration;
- `0015_installation_principal_migration.sql`: one-time legacy-device to installation migration;
- `0016_identity_replay_and_migration_safety.sql`: token expiry/revocation, assertion counter, unique attestation key, and expected client-data hash;
- `0017_consumable_refund_accounting.sql`: refund debt, removal, reversal, notification linkage, and purchase-state index.

They are forward-only and non-destructive. Rollback uses capability disablement and forward repair, never balance/principal table deletion.

## 13. Migrations applied to test

Dedicated test D1 applied `0010` through `0017` in order. A post-apply migration listing reported no pending migrations. Local filename/order/schema validation also passes for all 17 migrations (`0001`-`0017`).

## 14. Migrations applied to production

Production D1 was freshly exported before mutation to `/Users/0xt4/.codex/backups/Kabuyomi/2026-07-12-production-remediation/kabuyomi-history-before.sql`, SHA-256 `e04e8d209c810b55fc641e8472c94ea28d3ece3c063bc0e5ef1c53bbf4dc50d5`. The legacy KV config was also backed up with SHA-256 `d6224ebb2efbd6e8f56cc0edec291b17dc0892994257ce6fefcf4cd239766904`.

The dated flat maintenance bridge was published, semantically read back, and live `/v1/search` returned maintenance HTTP 503 before schema work. Migrations `0010` through `0017` then applied in dependency order; the remote listing reported no pending migrations. Table and `purchase_transactions` refund-column probes pass.

Pre/post projection is exactly unchanged: 140 principals, 7,602 total credits, 6,390 monthly, 1,188 purchased, 24 rewarded, 742 ledger rows, 11 purchase rows, and 1,000 granted purchased credits.

## 15. Authentication behavior

Production authority is a server-signed installation token plus matching opaque principal and token reference. Tokens expire after 90 days and rotate after 14 days. A 401 clears only the rejected credential and permits one rebootstrap; local companies, filings, and conversations remain intact.

Public search does not require identity. Safe company/read paths accept the new credential or the narrowly authorized legacy bridge. Chat, quote, watchlist, and refresh require a valid principal; grant-producing routes require stricter verified state. Arbitrary device keys cannot mint a welcome balance. Test automation requires exact dual-test environment plus secret; mixed or production environment rejects it.

## 16. App Attest behavior

Supported devices register an App Attest key, obtain a short-lived purpose-specific challenge, and bind the assertion to nonce, method, path, body SHA-256, credential, and monotonically increasing assertion counter. Challenges are one-use and expiry-bound; wrong path/body, replay, expired challenge, duplicate key binding, and counter regression fail closed.

Unsupported App Attest receives safe core access with zero welcome credit. Temporary Apple/service failure degrades startup but never silently grants. Real-device production App Attest remains externally unverified; only a successfully verified installation can reach grant-producing paths.

## 17. Startup UX behavior

Startup loads local state first and does not immediately display a blocking alert when anonymous authentication or App Attest fails. It retries automatically with bounded delays, keeps public search and cached company/filing/conversation content available, disables authenticated credit mutations, and shows one non-blocking status only after repeated failure. Manual retry is available.

Failure classification distinguishes network unavailable, server maintenance/rate limit, App Attest unavailable/temporary, invalid credential, and permanent authentication failure. A rejected credential is rebootstrap-safe; a local reset does not manufacture another identity or credit grant.

## 18. Idempotency behavior

For the same operation ID and canonical payload, one leader performs provider work and later calls replay the immutable stored result with current usage. Same operation ID plus a different filing, question/text, conversation context, or route is rejected before model execution and credit mutation. A new operation reserves atomically before provider execution.

Concurrent exact duplicates return completed replay or bounded pending state. Response loss, duplicate completion, duplicate failure, and failure-after-completion are idempotent. Stored result expiry never re-elects a new provider leader for the same terminal operation.

## 19. Credit-reservation behavior

Reservation records exact source-bucket allocations. Ten parallel cost-two requests with only two credits admit one provider-eligible leader; twenty exact duplicates create one reservation. Commit deducts once. Release restores valid allocations once. Alarm and lazy expiry terminalize orphaned reservations and restore credit once.

FEFO applies to expiring monthly/promotional/reward lots; welcome and purchased balances follow the catalog order. Expired reward allocations are discarded rather than converted. Purchased credit is restored across monthly boundary. Disabled StoreKit UI never selects an unmetered model mode.

## 20. Subscription principal behavior

An Apple-verified `originalTransactionId` and environment derive one opaque HMAC subscription principal. Device bindings are bounded audit evidence, not quota authority. The client cannot set entitlement active. Read-time expiry and verified terminal notification transitions stop entitlement even when the client is silent.

One period identifier grants once across retries or devices. Upgrades, downgrades, same-period changes, expiry, revocation, refund, and out-of-order events are modeled and locally tested. Account recovery uses a separate Apple-subject HMAC principal and stable `appAccountToken`; it remains disabled until real two-device proof.

## 21. Apple notification behavior

The V2 endpoint verifies the Apple certificate chain and JWS, bundle ID, environment, signed date, transaction/renewal payload, and notification UUID. It stores only payload digest and minimal routing/audit metadata. Duplicate UUIDs are idempotent. Older signed events cannot overwrite a newer entitlement transition.

Supported events propagate verified renewal, expiry, revoke/refund, refund reversal, and relevant one-time-charge state. `CONSUMPTION_REQUEST` is acknowledged without inventing consumption data. Invalid JWS is rejected without grant. Real App Store Connect delivery remains unverified and disabled operationally.

## 22. Rewarded-ad behavior

The card and reward intent require trusted `adsEnabled`, `rewardedCreditEnabled`, and `rewardedSsvReady`, the production environment and ad unit, verified identity/App Attest, and no emergency disable. Those config capabilities are currently enabled. Google AdMob SSV remains the sole grant authority.

Custom data binds the intent, principal, ad unit, and environment. Signature failure, wrong custom data, duplicate transaction, expired intent, or daily cap cannot grant. A valid grant is 2 credits, capped at 3 per JST day, expiring after 30 days. Late SSV can still update authoritative status within its valid window; completing a client ad alone grants nothing. Production SSV is enabled, but a genuine callback/duplicate/late/cap evidence packet remains missing.

## 23. Numeric-validation behavior

The answer pipeline now carries typed facts with raw value, currency, unit, scale, period start/end, fiscal quarter/year, form, sign, source ID, source URL, and comparison baseline. Deterministic derived margins preserve provenance.

Material answer claims are extracted independently of formatting and reconciled for magnitude, unit/scale, currency, period, sign, percentage, and source support. Unsupported or mismatched claims are repaired or blocked into an honest fallback. Regression tests cover ten-times/one-tenth scale, currency, period, sign, percentage, unsupported claim, and invalid source ID cases. The exact candidate passed a balanced Q01-Q10 run across 15 companies: 150 rows, 0% fallback, every correctness/evidence/taxonomy counter zero, p95 5,049 ms, and complete 150/150 human review.

## 24. Remote-config behavior

Deployed config must be complete, typed, dated, and catalog-compatible. Missing JSON, malformed fields, wrong types, unsupported model/extractor values, incomplete capabilities, or stale envelopes do not inherit permissive defaults. A valid D1 LKG may be used only within the original authored lifetime; reads never renew `updatedAt`.

The lifecycle is review-due at 14 days, critical at 35, and hard fail-closed at 45. Legacy compatibility independently expires in at most 30 days. Environment emergency overrides disable chat/model, free grants, paid/subscription grants, rewards, external context, SEC refresh, background work, and migration/evaluation grants.

The rollout followed the mixed-version guard: complete dated flat maintenance bridge, observed live 503, schema apply, new Worker at 100%, then strict nested envelope. Current config `production-capabilities-restored-20260713-v1` is fresh and identical in KV and D1 LKG; it enables billing, consumables, rewarded credits, and rewarded SSV, leaves account recovery disabled, and turns the paid-grant emergency stop off. Legacy compatibility expires at `2026-08-11T14:14:00.000Z`.

## 25. iOS and UI corrections

The candidate:

- removes the blocking startup-authentication dialog;
- adds bounded automatic retry, a non-blocking status, and manual retry;
- preserves cached company/filing/conversation access and public search while mutations are unavailable;
- stores/rotates server installation credentials in Keychain;
- consumes server capability states for billing, reward, and account surfaces;
- continues metering based on authoritative credits even when StoreKit UI is disabled;
- aligns Free/Lite/Pro/Max, one-time welcome, limits, and credit buckets with the shared catalog;
- hides unverified subscription, consumable, reward, and recovery actions;
- adds an explicit Recent-conversation empty state and removes the unused competing empty state;
- routes drawer search through the dedicated Search screen;
- polishes company/chat/search/credit/filing surfaces for dark appearance, Dynamic Type, accessibility, loading/error states, and Reduced Motion.

The exact serial Simulator suite passed on iPhone 17 Pro / iOS 26.4, and 13 current-run audit screenshots were personally reviewed.

## 26. Test results

| Gate | Result |
|---|---|
| Worker full suite | PASS, 77/77 files and 1,130/1,130 tests; 0 failed |
| Worker typecheck | PASS, 0 errors |
| Worker quality-gate unit suite | PASS, 25/25 |
| D1 migration validation | PASS, 18 ordered files (`0001`-`0018`); remote test/production current with no pending migration |
| Testbench fixture validation | PASS, 5 default tickers / 12 templates |
| Last accepted quality candidate `56c0c209` | PASS, 15 tickers / Q01-Q10 / 150 rows / 0% fallback / 150/150 release-owner review. Candidate `ff298a10` used a documented one-time release-owner waiver for its identity-only delta; normal deploy guard remains blocked until refreshed. |
| Production release-smoke check-only | PASS target/credential/redaction preflight, no network |
| SEC fetcher | PASS, 15/15 |
| Legal source/live validation | PASS, revision `2026-07-11`, five live hashes match |
| iOS serial suite | PASS, 195/195, iPhone 17 Pro / iOS 26.4.1, result `Test-Kabuyomi-2026.07.13_0-51-10-+0900.xcresult` |
| iOS unsigned generic Release build | PASS |
| Git diff whitespace check | PASS at the last local gate checkpoint |

The accepted release artifact is `2026-07-12-full-product-remediation-v9-standard-r103`, source SHA-256 `5a356c74b86f632fade30a4ac1de2117b83f300fe5105f3fc1420fc510728bbd`, review-content SHA-256 `2a6ba39ff622459f9e9a4babd042d3026cdbdc3f8a44a52c61970d9dc90a73b8`.

## 27. Test Worker deployment

Test D1 is schema-current through `0018`, and the reviewed strict test config readback passed. Worker version `3f377477-74f2-419b-b4cf-cc703d8ffc84` serves exact candidate `56c0c209` at 100%. Identity/release smoke and physical development App Attest attestation pass.

## 28. Production Worker deployment

Production Worker `e60580e7-e7f5-449d-97b2-d36854c24896` serves candidate `ff298a10` at 100%. Active-capability production smoke passes, migration `0018` is applied, production App Attest and genuine SSV pass, and paid-credit liability remains 2,088 credits / ¥4,176.

The strict envelope and D1 LKG agree on `production-capabilities-restored-20260713-v1`, authored at `2026-07-13T01:20:28.597Z`, with billing, consumables, rewarded credits, and rewarded SSV enabled, account recovery disabled, and the paid-grant emergency stop off. The deployed binding list contains `APPLE_APP_ID=6762764426`. Active-capability smoke passes; a genuine AdMob callback granted exactly two credits, and read-only D1 evidence confirmed one production App Attest key with zero rows written by the verification query.

Pages deployment `cf7a3e20` completed. Index, privacy, terms, support, and commercial-disclosure URLs all serve revision `2026-07-11` and match local SHA-256 values.

## 29. External verification evidence

Evidence actually recorded:

- local Worker adversarial/unit/type/config/migration checks;
- exact iOS Simulator tests and current-screen visual audit;
- test D1 migration through `0017`;
- test strict-config readback;
- final test Worker identity and release smokes;
- SEC fetcher and legal-source validation;
- production D1/KV backups, migrations, schema probes, strict config KV/D1 LKG parity, billing-safe smoke, and exact pre/post balance reconciliation;
- final production Worker version and 100% deployment evidence;
- legal Pages deployment and five live hash matches;
- controlled rejection paths for invalid Apple JWS/SSV and disabled billing/account capabilities in code/tests and safe smoke design.
- PR #16 passing all nine GitHub CI jobs and enforced `main` protection requiring those checks, one approval, conversation resolution, and admin enforcement while blocking force-push and deletion;
- current production Worker and KV/D1 LKG readback for the July 13 capability activation.
- App Store Connect readback identifying Kabuyomi numeric app ID `6762764426`, full Worker suite, App Attest validation and same-principal invalid-key rotation coverage, test/production D1 application, signed physical-device build inspection, production App Attest/AdMob canary, and production deploy/smoke for candidate `ff298a10`; exact-candidate answer quality is the documented one-time waiver described above.

Not counted as external success: mocked Apple/Google callbacks, code existence, unit-test names, check-only smoke, prior quality runs against another Worker version, or disabled capability UI.

## 30. Remaining externally impossible checks

The available CLI/Simulator environment cannot itself produce or complete:

- physical-device production App Attest attestation/assertion, shared-network, reinstall, and device-replacement matrix;
- real Sign in with Apple capability/profile/JWKS flow, device A/B shared paid balance, sign-out, lost-device recovery, and account-deletion/App Review determination;
- StoreKit sandbox/TestFlight consumable purchase, subscription purchase/restore, upgrade/downgrade, duplicate-period, refund/reversal, and matching `appAccountToken` evidence;
- App Store Connect Server Notifications V2 endpoint delivery and delayed/out-of-order console scenarios;
- genuine production AdMob rewarded impression and Google SSV callback;
- signed archive, TestFlight installation, App Review session, and physical-device UI/accessibility checks.

Account recovery may remain disabled for the core release. Paid consumables/subscriptions and rewarded credits are already enabled, so their missing evidence is an active verification debt rather than a future activation gate. Their code paths, gates, and user messaging are present, but they must not be described as externally lifecycle-verified until their specific evidence is attached.

## 31. Final release decision

`releaseDecision: GO`

The core release may advance: candidate `ff298a10` is deployed with local/unit, production migration/config/smoke/balance, physical App Attest, and genuine AdMob SSV evidence green. The exact-candidate answer-quality rerun was explicitly waived once and remains intentionally unsatisfied in the normal deploy guard. StoreKit/TestFlight and notification delivery remain follow-up evidence; account recovery remains disabled. This decision records the active runtime truth without converting those missing lifecycles into a pass.
