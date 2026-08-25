# Kabuyomi Acquisition Readiness Packet

Date: 2026-06-06 JST
Repository: `/Users/0xt4/t4dano/Kabuyomi`
Branch at preparation time: `main`
Prepared state: local working tree, not deployed, not pushed, not transferred

## Executive Summary

Kabuyomi is an iOS + Cloudflare Workers product for reading U.S. SEC 10-K / 10-Q filings in Japanese with source-grounded AI answers.

This packet records the near-transfer technical state after cleaning the main blocking local validation issue. It is intended for buyer diligence and handoff preparation. It is not legal, tax, financial, or valuation advice.

## Product Scope

- iOS app: SwiftUI, XcodeGen-generated project, bundle ID `app.kabuyomi.ios`.
- Backend: Cloudflare Workers API with Durable Objects, KV, D1, and R2 bindings.
- Filing pipeline: SEC fetcher service and Worker-integrated SEC fetcher routes.
- AI path: OpenAI prompt-versioned chat path with local deterministic and fallback guardrails.
- Monetization: StoreKit consumable credits, Lite / Pro / Max monthly subscription credit plans, optional rewarded-ad credit path gated by Google AdMob SSV.
- Legal surface: Cloudflare Pages static legal site under `legal-site/`.

## Primary Assets To Transfer

Code and repository:

- `ios/`
- `workers/`
- `sec-fetcher/`
- `legal-site/`
- `docs/`

Apple-side assets:

- Apple Developer team access for bundle `app.kabuyomi.ios`
- App Store Connect app record
- StoreKit products:
  - `kabuyomi.credits.50`
  - `kabuyomi.credits.100`
  - `kabuyomi.sub.lite.monthly`
  - `kabuyomi.sub.pro.monthly`
  - `kabuyomi.sub.max.monthly`
- App Store Server API key material and issuer/key IDs

Cloudflare-side assets:

- Worker `kabuyomi-api`
- Test Worker config in `workers/wrangler.test.toml`
- KV namespaces for filing/search cache
- D1 database `kabuyomi-history` and test equivalent
- R2 bucket `kabuyomi-filings` and test equivalent
- Durable Object classes:
  - `SecRateLimiterDO`
  - `FilingLockDO`
  - `UserQuotaDO`
  - `EntitlementDO`

Third-party/service assets:

- OpenAI project/API key used by the Worker
- Prompt ID `pmpt_69f5f2f592b8819490c30cf43c4f0f770f3a1fc228661050`, currently configured as prompt version `2`
- Google AdMob app/ad unit access for rewarded-credit SSV
- SEC contact email/user-agent ownership

## Current Local Validation

Commands run on 2026-06-06 JST:

```text
cd workers && npm run typecheck
cd workers && npm test
cd workers && npm run dryrun:test
cd workers && npm run testbench:validate
cd sec-fetcher && npm test
cd legal-site && npm run validate
XcodeBuildMCP test_sim, scheme Kabuyomi, iPhone 17 Pro simulator
```

Observed results:

- Workers typecheck: passed.
- Workers full test suite: 50 files passed, 633 tests passed.
- Workers test dry-run deploy: passed; no deploy performed.
- Testbench validation: passed, 5 default tickers and 12 question templates.
- SEC fetcher tests: 15 passed.
- Legal static-site validation: passed.
- iOS simulator tests: 153 passed, 0 failed, 0 skipped, warnings 0.

## Changes Made For Readiness

- Fixed time-dependent Worker tests that had become red because fixed fixture dates were overtaken by real calendar time.
- Removed iOS MainActor setup/teardown warnings in `AppModelTests`.
- Added this acquisition readiness packet.
- No production deploy was performed.
- No git push was performed.
- No external account transfer was performed.

## Current Known Gaps Before Actual Sale Or Transfer

These are intentionally not closed by this local repo pass:

- Confirm live production Worker parity with this local working tree after any deploy.
- Record a fresh production or TestFlight rewarded-AdMob SSV evidence run in `docs/admob/rewarded_admob_credits_runbook.md`.
- Confirm App Store Connect product metadata, pricing, subscription group, privacy answers, and review notes in the live Apple UI.
- Confirm Cloudflare account ownership transfer path for Workers, KV, D1, R2, Pages, and secrets.
- Rotate and re-issue secrets for the buyer:
  - OpenAI API key
  - Apple App Store Server API private key
  - AdMob/Google access
  - Cloudflare API tokens
  - SEC fetcher/internal/backfill/eval shared secrets
- Decide whether to ship rewarded-credit UI or hide it before App Review depending on available SSV evidence.
- Clean local-only generated artifacts before packaging:
  - `ios/Build/`
  - `test-results/`
  - `tmp/`
  - local scratch files such as `docs/archive/SYSTEM_AUDIT_2026-05-22.md` / `docs/archive/HANDOFF_2026-05-24.md`, if they are not intentionally part of the sale record
- Update `docs/INDEX.md`, `RELEASE_TRUTH.md`, and `CURRENT_SHIPPING_TRUTH.md` after the final deploy/smoke decision.

## Buyer Diligence Pointers

Start here:

- `README.md`
- `docs/archive/v1/RELEASE_TRUTH.md`
- `docs/release/CURRENT_SHIPPING_TRUTH.md`
- `docs/archive/v1/PROMPT_V2_MAIN_DEPLOY_QUALITY_HARDENING_REPORT.md`
- `docs/legal/APPLE_STORE_SERVER_CONFIG.md`
- `docs/admob/rewarded_admob_credits_runbook.md`
- `workers/wrangler.toml`
- `ios/project.yml`

Recommended live checks before closing:

- Production `/v1/usage`
- Production `/v1/search`
- Production `/v1/company/{ticker}`
- Production `/v1/chat`
- Billing sync with sandbox/TestFlight subscription
- Consumable purchase grant and duplicate no-op
- Rewarded-ad SSV callback and duplicate no-op, if rewarded ads remain visible

## Sale Boundary

This repository is now closer to a diligence-ready state, but sale execution still requires external account work. Do not represent this local state as transferred, deployed, or App-Review-ready unless those external checks have been completed and recorded.
