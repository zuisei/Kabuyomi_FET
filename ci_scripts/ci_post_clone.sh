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

cd "$IOS_DIR"
xcodegen generate
