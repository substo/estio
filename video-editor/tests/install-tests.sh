#!/usr/bin/env bash
# Exercise installation in a disposable folder, without building or opening the app.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
BIN="$SCRATCH/bin with spaces"
# The skill goes under HOME; keep it out of the real one.
export HOME="$SCRATCH/home dir"

bash "$SCRIPT_DIR/install.sh" "$BIN"
[[ -L "$BIN/substo" && "$(readlink "$BIN/substo")" == "$SCRIPT_DIR/substo" ]]
bash "$SCRIPT_DIR/install.sh" "$BIN"

# The agent skill is linked where Claude Code and Codex look.
for dir in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
  [[ -L "$dir/substo-video" && "$(readlink "$dir/substo-video")" == "$SCRIPT_DIR/skills/substo-video" ]]
done
[[ -f "$HOME/.claude/skills/substo-video/SKILL.md" ]]
# Someone's own skill called substo is left alone, and that's not an error.
rm "$HOME/.agents/skills/substo-video"
mkdir "$HOME/.agents/skills/substo-video"
bash "$SCRIPT_DIR/install.sh" "$BIN" 2>/dev/null
[[ -d "$HOME/.agents/skills/substo-video" && ! -L "$HOME/.agents/skills/substo-video" ]]
# SUBSTO_SKILL_DIRS chooses the folders, or skips the skill when empty.
SUBSTO_SKILL_DIRS="$SCRATCH/elsewhere" bash "$SCRIPT_DIR/install.sh" "$BIN" >/dev/null
[[ -L "$SCRATCH/elsewhere/substo-video" ]]
rm "$HOME/.claude/skills/substo-video"
SUBSTO_SKILL_DIRS="" bash "$SCRIPT_DIR/install.sh" "$BIN" >/dev/null
[[ ! -e "$HOME/.claude/skills/substo-video" ]]

# Moving from an older clone should replace its dangling symlink.
ln -sfn "$SCRATCH/old-clone/substo" "$BIN/substo"
bash "$SCRIPT_DIR/install.sh" "$BIN"
[[ "$(readlink "$BIN/substo")" == "$SCRIPT_DIR/substo" ]]

# Invoke the installed link with a fake app bundle to check path resolution
# and argument forwarding, without triggering setup or touching the real app.
APP="$SCRATCH/app with spaces/Studio.app"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/MacOS/substo" <<'CLI'
#!/usr/bin/env bash
printf '%s\n' "$@"
CLI
chmod +x "$APP/Contents/MacOS/substo"
[[ "$(SUBSTO_APP_DIR="$APP" "$BIN/substo" 'two words' --json)" == $'two words\n--json' ]]

# The app was called Substo Video. Without SUBSTO_APP_DIR, the launcher
# uses ~/Applications/Studio.app, and the old bundle until Studio.app is
# installed. These checks say what went wrong themselves (bash 3.2's
# `set -e` ignores a failing bare [[ ]]).
launches() {
  local got
  got="$("$BIN/substo" which)"
  if [[ "$got" != "$1" ]]; then
    echo "FAIL: the launcher ran '$got', not '$1'" >&2
    exit 1
  fi
}
fake_app() {
  mkdir -p "$1/Contents/MacOS"
  printf '#!/usr/bin/env bash\necho %s\n' "$2" > "$1/Contents/MacOS/substo"
  chmod +x "$1/Contents/MacOS/substo"
}
fake_app "$HOME/Applications/Substo Video.app" old-app
launches old-app
fake_app "$HOME/Applications/Studio.app" studio
launches studio
rm -rf "$HOME/Applications"

# `substo url` adds this Mac's key to a substo:// link and opens it in
# the background. A fake `open` shows what it would have opened.
FAKE_BIN="$SCRATCH/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/open" <<'OPEN'
#!/usr/bin/env bash
printf '%s\n' "$@"
OPEN
chmod +x "$FAKE_BIN/open"
if PATH="$FAKE_BIN:$PATH" "$BIN/substo" url 'debug?out=/tmp/tree.txt' 2>/dev/null; then
  echo "FAIL: substo url sent a link without a key" >&2
  exit 1
fi
KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
mkdir -p "$HOME/Library/Application Support/Substo"
printf '%s' "$KEY" > "$HOME/Library/Application Support/Substo/url-key"
# A bare [[ ]] doesn't stop macOS's bash 3.2 under `set -e`, so these
# checks say what went wrong and exit themselves. The link goes to the
# selected app (here the fake one), never whichever app claims the scheme.
opens() {
  local got want
  got="$(PATH="$FAKE_BIN:$PATH" SUBSTO_APP_DIR="$APP" "$BIN/substo" url "$1")"
  want="$(printf '%s\n' -g -a "$APP" "$2")"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: substo url '$1' opened '$got', not '$want'" >&2
    exit 1
  fi
}
opens 'screenshot?out=/tmp/a b.png' "substo://screenshot?out=/tmp/a b.png&key=$KEY"
opens 'command' "substo://command?key=$KEY"
opens 'substo-dev://seek?t=3' "substo-dev://seek?t=3&key=$KEY"
# The key goes before a #fragment, in the query where the app reads it.
opens 'seek?t=3#here' "substo://seek?t=3&key=$KEY#here"
# A link that isn't Studio's never gets the key.
for link in 'https://example.com/?' 'file:///tmp/a' 'substox://seek?t=3'; do
  if OUT="$(PATH="$FAKE_BIN:$PATH" "$BIN/substo" url "$link" 2>/dev/null)" || [[ -n "$OUT" ]]; then
    echo "FAIL: substo url sent the key to $link" >&2
    exit 1
  fi
done

# While an install swaps the app in, the launcher waits for it instead of
# starting a build of its own. A copy of it with a fake setup shows which.
LAUNCHER="$SCRATCH/launcher"
mkdir -p "$LAUNCHER"
cp "$SCRIPT_DIR/substo" "$LAUNCHER/substo"
cat > "$LAUNCHER/setup_mac.sh" <<'SETUP'
#!/usr/bin/env bash
touch "$(dirname "$0")/setup-ran"
exit 1
SETUP
SWAPPING="$SCRATCH/swapping/Studio.app"
( sleep 1; mkdir -p "$SWAPPING/Contents/MacOS"; cp "$APP/Contents/MacOS/substo" "$SWAPPING/Contents/MacOS/substo" ) &
[[ "$(SUBSTO_APP_DIR="$SWAPPING" bash "$LAUNCHER/substo" waited)" == "waited" ]]
wait
[[ ! -e "$LAUNCHER/setup-ran" ]]

# A regular executable or directory with the same name belongs to the user.
rm "$BIN/substo"
printf 'keep me\n' > "$BIN/substo"
if bash "$SCRIPT_DIR/install.sh" "$BIN"; then
  echo "FAIL: installer overwrote a regular file" >&2
  exit 1
fi
[[ "$(cat "$BIN/substo")" == "keep me" ]]
rm "$BIN/substo"
mkdir "$BIN/substo"
if bash "$SCRIPT_DIR/install.sh" "$BIN"; then
  echo "FAIL: installer replaced a directory" >&2
  exit 1
fi
[[ -d "$BIN/substo" && ! -L "$BIN/substo/substo" ]]

bash "$SCRIPT_DIR/install.sh" --help
if bash "$SCRIPT_DIR/install.sh" --unknown; then
  echo "FAIL: installer accepted an unknown option" >&2
  exit 1
fi
if bash "$SCRIPT_DIR/install.sh" "$BIN" extra; then
  echo "FAIL: installer accepted extra arguments" >&2
  exit 1
fi
echo "Installer tests passed."
