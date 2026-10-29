#!/usr/bin/env bash
# Run setup_mac.sh to build the app, then install this repo's launcher on PATH
# and its agent skill where Claude Code and Codex look for skills.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-$HOME/.local/bin}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: bash install.sh [target_bin_dir]"
  echo "Links substo into target_bin_dir (default: ~/.local/bin), and the Studio"
  echo "skill into ~/.claude/skills and ~/.agents/skills for Claude Code and Codex."
  echo "Set SUBSTO_SKILL_DIRS to other folders (space separated), or to nothing to skip that."
  echo "Build the app first with bash setup_mac.sh."
  exit 0
fi
if [[ $# -gt 1 || "$TARGET_DIR" == -* ]]; then
  echo "Usage: bash install.sh [target_bin_dir]" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
DEST="$TARGET_DIR/substo"
# Repoint old launcher symlinks, but don't overwrite someone's own executable.
if [[ -e "$DEST" && ! -L "$DEST" ]]; then
  echo "Refusing to replace $DEST: it is not a symlink." >&2
  exit 1
fi
chmod +x "$SCRIPT_DIR/substo"
ln -sfn "$SCRIPT_DIR/substo" "$DEST"
echo "Installed $DEST -> $SCRIPT_DIR/substo"

# The skill that teaches agents to edit with Studio. Like the launcher, a
# skill of the same name that isn't a link is someone's own: left alone.
if [[ -n "${SUBSTO_SKILL_DIRS+set}" ]]; then
  read -r -a SKILL_DIRS <<< "$SUBSTO_SKILL_DIRS"
else
  SKILL_DIRS=("$HOME/.claude/skills" "$HOME/.agents/skills")
fi
for dir in ${SKILL_DIRS[@]+"${SKILL_DIRS[@]}"}; do
  mkdir -p "$dir"
  if [[ -e "$dir/substo-video" && ! -L "$dir/substo-video" ]]; then
    echo "Left $dir/substo-video alone: it isn't a link, so it's not this skill." >&2
    continue
  fi
  ln -sfn "$SCRIPT_DIR/skills/substo-video" "$dir/substo-video"
  echo "Linked the Studio skill into $dir"
done
case ":${PATH}:" in
  *":$TARGET_DIR:"*) ;;
  *) printf 'Add this directory to PATH in ~/.zshrc: export PATH="%s:$PATH"\n' "$TARGET_DIR" ;;
esac
echo "Run substo app to open the editor, or substo help for CLI commands."
