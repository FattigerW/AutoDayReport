#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_LABEL="com.autodayreport.scheduler"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
ENTRY_POINT="$PROJECT_PATH/dist/scheduler.js"
LOG_DIR="$PROJECT_PATH/logs"

NODE_PATH="$(command -v node || true)"
if [[ -z "$NODE_PATH" ]]; then
  echo "Error: Node.js not found in PATH. Please install Node.js 18+ first." >&2
  exit 1
fi

if [[ ! -f "$ENTRY_POINT" ]]; then
  echo "Building project..."
  (cd "$PROJECT_PATH" && npm run build)
fi

if [[ ! -f "$ENTRY_POINT" ]]; then
  echo "Error: Build failed — $ENTRY_POINT not found." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

RUN_TIME_HINT="18:00"
CONFIG_PATH="$PROJECT_PATH/config/config.json"
if [[ -f "$CONFIG_PATH" ]]; then
  RUN_TIME_HINT="$(node -e "
    const c = require('$CONFIG_PATH');
    console.log(c.schedule?.runTime || '18:00');
  " 2>/dev/null || echo "18:00")"
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${ENTRY_POINT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_PATH}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

echo "LaunchAgent installed: $PLIST_PATH"
echo "  Command: node $ENTRY_POINT"
echo "  Daily run time: $RUN_TIME_HINT (from config/config.json schedule.runTime)"
echo ""
echo "Logs: $LOG_DIR/scheduler.log and $LOG_DIR/launchd.log"
echo "To uninstall: ./scripts/uninstall-daemon.sh"
