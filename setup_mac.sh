#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TANDEM_BUILD_CONFIGURATION="${TANDEM_BUILD_CONFIGURATION:-debug}" bash "$SCRIPT_DIR/build-app.sh"

echo ""
echo "Substo Video is installed at ${TANDEM_APP_DIR:-$HOME/Applications/Substo Video.app}"
echo "Launch it from Spotlight, or run bash \"$SCRIPT_DIR/install.sh\" once to put the tandem command on your PATH."
echo "Agents: claude mcp add tandem -- \"$HOME/Applications/Substo Video.app/Contents/MacOS/tandem\" mcp"
