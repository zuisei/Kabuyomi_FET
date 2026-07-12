# V1.0.2 Final Release Candidate Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Conclusion

Kabuyomi v1.0.2 is a release candidate for TestFlight.

Worker hardening is now passed after the user-confirmed authorized credit audit repair endpoint smoke was added to the final hardening report. Local Worker validation, test Worker smoke, production migration/deploy, production chat credit smoke, production compact diagnostics, and repair endpoint gating all passed.

Focused iOS monetization validation passed on simulator through existing unit tests for insufficient-credit recovery, rewarded-ad return/recovery behavior, StoreKit diagnostics, API purchase/sync paths, account/credits UI models, product IDs, and release-safe diagnostic display.

No production deploy was performed in this final integration check.

releaseDecision: RELEASE CANDIDATE - V1.0.2 READY FOR TESTFLIGHT

## 2. Worker hardening status

Passed:

- chat post-generation charge safety
- production `[limits] cpu_ms = 30000`
- production log redaction
- AdMob daily cap serialization
- credit audit repair queue migration and route
- subscription downgrade no-clawback semantics
- test D1 migration
- production D1 migration
- test Worker deploy/smoke
- production Worker deploy
- production chat credit safety smoke
- no `/v1/chat` `exceededCpu`
- no `/v1/chat` HTTP `503` in production smoke
- compact production diagnostics stayed compact
- unauthorized repair endpoint returned `401`
- authorized repair endpoint follow-up passed manually

Production Worker evidence from the hardening gate:

- Worker: `kabuyomi-api`
- Version ID: `521c50fd-0d39-4943-838d-f9926e37849b`
- CPU limit: `[limits] cpu_ms = 30000`

## 3. Authorized repair endpoint follow-up

Updated:

- `docs/release/V1_0_2_FINAL_HARDENING_DEPLOY_SMOKE_REPORT.md`

Added follow-up:

- timestamp: `2026-05-10T08:25:48Z` / `2026-05-10 17:25:48 JST`
- Worker version: `521c50fd-0d39-4943-838d-f9926e37849b`
- endpoint: `POST /v1/internal/credit-audit/repair`
- unauthorized status: `401`
- authorized status: `200`
- authorized response shape: count-only JSON
- raw payloads exposed: no
- secret printed/logged: no
- result: passed

Updated hardening release decision:

```text
releaseDecision: RELEASE CANDIDATE - WORKER HARDENING PASSED
```

No secret value was written to the report.

## 4. Changed file inventory

Current dirty branch inventory from `git status --short` and `git diff --stat`.

Worker source:

- `workers/src/durable/user-quota.ts`
- `workers/src/index.ts`
- `workers/src/lib/apple-store-server.ts`
- `workers/src/lib/chat/diagnostics.ts`
- `workers/src/lib/chat/usecase.ts`
- `workers/src/lib/contracts.ts`
- `workers/src/lib/credit-audit-repair.ts`
- `workers/src/lib/logging.ts`
- `workers/src/lib/quota.ts`
- `workers/src/routes/admob-rewards.ts`
- `workers/src/routes/internal-credit-audit-repair.ts`
- `workers/src/routes/translate-quote.ts`
- `workers/wrangler.toml`
- `workers/smoke/staging-worker.js`

Worker tests:

- `workers/test/admob-rewards.test.ts`
- `workers/test/apple-store-server.test.ts`
- `workers/test/chat-route.test.ts`
- `workers/test/credit-audit-repair.test.ts`
- `workers/test/credit-quota.test.ts`
- `workers/test/index.test.ts`
- `workers/test/logging.test.ts`
- `workers/test/user-quota.test.ts`

Worker migrations:

- `workers/d1/migrations/0009_credit_audit_repair_queue.sql`

iOS source:

- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/App/AppRootView.swift`
- `ios/Kabuyomi/Features/Company/CompanyComposer.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/Services/RewardedAdService.swift`

iOS tests:

- `ios/KabuyomiTests/AppModelTests.swift`

docs/reports:

- `docs/release/V1_0_2_ADMOB_DAILY_CAP_SERIALIZATION_REPORT.md`
- `docs/release/V1_0_2_CHAT_POST_GENERATION_CHARGE_HOTFIX_REPORT.md`
- `docs/release/V1_0_2_CLOUDFLARE_CPU_LIMIT_CONFIG_REPORT.md`
- `docs/release/V1_0_2_CREDIT_AUDIT_RECONCILIATION_REPORT.md`
- `docs/release/V1_0_2_FINAL_HARDENING_DEPLOY_SMOKE_REPORT.md`
- `docs/release/V1_0_2_FINAL_RELEASE_CANDIDATE_REPORT.md`
- `docs/release/V1_0_2_INSUFFICIENT_CREDIT_RECOVERY_REPORT.md`
- `docs/release/V1_0_2_PRODUCTION_CHAT_CPU_CREDIT_SMOKE_REPORT.md`
- `docs/release/V1_0_2_PRODUCTION_LOG_REDACTION_REPORT.md`
- `docs/release/V1_0_2_REWARDED_AD_RETURN_NAVIGATION_FIX_REPORT.md`
- `docs/release/V1_0_2_REWARDED_AD_SMOKE_HANDOFF_FOR_CHATGPT.md`
- `docs/release/V1_0_2_SUBSCRIPTION_DOWNGRADE_SEMANTICS_REPORT.md`
- `docs/release/V1_0_2_WORKER_CPU_CREDIT_AUDIT.md`
- `docs/release/V1_0_2_WORKER_HARDENING_AUDIT_V2.md`

tmp/logs:

- `tmp/kabuyomi-worker-tail-503.jsonl`
- `tmp/kabuyomi-worker-tail-v1.0.2-chat-cpu-credit-smoke-paid.jsonl`
- `tmp/kabuyomi-worker-tail-v1.0.2-final-hardening-smoke.jsonl`

No files were deleted.

## 5. Worker validation

Commands:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
npm run smoke:test
```

Results:

- `npm run typecheck`: passed
- `npm test`: passed, `50` test files / `626` tests
- `npm run dryrun:test`: passed
- `npm run smoke:test`: passed against `kabuyomi-api-test`

The smoke script now uses the current subscription product ID `kabuyomi.sub.pro.monthly`. This was a minimal test-fixture correction after the first final hardening gate found the stale `app.kabuyomi.pro.monthly` fixture.

No production deploy was run in this final integration check.

## 6. iOS validation

Test convention:

- project: `/Users/0xt4/t4dano/Kabuyomi/ios/Kabuyomi.xcodeproj`
- scheme: `Kabuyomi`
- simulator: `iPhone 16e`
- bundle ID: `app.kabuyomi.ios`

Focused simulator test command through XcodeBuildMCP:

```text
test_sim -only-testing:KabuyomiTests/AppModelTests -only-testing:KabuyomiTests/APIClientTests -only-testing:KabuyomiTests/StoreKitDiagnosticsTests
```

Result:

- status: succeeded
- tests: `102` passed, `0` failed, `0` skipped
- build log: `/Users/0xt4/Library/Developer/XcodeBuildMCP/workspaces/Kabuyomi-69fdca4d6f5b/logs/test_sim_2026-05-10T08-27-04-342Z_pid51233_e18f0383.log`
- xcresult: `/Users/0xt4/Library/Developer/XcodeBuildMCP/workspaces/Kabuyomi-69fdca4d6f5b/result-bundles/test_sim_2026-05-10T08-27-04-342Z_pid51233_49557c25.xcresult`

Covered test areas:

- insufficient-credit local preflight
- server `402` insufficient-credit recovery
- closing recovery clears state
- recovery state detects when credits become sufficient
- rewarded-ad success refreshes balance
- rewarded-ad return destination recording/restoration
- pending SSV preserves return destination
- dismissed-without-reward does not poll or grant
- daily cap UI state
- SSV smoke mode/test-device behavior
- rewarded-ad debug redaction/masking
- credit billing disabled guard
- v1.0.2 StoreKit product IDs
- 50-credit primary pack and 100-credit compatibility pack
- subscription catalog Lite/Pro/Max credits
- account status display model
- route-missing details hidden from display rows
- StoreKit diagnostics lines do not expose sensitive identifiers
- API purchase grant and subscription sync request headers/payloads
- AdMob reward intent and reward status API decoding

## 7. Credit recovery behavior

Automated validation passed for:

- true zero-credit local send blocks before network send
- composer credit options open recovery state
- server insufficient-credit response opens recovery state
- recovery tracks sufficient credits after refresh
- closing recovery clears recovery state and request ID

Prior report:

- `docs/release/V1_0_2_INSUFFICIENT_CREDIT_RECOVERY_REPORT.md`

Manual TestFlight check still recommended:

- use a low-credit account/device
- confirm Credits opens with `クレジットが不足しています`
- confirm draft/company context is preserved
- confirm recovery closes cleanly

## 8. Rewarded ad behavior

Automated validation passed for:

- reward intent is requested before reward flow
- success refreshes server usage
- no local grant on dismissed ad
- pending SSV keeps Credits return destination
- success/failure/cap paths request Credits restoration when appropriate
- user close suppresses stale restoration
- daily cap disables grant flow in UI state
- debug/demo ad unit blocks production SSV intent when unsafe
- SSV smoke mode requires test-device configuration

Production-safe Worker smoke passed for invalid SSV no-grant.

Real AdMob rewarded grant smoke is still a TestFlight/human follow-up. The repository already contains a handoff:

- `docs/release/V1_0_2_REWARDED_AD_SMOKE_HANDOFF_FOR_CHATGPT.md`
- `docs/admob/rewarded_admob_credits_runbook.md`

## 9. StoreKit / subscription behavior

Automated validation passed for:

- `kabuyomi.credits.50` is the primary consumable credit pack
- `kabuyomi.credits.100` remains as compatibility consumable
- Lite subscription: `kabuyomi.sub.lite.monthly`, `400` credits/month
- Pro subscription: `kabuyomi.sub.pro.monthly`, `900` credits/month
- Max subscription: `kabuyomi.sub.max.monthly`, `2000` credits/month
- purchase credit pack is blocked when credit billing is disabled
- API client sends StoreKit transaction payload to the backend grant endpoint
- API client sends device binding headers for subscription sync
- StoreKit diagnostics do not expose sensitive identifiers
- release-safe purchase error copy is present

Live StoreKit purchase/restore/subscription sheet flows were not executed by Codex. They require TestFlight or App Store sandbox account interaction.

Relevant existing docs:

- `docs/legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md`
- `docs/legal/APPLE_STORE_SERVER_CONFIG.md`
- `docs/release/V1_0_2_STOREKIT_SANDBOX_SMOKE_REPORT.md`

## 10. Privacy / review-visible UI

Automated/static checks:

- StoreKit diagnostics redaction tests passed.
- Account Status display tests passed, including route-missing detail hiding.
- Code search found raw identifiers in storage/API model paths where required for StoreKit, backend sync, or device identity.
- Review-visible account UI uses device key suffix display, not the full device key.
- Rewarded-ad diagnostics use redaction helpers for AdMob unit/device values.
- The in-app legal copy references public legal URLs and third-party services.

No automated evidence found a release-visible UI that prints:

- full device key
- transaction IDs
- Apple signed payloads
- AdMob callback data
- secrets/tokens

Manual review still recommended on a TestFlight build for the Credits / Account Status screen, especially with real StoreKit product load and AdMob availability states.

## 11. App Review readiness

Existing App Review notes are present and coherent:

- `docs/release/APP_STORE_SUBMISSION_NOTES.md`
- `docs/release/RELEASE_TRUTH.md`
- `docs/release/V1_0_2_TESTFLIGHT_SMOKE_EVIDENCE_PACKET.md`

App Review notes cover:

- app purpose: Japanese SEC 10-K / 10-Q filing reader
- no investment advice
- no brokerage account/login requirement
- credit model
- subscriptions
- consumable credits
- optional rewarded ad credits
- test instructions
- third-party services:
  - Cloudflare Workers/D1/R2/KV/Durable Objects
  - OpenAI
  - SEC EDGAR/fetcher
  - Apple StoreKit/App Store Server API
  - Google AdMob
- legal URLs:
  - Privacy: `https://kabuyomi-legal-site.pages.dev/privacy/`
  - Terms: `https://kabuyomi-legal-site.pages.dev/terms/`
  - Support: `https://kabuyomi-legal-site.pages.dev/support/`
  - Tokushoho: `https://kabuyomi-legal-site.pages.dev/tokushoho/`

No new App Review note was required in this pass.

## 12. Commands run

Repo inventory and checks:

```bash
cd /Users/0xt4/t4dano/Kabuyomi
git status --short
git diff --stat
git diff --check
rg "Insufficient|Credit|Rewarded|AdMob|StoreKit|Subscription|Account|Restore|Purchase|Recovery" ios/KabuyomiTests ios/Kabuyomi -g '*.swift'
rg "https?://|workers.dev|/v1/|device key|deviceKey|transactionId|signedTransaction|signedTransactionInfo|callback|secret|token" ios/Kabuyomi -g '*.swift'
```

Worker validation:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
npm run smoke:test
```

iOS validation:

```text
XcodeBuildMCP session_show_defaults
XcodeBuildMCP test_sim -only-testing:KabuyomiTests/AppModelTests -only-testing:KabuyomiTests/APIClientTests -only-testing:KabuyomiTests/StoreKitDiagnosticsTests
```

Docs/readiness inspection:

```bash
sed -n '1,260p' docs/release/APP_STORE_SUBMISSION_NOTES.md
sed -n '1,220p' docs/release/RELEASE_TRUTH.md
sed -n '1,220p' docs/release/V1_0_2_STOREKIT_SANDBOX_SMOKE_REPORT.md
sed -n '1,180p' docs/release/V1_0_2_REWARDED_AD_SMOKE_HANDOFF_FOR_CHATGPT.md
sed -n '1,220p' docs/release/V1_0_2_INSUFFICIENT_CREDIT_RECOVERY_REPORT.md
sed -n '1,220p' docs/release/V1_0_2_REWARDED_AD_RETURN_NAVIGATION_FIX_REPORT.md
```

## 13. Failed commands

- Initial iOS discovery search included `ios/KabuyomiUITests`, which does not exist in this repo. The command exited with a path error but still printed useful matches. It was rerun against existing paths: `ios/KabuyomiTests ios/Kabuyomi`.

No validation command failed.

## 14. Remaining risks

- Real TestFlight/App Store sandbox StoreKit product loading, purchase, restore, duplicate restore, and subscription purchase flows still require human execution.
- Real Google AdMob rewarded SSV grant smoke still requires human/TestFlight execution and should record +2 ad credit, paid balance unchanged, and daily cap behavior.
- Static legal URLs were inspected from docs/code, but this pass did not browser-open public legal URLs.
- Branch remains dirty with many release files and tmp tail logs; final staging/commit/push were intentionally not performed.

## 15. releaseDecision

releaseDecision: RELEASE CANDIDATE - V1.0.2 READY FOR TESTFLIGHT
