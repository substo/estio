"""Local Parakeet transcription (Apple Silicon MLX). Reused from the archived Substo editor, hardened for Studio.

usage: transcribe-local.py AUDIO OUTPUT_JSON

Runs fully offline: the model must already be in the isolated Hugging Face cache (see studio-companion-transcription-setup.sh).
It never downloads code or weights, and writes only OUTPUT_JSON.
"""
import json
import os
import sys

MODEL = "animaslabs/parakeet-tdt-0.6b-v3-mlx-4bit"


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: transcribe-local.py AUDIO OUTPUT_JSON")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    from parakeet_mlx import from_pretrained

    model = from_pretrained(MODEL)
    result = model.transcribe(sys.argv[1], chunk_duration=120.0, overlap_duration=15.0)
    output = {
        "text": result.text.strip(),
        "language": "",
        "segments": [
            {"start": float(part.start), "end": float(part.end), "text": part.text.strip()}
            for part in result.sentences
        ],
    }
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
