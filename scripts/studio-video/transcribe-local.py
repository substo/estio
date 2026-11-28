"""Local Parakeet transcription (Apple Silicon MLX). Reused from the archived Substo editor, hardened for Studio.

usage: transcribe-local.py AUDIO OUTPUT_JSON

Runs fully offline: the model must already be in the isolated Hugging Face cache (see studio-companion-transcription-setup.sh).
It never downloads code or weights, and writes only OUTPUT_JSON.
"""
import json
import os
import sys

MODEL = "animaslabs/parakeet-tdt-0.6b-v3-mlx-4bit"


def load_model(*, offline):
    import mlx.core as mx
    import mlx.nn as nn
    from huggingface_hub import hf_hub_download
    from parakeet_mlx.utils import from_config

    config_path = hf_hub_download(MODEL, "config.json", local_files_only=offline)
    weights_path = hf_hub_download(MODEL, "model.safetensors", local_files_only=offline)
    with open(config_path, encoding="utf-8") as handle:
        config = json.load(handle)
    weights = mx.load(weights_path)
    model = from_config(config)
    nn.quantize(
        model,
        **config["quantization"],
        class_predicate=lambda path, module: f"{path}.scales" in weights,
    )
    model.load_weights(list(weights.items()))
    return model


def main():
    if sys.argv[1:] == ["--prepare-model"]:
        load_model(offline=False)
        print("model ready")
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: transcribe-local.py AUDIO OUTPUT_JSON | --prepare-model")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    model = load_model(offline=True)
    progress_file = os.environ.get("STUDIO_PROGRESS_FILE")

    def report(current, total):
        # Best effort: the companion reads this file to show a real percentage.
        if not progress_file or not total:
            return
        try:
            percent = max(0, min(99, int(100 * float(current) / float(total))))
            with open(progress_file, "w", encoding="utf-8") as handle:
                json.dump({"phase": "transcribe", "percent": percent, "detail": "Transcribing on your Mac"}, handle)
        except Exception:
            pass

    result = model.transcribe(sys.argv[1], chunk_duration=120.0, overlap_duration=15.0, chunk_callback=report)
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
