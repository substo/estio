#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUBSTO_BUILD_CONFIGURATION="${SUBSTO_BUILD_CONFIGURATION:-debug}" bash "$SCRIPT_DIR/build-app.sh"

echo ""
echo "Studio is installed at ${SUBSTO_APP_DIR:-$HOME/Applications/Studio.app}"
echo "Launch it from Spotlight, or run bash \"$SCRIPT_DIR/install.sh\" once to put the substo command on your PATH."
echo "Agents: claude mcp add substo -- \"$HOME/Applications/Studio.app/Contents/MacOS/substo\" mcp"
