#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
BACKEND_DIR="${SCRIPT_DIR:h}"
TEMPLATE="$BACKEND_DIR/launchd/com.t4dano.marketdocket.testflight-processor.plist.template"
DEST="$HOME/Library/LaunchAgents/com.t4dano.marketdocket.testflight-processor.plist"
LOG_DIR="$HOME/Library/Logs/MarketDocket/TestFlight"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
sed -e "s|__RUNNER__|$SCRIPT_DIR/run-testflight-processor.sh|g" -e "s|__LOG_DIR__|$LOG_DIR|g" "$TEMPLATE" > "$DEST"
chmod 600 "$DEST"
launchctl bootout "gui/$(id -u)/com.t4dano.marketdocket.testflight-processor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl kickstart -k "gui/$(id -u)/com.t4dano.marketdocket.testflight-processor"
echo "$DEST"
