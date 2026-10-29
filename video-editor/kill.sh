#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${SUBSTO_APP_DIR:-$HOME/Applications/Studio.app}"
APP_BIN="$APP_DIR/Contents/MacOS/substo-app"
# The app was called Substo Video; stop a copy still running from there too.
OLD_APP_BIN="$HOME/Applications/Substo Video.app/Contents/MacOS/substo-app"

stopped=false
pkill -f "$APP_BIN" 2>/dev/null && stopped=true
if [[ -z "${SUBSTO_APP_DIR:-}" ]] && pkill -f "$OLD_APP_BIN" 2>/dev/null; then stopped=true; fi
if [[ "$stopped" == true ]]; then
  echo "Studio stopped."
else
  echo "No running Studio instance found."
fi
