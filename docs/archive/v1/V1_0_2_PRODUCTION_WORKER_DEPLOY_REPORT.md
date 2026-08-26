# Kabuyomi v1.0.2 Production Worker Deploy Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Conclusion

The v1.0.2 production Worker deploy gate passed and the production Worker was deployed.

Production route health is now green for monetization route availability:

- `POST /v1/ios/subscriptions/sync` is no longer 404.
- `POST /v1/ios/purchases/credits/complete` is not 404.
- compatibility billing and credit routes are not 404.

Empty JSON requests return expected validation errors, which confirms route registration without granting credits or bypassing Apple verification.

No Git push was performed.

## 2. Branch / Commit / Worker Version

- Branch: `v1.0.2-subscription-rewarded-credits`
- Deploy source commit: `04336e7`
- Local commits created before production deploy:
  - `066c052 Add subscription credits UI and billing diagnostics`
  - `04336e7 Add v1.0.2 StoreKit and Worker route smoke reports`
- Production Worker: `kabuyomi-api`
- Production Worker URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Production Worker version ID: `535fd8fb-cca5-412c-bf76-a3b781dde00b`
- Deploy time: `2026-05-09 20:55 JST`

## 3. Git Status Before Deploy

Before production gate:

- working tree had only iOS/docs/README v1.0.2 changes.
- no uncommitted Worker source changes were present.

Local commits were created before production deploy:

```sh
git commit -m "Add subscription credits UI and billing diagnostics"
git commit -m "Add v1.0.2 StoreKit and Worker route smoke reports"
```

After those commits, `git status --short --branch` showed a clean branch before Worker validation and production deploy.

## 4. Production D1 Migration Status

Production D1 database name from `workers/wrangler.toml`:

- `kabuyomi-history`

Command:

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler d1 migrations list kabuyomi-history --remote
```

Result:

- `No migrations to apply!`

No production D1 migrations were applied.

## 5. Commands Run

Pre-production gate:

| Command | Result |
| --- | --- |
| `git status --short --branch` | clean before deploy |
| `npm run typecheck` | passed |
| `npm test -- billing-catalog purchase billing quota subscription` | passed, 46 tests |
| `npm run dryrun:test` | passed |
| `git diff --check` | passed |
| `npx wrangler d1 migrations list kabuyomi-history --remote` | passed, no migrations to apply |

Production deploy:

| Command | Result |
| --- | --- |
| `npm run deploy` | passed |

## 6. Production Deploy Result

Command:

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy
```

Result:

- Worker uploaded successfully.
- Worker triggers deployed successfully.
- Production URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Cron schedule preserved: `0 18 * * *`
- Version ID: `535fd8fb-cca5-412c-bf76-a3b781dde00b`

## 7. Production Route Probe Results

Base URL:

- `https://kabuyomi-api.dznqjmctk7.workers.dev`

Probe results:

| Endpoint | Result | Interpretation |
| --- | --- | --- |
| `GET /v1/usage` | 200 | usage route available |
| `POST /v1/ios/subscriptions/sync` with `{}` | 400 `Invalid billing sync payload` | subscription sync route exists; validation reached |
| `POST /v1/ios/purchases/credits/complete` with `{}` | 400 `Invalid credit purchase payload` | credit complete route exists; validation reached |
| `POST /v1/billing/sync` with `{}` | 400 `Invalid billing sync payload` | compatibility billing route exists |
| `POST /v1/credits/purchase-grant` with `{}` | 400 `Invalid credit purchase payload` | compatibility credit route exists |

## 8. `/v1/ios/subscriptions/sync` 404 Status

`POST /v1/ios/subscriptions/sync` on production is no longer 404.

Current response for empty JSON:

```json
{"error":"Invalid billing sync payload"}
```

HTTP status: `400`.

This is the expected safe route-health response. It does not grant credits and does not bypass Apple verification.

## 9. Remaining TestFlight Smoke Steps

Manual TestFlight checks still required:

1. Open Settings > Credits > Account Status in the TestFlight build.
2. Confirm the app points to `https://kabuyomi-api.dznqjmctk7.workers.dev`.
3. Run billing route health in a debug/TestFlight diagnostic build if available.
4. Purchase Lite in sandbox and confirm:
   - StoreKit purchase succeeds.
   - app calls `POST /v1/ios/subscriptions/sync`.
   - app refreshes `/v1/usage`.
   - Lite active plan and 400 monthly credits appear from the server.
5. Restore/sync and confirm no duplicate grant.
6. Purchase `kabuyomi.credits.50` and confirm paid credits increase only after backend verification.
7. Confirm cancellation/network failure does not locally grant credits.

## 10. Release Decision

Production Worker route deploy gate is `PASS`.

Release remains `TESTFLIGHT_SMOKE_REQUIRED` until real StoreKit sandbox subscription purchase, restore, and 50-credit consumable purchase are verified end to end against production.
