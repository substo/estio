#!/usr/bin/env bash
# Guided Setup for Studio video transcription on this Mac.
#   check    report what is installed (default; changes nothing)
#   install  create the isolated Python environment, install yt-dlp + parakeet-mlx into it and download the speech model once
# Everything lands in one private folder; nothing is installed system-wide and no credentials are used.
# ffmpeg/ffprobe/tesseract come from Homebrew: this script prints the exact command, it never runs brew for you.
set -euo pipefail
HOME_DIR="${STUDIO_TRANSCRIPTION_HOME:-$HOME/Library/Application Support/Estio Studio/transcription}"
VENV="$HOME_DIR/venv"
HF="$HOME_DIR/hf-cache"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL="animaslabs/parakeet-tdt-0.6b-v3-mlx-4bit"
PY="${STUDIO_PYTHON:-/opt/homebrew/bin/python3.11}"
tool() { for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" /usr/bin; do [ -x "$d/$1" ] && { echo "$d/$1"; return 0; }; done; return 1; }
row() { printf '%-34s %s\n' "$1" "$2"; }
check() {
  local missing=0 p
  echo "Studio video transcription: $HOME_DIR"
  if [ -x "$VENV/bin/yt-dlp" ]; then row "yt-dlp (isolated)" "$("$VENV/bin/yt-dlp" --version)"; elif p=$(tool yt-dlp); then row "yt-dlp" "$p"; else row "yt-dlp" "MISSING -> $0 install"; missing=1; fi
  for t in ffmpeg ffprobe tesseract; do if p=$(tool "$t"); then row "$t" "$p"; else row "$t" "MISSING -> brew install $([ "$t" = tesseract ] && echo tesseract || echo ffmpeg)"; [ "$t" = tesseract ] || missing=1; fi; done
  if [ -x "$VENV/bin/python" ]; then row "Python (isolated)" "$("$VENV/bin/python" --version 2>&1)"; else row "Python (isolated)" "MISSING -> $0 install"; missing=1; fi
  if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -I -c "import importlib.metadata as m; print(m.version('parakeet-mlx'))" >/dev/null 2>&1; then
    row "parakeet-mlx" "$("$VENV/bin/python" -I -c "import importlib.metadata as m; print(m.version('parakeet-mlx'))")"
  else row "parakeet-mlx" "MISSING -> $0 install"; missing=1; fi
  if ls "$HF"/hub/models--animaslabs--parakeet-tdt-0.6b-v3-mlx-4bit/snapshots/* >/dev/null 2>&1; then row "Parakeet speech model" "downloaded"; else row "Parakeet speech model" "MISSING -> $0 install"; missing=1; fi
  echo; echo "Tesseract is only needed to read slides: without it you still get a transcript, plus a partial-visual note."
  return $missing
}
install() {
  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo "Parakeet MLX needs an Apple Silicon Mac." >&2; exit 1; }
  [ -x "$PY" ] || { echo "Python 3.11 not found at $PY. Install with: brew install python@3.11  (or set STUDIO_PYTHON)." >&2; exit 1; }
  echo "This will create $VENV, install yt-dlp and parakeet-mlx into it, and download the speech model ($MODEL, a few hundred MB) into $HF."
  if [ "${1:-}" != "--yes" ]; then read -r -p "Continue? [y/N] " answer; [ "$answer" = y ] || [ "$answer" = Y ] || { echo "Cancelled."; exit 1; }; fi
  mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"
  "$PY" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet --upgrade yt-dlp parakeet-mlx
  HF_HOME="$HF" HF_HUB_DISABLE_XET=1 "$VENV/bin/python" -I "$SCRIPT_DIR/studio-video/transcribe-local.py" --prepare-model
  echo "Done. Next, if listed as MISSING above: brew install ffmpeg tesseract"
  check || true
}
case "${1:-check}" in
  check) check ;;
  install) shift || true; install "${1:-}" ;;
  *) echo "usage: $0 [check|install [--yes]]" >&2; exit 2 ;;
esac
