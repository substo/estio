#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${SUBSTO_APP_DIR:-$HOME/Applications/Substo Video.app}"
APP_BIN="$APP_DIR/Contents/MacOS/substo-app"

if pkill -f "$APP_BIN" 2>/dev/null; then
  echo "Substo Video stopped."
else
  echo "No running Substo Video instance found."
fi
