# Test Worker Deploy and Smoke Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Date: 2026-07-11 JST

## Result

Dedicated test infrastructure was migrated and deployed successfully. Production was not changed.

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version: `7226f5e4-39e3-4d0b-bb31-7713df1b3b0c`
- Test D1: `kabuyomi-history-test`
- Applied migrations: `0010` through `0015`
- Post-apply migration status: no migrations pending
- Startup time: 23 ms

## Secret handling

Cloudflare secret inspection returned names and types only. Five independent random test-only HMAC values were streamed directly to Wrangler for subscription principals, installation tokens, installation network identity, account principals, and account sessions. No value was printed or stored in the repository/local secret file.

Apple Store Server API credentials and an App Attest verifier were not available and were not fabricated. Their live flows remain external gates.

## Deployment repair

The first upload was rejected before activation by Cloudflare error 10021 because `@apple/app-store-server-library` pulled `jsrsasign` into Worker global evaluation, which performs disallowed random initialization. `apple-signed-data.ts` was changed to load Apple's verifier at request time. Typecheck and 66 focused Apple/routing tests passed, the next upload succeeded, and an invalid live Apple notification produced the expected controlled HTTP 400 rather than a Worker crash.

## Remote smoke

`npm run smoke:test:identity` passed against the deployed URL:

- server-issued installation bootstrap;
- unverified CLI identity received zero welcome credits;
- usage capability payload preserved consumable and rewarded-credit availability;
- account recovery remained false;
- AAPL search and company filing read succeeded;
- reward mutation without App Attest assertion returned the expected HTTP 401;
- invalid Apple signed data returned the expected HTTP 400.

The earlier legacy smoke reached usage/search/watchlist/company/chat and charged exactly two credits, but its fixed 50-credit expectation conflicted with an existing 100-credit test balance. After propagation, legacy device-key calls correctly became HTTP 401 because the deployed Worker now requires server-issued installation credentials. The identity-aware smoke is the authoritative CLI check for this version.

## Local regression

- Worker typecheck: PASS
- Focused Apple/routing tests: 66/66 PASS
- Full Worker suite: 63 files, 817/817 PASS

## Remaining gates

- physical-device App Attest and authenticated mutation/chat canary;
- StoreKit sandbox purchases, restores, subscriptions, and `appAccountToken` recovery;
- App Store Server Notifications console validation;
- production AdMob SSV callback;
- live benchmark runs after an attested test identity path is available;
- TestFlight and production rollout review.

Release decision remains `HOLD`.
