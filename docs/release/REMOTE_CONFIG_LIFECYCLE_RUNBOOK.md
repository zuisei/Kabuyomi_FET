# Remote Config Reviewed Refresh Runbook

Status: active production operating contract

Kabuyomi does not silently renew remote-config freshness. KV and D1 LKG retain the same human-authored `updatedAt`; D1 `stored_at` is only cache-storage evidence and never extends trust. A reviewed config may remain unchanged, but an operator must re-approve its exact config hash and publish a new version/timestamp on schedule.

## Bounded lifecycle

The standard production/test envelope uses `maxStaleAgeSeconds: 3888000` (45 days). The Worker enforces these lifecycle points:

| Age from reviewed `updatedAt` | Runtime state | Required operator action |
|---|---|---|
| 0-13 days | `fresh` | Daily monitor only |
| 14-34 days | `review_due` | Open/refresh the review ticket within 1 business day |
| 35-45 days | `critical` | Page the release owner; acknowledge within 1 hour and republish a reviewed envelope within 24 hours |
| More than 45 days | `expired` | Fail closed; page immediately and restore only through the reviewed publication flow |

Exact operating cadence:

- At 09:00 JST every day, export and run the read-only lifecycle inspector for test and production.
- At least once every 14 calendar days, a human reviews the complete config and republishes it with a new version, even when no config value changes.
- Configure alerts for `remote_config_refresh_due`, `remote_config_refresh_critical`, `remote_config_expired`, `remote_config_timestamp_invalid`, and `remote_config_fail_closed`.
- Do not make an automation call `refresh-reviewed` or `wrangler kv key put`. Those are human-approved release actions.

Shorter operator-selected expiry values are allowed for a deliberate canary. Their warning thresholds scale down so review is due by half-life and critical before expiry. Values above 45 days are rejected.

### Legacy installed-client bridge

`legacyClientCompatibility` is a separate, non-rolling production migration
gate for the already-released UUID `x-device-key` client. Its complete shape is:

```json
{
  "enabled": false,
  "expiresAt": "1970-01-01T00:00:00.000Z"
}
```

When enabled, `expiresAt` must be after the envelope's reviewed `updatedAt` and
no more than 30 days later. The Worker accepts it only in an exact production
environment and only for usage, company read/refresh, watchlist add/remove,
chat, and quote translation. It never authorizes welcome, subscription,
purchase, rewarded-ad, account, migration, or internal grants. Model routes
still require credits; a newly invented UUID has zero credits.

The inspector fails the monitor at seven days remaining (`review_due`), at 24
hours (`critical`), and after expiry (`expired`). Extending the bridge changes
the reviewed config hash and requires a new explicit review; refreshing envelope
metadata alone cannot roll the expiry forward.

For a deliberate short canary, pass `--max-stale-age-seconds <seconds>` to `refresh-reviewed` and record the shorter hard stop in the change ticket. Omit that option for the standard 45-day envelope.

## Envelope shape

Use a complete typed envelope. Partial deployed payloads fail closed.

```json
{
  "version": "production-YYYYMMDD-N",
  "updatedAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "maxStaleAgeSeconds": 3888000,
  "config": {
    "...": "complete reviewed config fields"
  }
}
```

`version` and `updatedAt` describe the human review. Rewriting either value without reviewing the exact config hash is prohibited.

The complete deployed config must also contain this compatibility gate, even when disabled:

```json
"legacyClientCompatibility": {
  "enabled": false,
  "expiresAt": "1970-01-01T00:00:00.000Z"
}
```

`expiresAt` is a canonical UTC ISO-8601 timestamp with milliseconds. The legacy bridge is production-only and allows only the released client's core read/spend routes. Enabling it requires a fixed `expiresAt` later than the envelope's reviewed `updatedAt` and no more than 30 days later. Runtime authorization stops at `now >= expiresAt`; refreshing envelope metadata does not move this deadline. The normal activation recommendation is one fixed 30-day window from the reviewed production rollout, then disable the field after adoption is verified. Test must always publish the disabled object above. Never enable the bridge for purchase, subscription, rewarded-credit, account, internal, or migration traffic.

The inspector reports the bridge as `active` while more than 7 days remain, `review_due` at 7 days or less, `critical` at 24 hours or less, and `expired` at the deadline. Its exit code is the more severe of envelope and bridge lifecycle state, so the existing scheduled monitor warns before compatibility ends: `0` active/disabled, `1` review due, `2` critical, and `3` expired.

## Read-only daily inspection

From `workers/`, export production without changing it:

```bash
npx wrangler kv key get remote_config --binding KABUYOMI_CACHE --remote --preview false --text --config wrangler.toml > /tmp/kabuyomi-remote-config-production.json
npm run remote-config:inspect -- /tmp/kabuyomi-remote-config-production.json
```

Use `--config wrangler.test.toml` for the test Worker. The inspector validates the complete envelope and prints `configSha256`, age, lifecycle status, and seconds until expiry. Exit status is `0` for fresh, `1` for review due, `2` for critical, and `3` for expired/future-invalid. Validation/usage errors use `64` or `65`.

The daily monitor may alert from this exit status, but it must not write KV or alter the envelope.

## Human-reviewed refresh

1. Export the live envelope and save its inspector output with the release ticket.
2. Review every config field against `shared/product-catalog.json`, current emergency state, production dependencies, and the intended capability surface.
3. Record the inspector's exact `configSha256` in the ticket. If any config value changes, review the new complete JSON and obtain its new hash before continuing.
4. Create a new envelope in a separate file. This command refuses a mismatched approved hash, a reused version, an in-place overwrite, an invalid config, or an existing output file:

```bash
npm run remote-config:refresh-reviewed -- \
  /tmp/kabuyomi-remote-config-production.json \
  /tmp/kabuyomi-remote-config-production-reviewed.json \
  --approved-config-sha256 <ticket-approved-sha256> \
  --version production-YYYYMMDD-N
```

5. Confirm the command reports `configChanged: false`, then inspect the output:

```bash
npm run remote-config:inspect -- /tmp/kabuyomi-remote-config-production-reviewed.json
```

6. Obtain the normal production change approval, then publish explicitly:

```bash
npx wrangler kv key put remote_config \
  --binding KABUYOMI_CACHE \
  --remote \
  --preview false \
  --config wrangler.toml \
  --path /tmp/kabuyomi-remote-config-production-reviewed.json
```

7. Read the value back into a different file, inspect it, and compare `version`, `updatedAt`, and `configSha256` to the approved ticket.
8. Confirm Worker logs select the new KV version. On the next successful read the D1 LKG may update its storage timestamp, but it must retain the same reviewed `updatedAt` and config hash.

## Incident and rollback rules

- Emergency environment disables continue to override an otherwise trusted config and do not require falsifying freshness metadata.
- If the config expires, keep fail-closed behavior until a human completes the same hash-review flow. Do not patch only `updatedAt` in KV or D1.
- To roll back, start from the previously reviewed config, review its hash again against current dependencies, assign a new version/timestamp, and publish through the same steps.
- Never delete or edit the D1 LKG as a freshness workaround. It is a fallback copy, not an independent lease.

## Mixed-version Worker cutover guard

Workers released before the strict-envelope parser do not understand the nested
`config` object. They may ignore it and fall back to permissive legacy defaults.
For a rollout from one of those versions:

1. Publish a complete reviewed **dated flat** bridge containing the same typed
   fields at the top level, with `maintenanceMode: true` and every grant-producing
   capability disabled.
2. Probe the live Worker until the maintenance response is observed.
3. Apply migrations and deploy the new Worker at 100%; do not leave an old/new
   percentage split.
4. Verify the deployment is fully on the strict-parser version before publishing
   the final nested envelope and clearing maintenance.

Rollback order is equally strict: republish the dated flat maintenance bridge,
wait until the current Worker serves maintenance, and only then roll back the
Worker. Never roll an old Worker back while KV contains only a nested envelope.

This runbook never automates a reviewed refresh or KV write; release evidence
records each operator-approved publication separately.
