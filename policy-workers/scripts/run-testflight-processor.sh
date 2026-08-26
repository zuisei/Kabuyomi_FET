#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
BACKEND_DIR="${SCRIPT_DIR:h}"
export MD_ENVIRONMENT=testflight
export MD_ADMIN_URL=https://md-admin-testflight.dznqjmctk7.workers.dev
export MD_KEYCHAIN_ACCOUNT="${MD_KEYCHAIN_ACCOUNT:-0xt4}"
export PATH="/Users/0xt4/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cd "$BACKEND_DIR"
exec node --experimental-strip-types scripts/mac-processor.ts drain
