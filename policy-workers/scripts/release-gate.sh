#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
testflight_url="${MARKET_DOCKET_TESTFLIGHT_API_URL:-https://md-api-testflight.dznqjmctk7.workers.dev}"
production_url="${MARKET_DOCKET_PRODUCTION_API_URL:-https://md-api-prod.dznqjmctk7.workers.dev}"

node_version="$(node --version 2>/dev/null || printf 'not-found')"
if ! node --experimental-strip-types -e '' >/dev/null 2>&1; then
  printf 'release-gate=BLOCKED reason=unsupported-node current=%s required="Node >=22 with TypeScript stripping (validated with Node 24)"\n' "$node_version" >&2
  exit 2
fi

cd "$root"
npm test
npm run typecheck
bash scripts/smoke.sh "$testflight_url"
bash scripts/smoke.sh "$production_url"
npm run audit:parity -- "$testflight_url" "$production_url"

printf 'release-gate=PASS testflight=%s production=%s\n' "$testflight_url" "$production_url"
