#!/usr/bin/env bash
set -euo pipefail

base="${1:-${MARKET_DOCKET_API_URL:-http://localhost:8787}}"
curl --retry 3 --retry-all-errors -fsS "$base/v1/health" \
  | jq -e '.data.status == "ok" and .data.core and .data.ops' >/dev/null
events="$(curl --retry 3 --retry-all-errors -fsS "$base/v1/events")"
mode="$(jq -r '.data_mode' <<<"$events")"
count="$(jq -r '.data | length' <<<"$events")"
jq -e '.data_mode == "synthetic" or .data_mode == "live" or .data_mode == "mixed"' <<<"$events" >/dev/null

if [[ "$mode" == "synthetic" ]]; then
  test "$count" -gt 0
  event_id="E6A78BA1-531A-4C10-9F2F-0B6FD116A001"
  curl --retry 3 --retry-all-errors -fsSG "$base/v1/events/$event_id/replay" --data-urlencode 'as_of=2026-07-16T10:07:18-04:00' \
    | jq -e '(.data.timelineItems | length) == 3 and .data.documentVersion.version == 1 and .data.laterFactCount == 3' >/dev/null
elif [[ "$count" -gt 0 ]]; then
  event_id="$(jq -r '.data[0].id' <<<"$events")"
  last_activity="$(jq -r '.data[0].lastActivityAt' <<<"$events")"
  evidence="$(curl --retry 3 --retry-all-errors -fsS "$base/v1/events/$event_id/evidence")"
  first_version_time="$(jq -r '.data.documentVersions[0].publishedAt' <<<"$evidence")"
  jq -e '.data.documentInfo.contentHash.algorithm == "sha256" and (.data.documentInfo.contentHash.value | test("^[0-9a-f]{64}$"))' <<<"$evidence" >/dev/null
  curl --retry 3 --retry-all-errors -fsSG "$base/v1/events/$event_id/replay" --data-urlencode "as_of=$first_version_time" \
    | jq -e '.data.documentVersion.version == 1' >/dev/null
  curl --retry 3 --retry-all-errors -fsSG "$base/v1/events/$event_id/replay" --data-urlencode "as_of=$last_activity" \
    | jq -e '.data.documentVersion != null' >/dev/null
fi

post_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$base/v1/events")"
test "$post_status" = "405"
etag="$(curl -sSI "$base/v1/events" | awk 'tolower($1)=="etag:" {sub("\r$", "", $2); print $2}')"
test -n "$etag"
conditional_status="$(curl -sS -o /dev/null -w '%{http_code}' -H "If-None-Match: $etag" "$base/v1/events")"
test "$conditional_status" = "304"

printf 'smoke=PASS url=%s mode=%s events=%s post=%s conditional=%s\n' "$base" "$mode" "$count" "$post_status" "$conditional_status"
