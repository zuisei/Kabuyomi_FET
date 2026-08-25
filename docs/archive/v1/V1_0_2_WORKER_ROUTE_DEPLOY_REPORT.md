# Kabuyomi v1.0.2 Worker Route Deploy Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Conclusion

The v1.0.2 backend route availability issue was confirmed as a stale deployed Worker problem for the test environment.

The local Worker source registers the subscription sync and credit purchase routes, local checks passed, D1 reported no pending remote migrations for the test database, and the test Worker was deployed successfully.

After the test deploy, `POST /v1/ios/subscriptions/sync` on `https://kabuyomi-api-test.dznqjmctk7.workers.dev` is no longer 404. It now returns the expected route-level validation error for an empty JSON body.

No production deploy was performed.

## 2. Branch / Commit / Worker Version

- Branch: `v1.0.2-subscription-rewarded-credits`
- Git HEAD: `96a62a2`
- Working tree: dirty from existing v1.0.2 iOS/report work; no commit was created.
- Test Worker: `kabuyomi-api-test`
- Test Worker URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Test Worker version ID after deploy: `13aa5cef-84b9-48f2-bf68-2639a0f0e5de`
- Deploy time: `2026-05-09 20:38 JST`

## 3. Route Registration Confirmed In Source

Source inspection confirmed:

| Route | Source confirmation |
| --- | --- |
| `POST /v1/ios/subscriptions/sync` | `workers/src/routes/billing-sync.ts` checks `url.pathname === "/v1/ios/subscriptions/sync"` and `request.method === "POST"`. |
| `POST /v1/billing/sync` | `workers/src/routes/billing-sync.ts` keeps the compatibility route. |
| `POST /v1/ios/purchases/credits/complete` | `workers/src/routes/credit-purchase-grant.ts` checks `url.pathname === "/v1/ios/purchases/credits/complete"` and `request.method === "POST"`. |
| `POST /v1/credits/purchase-grant` | `workers/src/routes/credit-purchase-grant.ts` keeps the compatibility route. |

`workers/src/index.ts` imports both handlers and registers them in `apiRoutes`.

## 4. Test Worker Deploy Command / Result

Command:

```sh
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Result:

- `check:test-config` passed.
- Worker uploaded successfully.
- Worker triggers deployed successfully.
- Deployed URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `13aa5cef-84b9-48f2-bf68-2639a0f0e5de`

## 5. D1 Migration Status

Commands attempted:

```sh
npx wrangler d1 migrations list DB --config wrangler.test.toml --remote
npx wrangler d1 migrations list kabuyomi-history-test --config wrangler.test.toml --remote
```

Result:

- Binding form `DB` failed with Cloudflare API authorization error `7403`.
- Database-name form `kabuyomi-history-test` succeeded.
- Final status: `No migrations to apply!`

No D1 migration was applied.

## 6. Route Probe Results Before / After Deploy

Before deploy, public test Worker route health was known as:

| Endpoint | Before deploy |
| --- | --- |
| `GET /v1/usage` | 200 |
| `POST /v1/ios/purchases/credits/complete` with `{}` | 400 `Invalid credit purchase payload` |
| `POST /v1/ios/subscriptions/sync` with `{}` | 404 `Not found` |

After test deploy:

| Endpoint | Result | Interpretation |
| --- | --- | --- |
| `GET /v1/usage` | 200 | usage route available |
| `POST /v1/ios/subscriptions/sync` with `{}` | 400 `Invalid billing sync payload` | route exists; validation reached |
| `POST /v1/ios/purchases/credits/complete` with `{}` | 400 `Invalid credit purchase payload` | route exists; validation reached |
| `POST /v1/billing/sync` with `{}` | 400 `Invalid billing sync payload` | compatibility route exists |
| `POST /v1/credits/purchase-grant` with `{}` | 400 `Invalid credit purchase payload` | compatibility route exists |

Probe command used `/usr/bin/curl` because `curl` was not present on the shell `PATH`.

## 7. `/v1/ios/subscriptions/sync` 404 Status

`POST /v1/ios/subscriptions/sync` on the test Worker is no longer 404.

Current test Worker response for empty JSON:

```json
{"error":"Invalid billing sync payload"}
```

HTTP status: `400`.

This is the expected safe result for a no-op invalid request: the deployed route exists, but the request is not a valid Apple-backed billing sync payload.

## 8. Validation Commands

Run from `/Users/0xt4/t4dano/Kabuyomi/workers`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm test -- billing-catalog purchase billing quota subscription` | passed, 46 tests |
| `npm run dryrun:test` | passed |
| `npx wrangler d1 migrations list kabuyomi-history-test --config wrangler.test.toml --remote` | passed, no migrations to apply |
| `npm run deploy:test` | passed |

## 9. Remaining Risks

- This only proves test Worker route availability. Production Worker was not deployed or modified.
- Empty JSON route probes prove route registration, not full Apple transaction verification.
- A real StoreKit sandbox/TestFlight subscription purchase still needs to be re-tested against the now-updated test Worker or after an explicitly approved production deploy.
- The working tree remains dirty from the ongoing v1.0.2 iOS/report changes; no commit was made.

## 10. Production Deploy Recommendation

Production deploy is recommended only after the user explicitly approves it.

Suggested production gate before deploy:

1. Re-run Worker checks:
   - `npm run typecheck`
   - `npm test -- billing-catalog purchase billing quota subscription`
   - `npm run dryrun:test`
2. Confirm production D1 migrations with the production database name.
3. Deploy production with the repository's production deploy command from `workers/`.
4. Probe production:
   - `GET /v1/usage`
   - `POST /v1/ios/subscriptions/sync` with `{}` should return 400/401, not 404.
   - `POST /v1/ios/purchases/credits/complete` with `{}` should return 400/401, not 404.
   - compatibility routes should also not 404 if still expected.
5. Run TestFlight StoreKit subscription purchase/restore smoke.

## 11. Release Decision

Test Worker route health is now green for v1.0.2 monetization route availability.

Release remains `HOLD` for production until production deploy is explicitly approved, production route probes pass, and a real StoreKit subscription sync smoke succeeds.
