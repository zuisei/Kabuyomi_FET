# PR-00 Baseline, CI, and Release Freeze Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-10 JST

Repository: `zuisei/Kabuyomi_FET`

Branch inspected: `main`

Audited and baseline commit: `b61602ef55e2499cccd46e32f53e29bb61c83aa7`

## 1. Conclusion

PR-00 is complete in the current working tree. The repository now has secret-free pull-request CI definitions for Worker, testbench, D1 migration ordering, SEC fetcher, legal site, iOS unit tests, and an unsigned iOS Release build. A separate manual workflow contains live test-Worker deployment and benchmarking behind a protected GitHub environment.

The original baseline was not green: Worker tests had three stale expectations, and `sec-fetcher` and `legal-site` could not run `npm ci` because lockfiles were missing. The test-only expectations were aligned with the already-current deterministic business-overview route, lockfiles were added, and the final local baseline is green.

No runtime behavior, billing data, entitlement state, identity state, production configuration, or migration state was changed. All six P0 findings remain open. Broad public and paid release remain `HOLD`.

## 2. Audit-claim verification table

The current tree exactly matched the audited snapshot before PR-00 edits. Each audit claim was checked against implementation and committed artifacts rather than accepted from prior documentation.

| ID | Verification | Current implementation evidence |
|---|---|---|
| KBY-P0-01 | Confirmed | `benchmark-quality.mjs` recognizes labels and suspicious text patterns but does not reconcile typed source facts. The r54 gate reports zero suspicious numeric displays while AAPL-Q05 contains the documented magnitude error. |
| KBY-P0-02 | Confirmed | `ChatRequestSchema` and `TranslateQuoteRequestSchema` accept caller operation IDs; `UserQuotaDO` keys credit operations by ID without a canonical payload hash or replayable execution result. |
| KBY-P0-03 | Confirmed | `preflightChatCharge()` reads affordability without reserving balance, and `commitChatChargeAfterGeneration()` runs only after provider work. |
| KBY-P0-04 | Confirmed | `billing-sync.ts` derives both binding and quota subject from the request device key; entitlement state stores that device-derived quota owner. |
| KBY-P0-05 | Confirmed | Public billing sync accepts `active`; `verifySubscriptionWithApple()` returns inactive without Apple verification when the client sends false; stored entitlement reads do not continuously enforce expiry. |
| KBY-P0-06 | Confirmed | `quota.ts` hashes arbitrary caller-supplied `x-device-key` values into free principals; no server-issued installation credential or attestation is required. |
| KBY-P1-01 | Confirmed | The quality gate contains known phrase, sector, and ticker-oriented regular expressions; there is no claim-to-source judge or rotating out-of-sample gate. |
| KBY-P1-02 | Confirmed | `DEFAULT_REMOTE_CONFIG` enables chat and ads and disables maintenance; KV read failure returns this enabled default instead of a durable last-known-good or fail-closed state. |
| KBY-P1-03 | Confirmed | Worker defaults and the Swift catalog treat Free 50 as a recurring monthly amount rather than a one-time welcome bucket. |
| KBY-P1-04 | Confirmed | Swift Lite uses `chatLimit: 10` while Worker Lite inherits the Free daily chat limit; product wording, monthly credits, saved-company limits, and fair-use limits are not derived from one catalog. |
| KBY-P1-05 | Confirmed | Release rewarded-credit visibility is compile-time enabled in `CreditView.swift`; the Release ad runtime permits production intents without a server-authoritative SSV-ready capability contract. |
| KBY-P1-06 | Confirmed | Apple server responses are fetched, then JWS payloads are decoded and compared, but local certificate-chain/root/signature verification and Server Notifications V2 processing are absent. |
| KBY-P1-07 | Confirmed | Consumable grants resolve the current device quota subject, so paid balance recovery remains device-principal dependent. |
| KBY-P2-01 | Confirmed | `ConversationLibraryDrawer` receives Recent and inline-search state, but `contentSections` renders only quick actions, saved companies, and starter companies; `searchSection` and Recent are not in the tree. |
| KBY-P2-02 | Confirmed | README says reset regenerates identity, while `AppModel.resetLocalData()` preserves `DeviceIdentityStore`; an iOS test verifies the same key remains. |
| KBY-P2-03 | Confirmed | Current documents conflict on rewarded-credit visibility and reset behavior; the repository had no automated shipping-truth drift check. |

## 3. Implementation summary

- Added pull-request CI with nine required check surfaces: repository sanity, Worker, Worker dry-run, testbench, D1 migrations, SEC fetcher, legal site, iOS unit tests, and iOS unsigned Release build.
- Pinned Node CI to 22.x because the locked Worker dependency graph requires Node 20.18.1 or newer.
- Pinned the iOS jobs to GitHub `macos-26`, Xcode 26.4.1, and a SHA-256-verified XcodeGen 2.45.4 archive because the source compiles iOS 26 APIs.
- Made the iOS test and Release build independent jobs, so one failure does not suppress evidence from the other.
- Added a `workflow_dispatch`-only live test-Worker benchmark using a protected `test-worker-benchmark` environment.
- Added a machine-readable release hold and validator.
- Added D1 migration filename/order validation plus unit coverage.
- Added reproducible lockfiles for dependency-free `sec-fetcher` and `legal-site` packages.
- Corrected three stale Worker test expectations without changing runtime code.
- Documented required branch protection, status checks, protected environments, and production-deploy freeze settings.

## 4. Files changed

- `.github/workflows/pull-request-ci.yml`
- `.github/workflows/live-test-worker-benchmark.yml`
- `docs/release/RELEASE_GATE_STATE.json`
- `docs/archive/v1/PR00_REPOSITORY_SETTINGS.md`
- `docs/archive/v1/PR00_BASELINE_AND_CI_REPORT.md`
- `scripts/validate-release-gate.mjs`
- `workers/package.json`
- `workers/scripts/validate-d1-migrations.mjs`
- `workers/test/d1-migrations.test.ts`
- `workers/test/pipeline.test.ts`
- `sec-fetcher/package-lock.json`
- `legal-site/package-lock.json`

## 5. Schema and migration changes

No D1 schema, Durable Object migration tag, table, index, or production/test binding was changed.

The nine existing D1 filenames are contiguous from `0001` through `0009`. CI now rejects malformed names, gaps, and empty SQL files. Migration `0007_monthly_grants_drop_user_period_index.sql` is an existing non-additive historical exception and was not rewritten. Remote applied-migration state remains unverified because no Cloudflare token was used, and no remote migration command was run.

## 6. State-machine or data-flow changes

No application state machine or runtime request data flow changed.

The CI-only flow is:

```text
pull_request
  -> secret-free repository and component checks
  -> no deploy and no remote migration

workflow_dispatch + protected test-worker-benchmark environment
  -> isolated test Worker deploy
  -> live 150-row benchmark
  -> retained benchmark artifacts
```

The live workflow uses `wrangler.test.toml`, not production `wrangler.toml`. It requires a pre-provisioned remote test Worker OpenAI secret and does not install that secret from pull-request CI.

## 7. Tests added or updated

- Added two migration-validator tests covering valid ordered files and malformed/gapped/empty migrations.
- Updated three `pipeline.test.ts` cases to assert the current deterministic business-overview path and zero provider calls. Runtime already behaved this way before PR-00.
- Added a dedicated local quality-gate test command for 21 testbench/gate tests.
- Added a no-network full-smoke preflight for the actual 15-ticker, 10-template, 150-row fixture matrix.

## 8. Commands run and exact results

Baseline evidence:

| Command | Result |
|---|---|
| `git rev-parse HEAD` | `b61602ef55e2499cccd46e32f53e29bb61c83aa7` |
| `cd workers && npm run typecheck` | PASS |
| `cd workers && npm test` before test alignment | FAIL: 52/53 files, 711/714 tests; three stale `pipeline.test.ts` expectations |
| `cd sec-fetcher && npm ci` before lockfile | FAIL: `EUSAGE`, no lockfile |
| `cd legal-site && npm ci` before lockfile | FAIL: `EUSAGE`, no lockfile |
| GitHub API branch/ruleset/workflow reads | `main.protected=false`, rulesets `[]`, remote workflow count `0` |

Final evidence:

| Command | Result |
|---|---|
| `cd workers && npm run typecheck` | PASS, 0 errors |
| `cd workers && npm test` | PASS: 54/54 files, 716/716 tests |
| `cd workers && npm run dryrun:test` | PASS: dry-run bundle 1330.85 KiB / gzip 269.60 KiB; no deploy; device-key binding redacted in CI output |
| `cd workers && npm run test:quality-gate` | PASS: 3/3 files, 21/21 tests |
| `cd workers && npm run testbench:validate` | PASS: 5 default tickers, 12 templates |
| `cd workers && npm run testbench:full-smoke -- --check-only` | PASS: Q01-Q10, 15 tickers, 150 expected rows, no run/network/gate execution |
| `cd workers && npm run migrations:validate` | PASS: 9 ordered migrations, `0001`-`0009` |
| `cd sec-fetcher && npm ci --no-audit --no-fund && npm test` | PASS: 15/15 tests |
| `cd legal-site && npm ci --no-audit --no-fund && npm run validate` | PASS |
| `cd ios && xcodegen generate && xcodebuild test ...` on Xcode 26.4.1, iPhone 17 Pro / iOS 26.4.1 | PASS: 157/157 tests |
| `cd ios && xcodebuild ... -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build` | PASS; output app verified unsigned |
| `node scripts/validate-release-gate.mjs` | PASS: 6 open P0 findings, decision `HOLD` |
| Ruby YAML parse of both workflow files | PASS |
| `git diff --check` | PASS |

The local default Node 20.11.1 emitted an engine warning for `undici`, which requires Node 20.18.1 or newer. CI uses Node 22.x and is not subject to that warning.

## 9. Security and privacy review

- Pull-request CI has read-only repository permissions and no secrets.
- Pull-request CI does not deploy, call remote migrations, or use production configuration.
- Wrangler dry-run output redacts `DEV_DETACHED_ACCESS_DEVICE_KEYS` before it reaches the CI log.
- The live benchmark is manual-only, serialized, and attached to a separately protected environment.
- XcodeGen is downloaded at a fixed version and checked against a fixed SHA-256 digest.
- No raw questions, conversation context, Apple payloads, transaction IDs, operation IDs, credentials, private keys, or signatures were added to logs or reports.
- Repository protection is not yet enabled; the documentation explicitly records this instead of claiming otherwise.

## 10. Backward-compatibility review

Application runtime compatibility is unchanged. The only existing test edits make assertions match the already-current deterministic route. No API schema, storage layout, product catalog, entitlement rule, credit balance, identity key, or user-visible behavior was changed.

CI requires Node 22.x and Xcode 26.4.1. The app deployment target remains iOS 17; the Xcode 26 SDK is required at compile time for guarded iOS 26 APIs.

## 11. Unresolved risks

- KBY-P0-01 through KBY-P0-06 remain open and block broad public or paid release.
- All listed P1/P2 remediations remain for their designated phases.
- GitHub-hosted jobs have not run remotely because the changes are uncommitted and unpushed; the workflows were syntax-parsed and every underlying command was exercised locally.
- `main` still has no branch protection, required checks, or rulesets. A repository administrator must apply `PR00_REPOSITORY_SETTINGS.md` after the first PR check names appear.
- The protected `test-worker-benchmark` environment and its test-only credentials/variables must be configured externally.
- Remote test and production D1 migration state was not queried or changed.
- r54 remains a known false-positive quality pass for KBY-P0-01; its PASS is not release-safety evidence.
- The iOS dependency graph has no tracked `Package.resolved`; the direct Google Mobile Ads version is exact, but transitive resolution is not fully locked.
- iOS 17 fallback UI was compiled but not executed in the iOS 26.4.1 simulator run. The unsigned build does not validate provisioning, entitlements, archive export, or TestFlight.
- Local `npm ci` reported eight pre-existing Worker dependency advisories (1 low, 1 moderate, 5 high, 1 critical). Reachability and upgrades were not assessed in this no-runtime-change phase.

## 12. Rollback or disable procedure

No data rollback is required.

To disable CI without changing runtime behavior, disable the affected workflow in GitHub or revert the two workflow files. To disable live benchmarking, disable the workflow or remove access to the `test-worker-benchmark` environment. Revert the validation scripts, package scripts, lockfiles, and test-only assertion alignment as one PR-00 unit if a full code rollback is required.

Keep `docs/release/RELEASE_GATE_STATE.json` at `HOLD` unless a later audited phase intentionally updates it. Do not delete or reset any balance, entitlement, identity, D1, KV, R2, or Durable Object state.

## 13. releaseDecision

`releaseDecision: READY_FOR_NEXT_PHASE`

This decision applies only to starting PR-01. Product release remains `HOLD` with all six P0 findings open.
