# Rewarded AdMob Credits Runbook

AdMob rewarded-credit backend routes are implemented and server-side verification gated, but the rewarded-credit UI is hidden for the current RC. Keep this runbook as the operational checklist for re-enabling the visible rewarded-credit flow after real Google AdMob SSV grant evidence is recorded.

## Scope

- Current RC App Review builds do not show the rewarded-credit card/button.
- Rewarded ads are optional.
- A completed rewarded ad view grants exactly 2 free/ad credits after server-side Google AdMob SSV verification.
- The daily cap is 3 rewarded grants per user per JST calendar day.
- When granted, rewarded ad credits expire 30 days after grant.
- Rewarded credits are promotional/free credits and are separate from paid credit purchases.
- Duplicate SSV transactions are success/no-op and do not double grant.
- Invalid signatures, invalid ad units, malformed callbacks, and expired reward intents do not grant.
- Normal chat cost remains 2 credits.
- Paid credit behavior must not change.

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

Do not re-enable rewarded-credit UI or describe it in App Store submission notes until step 5 succeeds and the evidence is recorded below.

Latest production-path route check:

- Production D1: `kabuyomi-history` (`027391a6-9f29-4a9b-b153-d277ad972e5f`)
- Production migrations applied: `0007_monthly_grants_drop_user_period_index.sql`, `0008_admob_rewarded_credits.sql`
- Production Worker deploy command: `cd workers && npm run deploy`
- Production Worker version: `5fbe1308-79dd-48bf-8101-b5be6d8ec8ab`
- `POST /v1/admob/reward-intents` without auth: reached route and returned `Device key is required`, not generic 404.
- `GET /v1/admob/ssv` with numeric production suffix `7202804414` and no signature: reached route and returned `invalid_signature`, not generic 404 or 500.
- `GET /v1/admob/ssv` with full production ad unit `ca-app-pub-1248492954379402/7202804414` and no signature: reached route and returned `invalid_signature`, not generic 404 or 500.
- External product-owner statement: real SSV was verified outside the previous Codex pass.
- Repository evidence status: not recorded. Rewarded-credit UI remains hidden until a real callback reaches the Worker, verifies successfully, grants exactly 2 credits once, and the sanitized evidence record below is completed.

## Real SSV Evidence Record

Do not include secrets, full private tokens, or full transaction IDs. Redact transaction IDs as `prefix...suffix`.

- Real production/TestFlight Google SSV callback observed: no repository artifact recorded.
- Evidence date/time: TODO_RECORD_VERIFIED_SSV_TIME_JST
- Environment: TODO_RECORD_PRODUCTION_OR_TESTFLIGHT
- Worker URL or route hit: TODO_RECORD_WORKER_ROUTE
- Ad unit kind: TODO_RECORD_PRODUCTION_OR_TEST_UNIT_KIND
- Redacted transaction ID: TODO_RECORD_REDACTED_TRANSACTION_ID
- Expected grant result: +2 free/ad credits
- Actual grant result: TODO_RECORD_GRANT_RESULT
- Reward status poll result: TODO_RECORD_REWARD_STATUS_RESULT
- `/v1/usage` result: TODO_RECORD_USAGE_RESULT
- Duplicate callback result: TODO_RECORD_DUPLICATE_RESULT
- Evidence source path or log reference: TODO_RECORD_SANITIZED_EVIDENCE_PATH

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
- Real Google SSV callback observed in repository evidence: no. The AdMob console/device setup or product-owner verification artifact still needs to be recorded before production readiness can be marked READY.

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

## Manual Verification Checklist

1. Install the TestFlight or Release build.
2. Open the credit/settings screen.
3. Use a dedicated smoke build or future re-enable branch where rewarded-credit UI is intentionally visible.
4. Confirm the UI says rewarded ads are optional and grant free/ad credits, not paid credits.
5. Tap the rewarded-ad button.
6. Confirm the ad loads and completes.
7. Confirm the reward intent was created.
8. Confirm the Google SSV callback reached the Worker.
9. Confirm +2 credits were granted.
10. Confirm the status poll shows `granted`.
11. Confirm `/v1/usage` reflects the balance.
12. Repeat up to the daily cap.
13. Confirm the 4th valid grant is capped.
14. Confirm duplicate callback does not double grant.
15. Confirm invalid ad unit rejects.
16. Confirm invalid signature rejects.
17. Confirm paid credit balance is not consumed before free/ad credits.

## Production Rollback

- If production Worker deploy fails: stop, do not continue SSV smoke, and redeploy the last known-good Worker version if needed.
- If SSV signature verification fails on a real callback: do not grant credits; inspect sanitized logs for `key_id`, presence of `signature`, and whether Google public key fetch succeeded.
- If `ad_unit` is rejected: confirm AdMob sent either the full configured unit ID or the numeric suffix. Do not broaden the allowlist beyond the configured unit and suffix.
- If the credit grant amount is wrong: disable the rewarded ad UI in the app build or remove/disable the AdMob SSV callback until the Worker is fixed.
- If AdMob callback URL is wrong: correct AdMob Console configuration before continuing.
- Do not mark the build main-merge-ready until real SSV evidence, idempotency, daily cap, and normal chat credit consumption are verified and recorded.

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
