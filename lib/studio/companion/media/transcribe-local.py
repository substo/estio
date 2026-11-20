import json
import sys


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: transcribe-local.py AUDIO OUTPUT_JSON")
    from parakeet_mlx import from_pretrained

    model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
    result = model.transcribe(sys.argv[1], chunk_duration=120.0, overlap_duration=15.0)
    output = {
        "text": result.text.strip(),
        "language": "",
        "segments": [
            {"start": part.start, "end": part.end, "text": part.text.strip()}
            for part in result.sentences
        ],
    }
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
