#!/usr/bin/env bash
# Run the paired Studio companion in the background on this Mac, like the Build worker:
# a per-user LaunchAgent that starts at login, restarts if it stops, and logs to ~/Library/Logs/Estio/.
#   bash scripts/studio-companion-launchagent.sh install    # write the agent and (re)start it now
#   bash scripts/studio-companion-launchagent.sh status     # is it loaded/running, last log lines
#   bash scripts/studio-companion-launchagent.sh restart    # restart after updating the checkout
#   bash scripts/studio-companion-launchagent.sh uninstall  # stop it and remove the agent
# Pair first (once per Mac): npm run start:studio-companion -- pair --origin https://substo.com --name 'My Mac'
set -euo pipefail
label="co.estio.studio-companion"
checkout="$(cd "$(dirname "$0")/.." && pwd)"
plist="$HOME/Library/LaunchAgents/$label.plist"
logs="$HOME/Library/Logs/Estio"
domain="gui/$(id -u)"
config="$HOME/Library/Application Support/Estio/StudioCompanion/config.json"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

install() {
  [[ "$(uname -s)" == "Darwin" ]] || { echo "The Studio companion LaunchAgent is for macOS." >&2; exit 1; }
  [[ -f "$config" ]] || { echo "This Mac is not paired yet. Run: npm run start:studio-companion -- pair --origin https://substo.com --name 'My Mac'" >&2; exit 1; }
  local node; node="$(command -v node || true)"
  [[ -n "$node" ]] || { echo "node was not found on PATH." >&2; exit 1; }
  [[ -d "$checkout/node_modules/tsx" ]] || { echo "Install dependencies first: (cd '$checkout' && npm install)" >&2; exit 1; }
  # Codex/Claude CLIs and the node toolchain must be on the agent's PATH; credentials stay in their own stores.
  local path_value="$HOME/.local/bin:$(dirname "$node"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$logs" "$(dirname "$plist")"
  cat >"$plist.tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$(xml "$node")</string>
		<string>--import</string>
		<string>tsx</string>
		<string>$(xml "$checkout/scripts/studio-companion.ts")</string>
		<string>start</string>
	</array>
	<key>WorkingDirectory</key><string>$(xml "$checkout")</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>HOME</key><string>$(xml "$HOME")</string>
		<key>PATH</key><string>$(xml "$path_value")</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
	<key>ThrottleInterval</key><integer>30</integer>
	<key>ProcessType</key><string>Background</string>
	<key>StandardOutPath</key><string>$(xml "$logs/studio-companion.log")</string>
	<key>StandardErrorPath</key><string>$(xml "$logs/studio-companion-error.log")</string>
</dict>
</plist>
PLIST
  plutil -lint "$plist.tmp" >/dev/null
  mv "$plist.tmp" "$plist"
  launchctl bootout "$domain/$label" 2>/dev/null || true
  launchctl bootstrap "$domain" "$plist"
  launchctl kickstart -k "$domain/$label" >/dev/null 2>&1 || true
  echo "Studio companion installed and started ($label). Logs: $logs/studio-companion.log"
  echo "Check the Mac shows as Online on Studio → Settings → Connected computer within a minute."
}
case "${1:-}" in
  install) install ;;
  restart) launchctl kickstart -k "$domain/$label" && echo "Restarted $label." ;;
  status)
    if launchctl print "$domain/$label" >/dev/null 2>&1; then launchctl print "$domain/$label" | grep -E "state =|pid =|last exit code" || true; else echo "Not installed."; fi
    tail -n 5 "$logs/studio-companion.log" 2>/dev/null || true; tail -n 5 "$logs/studio-companion-error.log" 2>/dev/null || true ;;
  uninstall) launchctl bootout "$domain/$label" 2>/dev/null || true; rm -f "$plist"; echo "Removed $label." ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
