#!/usr/bin/env bash
# Install the Mac companion's video-transcription tools into its own private environment:
# yt-dlp (audio/video/caption download), Parakeet MLX (local speech model). ffmpeg and tesseract come from Homebrew.
# Safe to re-run. Nothing here uses an API key, an AI subscription or a paid service.
set -euo pipefail
root="$HOME/Library/Application Support/Estio/StudioCompanion/transcription"
for tool in ffmpeg tesseract; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. Run: brew install $tool" >&2; exit 1; }
done
py=$(command -v python3.12 || command -v python3.11 || command -v python3)
mkdir -p "$root"
[[ -x "$root/bin/python" ]] || "$py" -m venv "$root"
"$root/bin/pip" install --quiet --upgrade pip yt-dlp parakeet-mlx
# Download the speech model once so the first real job does not wait for it.
"$root/bin/python" -I -c "from parakeet_mlx import from_pretrained; from_pretrained('mlx-community/parakeet-tdt-0.6b-v3'); print('Parakeet model ready')"
"$root/bin/yt-dlp" --version
echo "Transcription tools installed. Restart the companion and turn on Transcription in Mac Setup."
