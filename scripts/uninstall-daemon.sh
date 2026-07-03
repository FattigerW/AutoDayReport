#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.autodayreport.scheduler"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
  echo "Removed LaunchAgent: $PLIST_PATH"
else
  echo "LaunchAgent not found (already uninstalled)."
fi
