# Rewarded AdMob Credits Runbook

Production release decision remains HOLD until the production D1 migration and a real AdMob SSV callback have both been verified.

## Scope

- Completed rewarded ad view grants exactly 2 promotional credits.
- Daily cap is 3 rewarded grants per user per JST calendar day.
- Rewarded credits are promotional/free credits and are separate from paid credit purchases.
- Normal chat cost remains 2 credits.
- Paid credit and subscription behavior must not change.

## AdMob IDs

- Production rewarded ad unit: `ca-app-pub-1248492954379402/7202804414`
- Debug/test rewarded ad unit: `ca-app-pub-3940256099942544/1712485313`
- Production iOS app ID: `ca-app-pub-1248492954379402~7909080109`

Debug and simulator builds must use the Google test rewarded ad unit. Production ad units must be used only in release/prod configuration.

## SSV Callback URL

Configure the production rewarded ad unit server-side verification callback to:

```text
https://kabuyomi-api.dznqjmctk7.workers.dev/v1/admob/ssv
```

If production is later moved behind a custom API domain, configure the custom-domain equivalent:

```text
https://<production-api-domain>/v1/admob/ssv
```

The Worker expects Google AdMob SSV query parameters including `ad_unit`, `custom_data`, `transaction_id`, `signature`, and `key_id`.

`ad_unit` may arrive as either the full configured ad unit ID or the numeric suffix. The Worker accepts only the configured full ID and its numeric suffix for the current environment. For example, the test environment allows `ca-app-pub-3940256099942544/1712485313` and `1712485313`.

## Required Production Rollout Order

1. Confirm the production Worker route `/v1/admob/ssv` is deployed.
2. Backup/export production D1.
3. Apply `workers/d1/migrations/0008_admob_rewarded_credits.sql` to production D1.
4. Configure the AdMob production rewarded ad unit SSV callback URL.
5. Verify a real rewarded ad completion from a non-debug production-like build.
6. Confirm the ledger row has `creditSource = admob_rewarded`.
7. Confirm usage reflects `rewardedAdRemaining` and the expected total balance.

Do not enable production rewarded grants until step 5 succeeds.

Latest production-path route check:

- Production D1: `kabuyomi-history` (`027391a6-9f29-4a9b-b153-d277ad972e5f`)
- Production migrations applied: `0007_monthly_grants_drop_user_period_index.sql`, `0008_admob_rewarded_credits.sql`
- Production Worker deploy command: `cd workers && npm run deploy`
- Production Worker version: `5fbe1308-79dd-48bf-8101-b5be6d8ec8ab`
- `POST /v1/admob/reward-intents` without auth: reached route and returned `Device key is required`, not generic 404.
- `GET /v1/admob/ssv` with numeric production suffix `7202804414` and no signature: reached route and returned `invalid_signature`, not generic 404 or 500.
- `GET /v1/admob/ssv` with full production ad unit `ca-app-pub-1248492954379402/7202804414` and no signature: reached route and returned `invalid_signature`, not generic 404 or 500.
- Real production Google SSV callback observed: no. Production release remains HOLD until a real callback reaches the Worker, verifies successfully, and grants exactly 2 credits once.

## Non-Production Verification

Use the test Worker and test D1:

```bash
cd workers
npm run d1:migrate:test
npm run typecheck
npm test -- --run test/user-quota.test.ts test/credit-quota.test.ts test/admob-rewards.test.ts
npm run deploy:test
npm run smoke:test
npm run dryrun:test
```

For live non-production SSV, the test Worker route is:

```text
https://kabuyomi-api-test.dznqjmctk7.workers.dev/v1/admob/ssv
```

The AdMob test flow must use the Google test rewarded ad unit. A real SSV smoke requires an installed app build that creates a reward intent, sets that intent as the rewarded ad custom data, completes the ad, and then polls `/v1/admob/reward-status`.

Latest non-production route check:

- Test Worker deploy command: `cd workers && npm run deploy:test`
- Test Worker version: `6f052509-2dbe-4930-902a-1ad71c354105`
- `POST /v1/admob/reward-intents` without auth: reached route and returned an auth/payload error, not generic 404.
- `POST /v1/admob/reward-intents` with a test device key: created a pending reward intent with `rewardCredits = 2`.
- `GET /v1/admob/reward-status?id=<intent>`: returned `pending` before SSV.
- `GET /v1/admob/ssv` without a valid signature: reached route and returned `invalid_signature`, not generic 404.
- Real Google SSV callback observed: no. The AdMob console/device setup still needs to send a real SSV callback to the test Worker before production readiness can be marked READY.

If the production rewarded ad unit is temporarily pointed at the test SSV URL for smoke testing, switch it back to the production SSV URL before release. Prefer a separate staging/test rewarded ad unit with SSV configured directly to the test Worker.

## Pass Criteria

| Case | Expected result |
| --- | --- |
| Completed verified SSV | Grants exactly 2 credits |
| Duplicate `transaction_id` | Success/no-op, grants 0 additional credits |
| Fourth reward on same JST day | Blocked, no credits granted |
| Ad dismissed before reward | No SSV grant and no credits granted |
| Wrong `ad_unit` | Rejected, no credits granted |
| Invalid or missing signature | Rejected, no credits granted |
| Expired reward intent | Rejected, no credits granted |

## Production Rollback

- If production Worker deploy fails: stop, do not continue SSV smoke, and redeploy the last known-good Worker version if needed.
- If SSV signature verification fails on a real callback: do not grant credits; inspect sanitized logs for `key_id`, presence of `signature`, and whether Google public key fetch succeeded.
- If `ad_unit` is rejected: confirm AdMob sent either the full configured unit ID or the numeric suffix. Do not broaden the allowlist beyond the configured unit and suffix.
- If the credit grant amount is wrong: disable the rewarded ad UI in the app build or remove/disable the AdMob SSV callback until the Worker is fixed.
- If AdMob callback URL is wrong: correct AdMob Console configuration before continuing.
- Do not ship App Store release until real SSV, idempotency, daily cap, and normal chat credit consumption are verified.

## Troubleshooting

- `invalid_signature`: confirm AdMob callback includes `signature` and `key_id`, and that Google public key fetch is reachable.
- Generic `404` on reward routes: the deployed Worker does not include the AdMob reward route registration. Deploy the test Worker with `npm run deploy:test` and recheck `/v1/admob/reward-intents`.
- `Invalid rewarded ad unit`: confirm the Worker environment variable `ADMOB_REWARDED_AD_UNIT_ID` matches the AdMob unit for that environment.
- Numeric `ad_unit` values are accepted only when they match the configured unit suffix.
- `Invalid rewarded ad custom data`: confirm iOS set the reward intent `customData` on the rewarded ad SSV options before presenting the ad.
- `Rewarded ad daily cap reached`: user already has 3 granted rewarded ad transactions for the current JST date.
- Duplicate callback: check `admob_reward_transactions.transaction_id`; duplicates should not create another ledger grant.
- Delayed SSV: keep polling `/v1/admob/reward-status?id=<rewardIntentId>` until the intent becomes `granted`, `expired`, or the client-side timeout expires.

## Audit Tables

- `admob_reward_intents`: pending/granted/rejected reward intents, user/day cap context, and expiry.
- `admob_reward_transactions`: idempotent SSV transaction audit.
- `credit_ledger`: credit movement. Rewarded grants should include `creditSource = admob_rewarded` in metadata.
