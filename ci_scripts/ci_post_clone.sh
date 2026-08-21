#!/bin/sh
set -eu

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(pwd)}"
IOS_DIR="$REPO_ROOT/ios"

if [ ! -f "$IOS_DIR/project.yml" ]; then
  echo "error: ios/project.yml not found at $IOS_DIR" >&2
  exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install xcodegen
  else
    echo "error: xcodegen is not installed and Homebrew is unavailable" >&2
    exit 1
  fi
fi

# ビルド番号が本番 Worker の App Attest 許可リストに入っているか確認する。
# 外れたまま提出すると、新規インストールの attestation が拒否され、
# ウェルカムクレジットも購入も無言で落ちる(ユーザーにはエラーが出ない)。
WRANGLER_TOML="$REPO_ROOT/workers/wrangler.toml"
if [ -f "$WRANGLER_TOML" ]; then
  BUILD_NUMBER=$(sed -n 's/^[[:space:]]*CURRENT_PROJECT_VERSION:[[:space:]]*\([^[:space:]]*\).*/\1/p' "$IOS_DIR/project.yml" | head -1)
  ALLOWLIST=$(sed -n 's/^APP_ATTEST_ALLOWED_BUNDLE_VERSIONS[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$WRANGLER_TOML" | head -1)
  if [ -z "$BUILD_NUMBER" ] || [ -z "$ALLOWLIST" ]; then
    echo "error: could not read CURRENT_PROJECT_VERSION or APP_ATTEST_ALLOWED_BUNDLE_VERSIONS" >&2
    exit 1
  fi
  if ! printf '%s' ",$ALLOWLIST," | tr -d ' ' | grep -q ",$BUILD_NUMBER,"; then
    echo "error: build $BUILD_NUMBER is not in the production App Attest allowlist [$ALLOWLIST]." >&2
    echo "       Add it to workers/wrangler.toml and deploy the Worker before submitting." >&2
    exit 1
  fi
  echo "App Attest allowlist check passed: build $BUILD_NUMBER in [$ALLOWLIST]"
fi

cd "$IOS_DIR"
xcodegen generate
