#!/usr/bin/env bash
set -euo pipefail

SKIP_DAEMON=false
SKIP_OCR=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-daemon|-SkipDaemon) SKIP_DAEMON=true; shift ;;
    --skip-ocr|-SkipOcr) SKIP_OCR=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== AutoDayReport Setup ==="
echo "Project: $PROJECT_PATH"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js not found. Install Node.js 18+ from https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Error: Node.js 18+ required." >&2
  exit 1
fi
echo "Node.js: v$(node -v)"

cd "$PROJECT_PATH"

echo ""
echo "Installing npm dependencies..."
npm install

CONFIG_PATH="$PROJECT_PATH/config/config.json"
EXAMPLE_PATH="$PROJECT_PATH/config/config.example.json"
if [[ ! -f "$CONFIG_PATH" ]]; then
  if [[ ! -f "$EXAMPLE_PATH" ]]; then
    echo "Error: config/config.example.json not found." >&2
    exit 1
  fi
  cp "$EXAMPLE_PATH" "$CONFIG_PATH"
  echo ""
  echo "Created config/config.json from example."
  echo "IMPORTANT: Edit config/config.json with your credentials and paths before running."
else
  echo "config/config.json already exists."
fi

echo ""
echo "Building project..."
npm run build

if [[ "$SKIP_OCR" != true ]]; then
  if command -v python3 >/dev/null 2>&1; then
    echo ""
    echo "Installing Python ddddocr (optional OCR fallback)..."
    python3 -m pip install ddddocr || echo "Warning: pip install ddddocr failed. Node OCR will still work."
  else
    echo "python3 not found — skipping ddddocr pip install (Node OCR still available)."
  fi
fi

echo ""
echo "Build complete."

if [[ "$SKIP_DAEMON" == true ]]; then
  echo "Skipped daemon installation (--skip-daemon)."
else
  echo ""
  echo "Installing launchd scheduler daemon..."
  chmod +x "$SCRIPT_DIR/install-daemon.sh" "$SCRIPT_DIR/uninstall-daemon.sh"
  "$SCRIPT_DIR/install-daemon.sh"
fi

echo ""
echo "=== Setup finished ==="
echo "Next steps:"
echo "  1. Edit config/config.json (login, git, qwen, schedule)"
echo "  2. Test manually: npm start"
echo "  3. Test scheduler:  npm run schedule"
echo "  4. Check logs/scheduler.log and logs/launchd.log"
