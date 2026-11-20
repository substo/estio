"""Keep distinct, informative visual states from a video, including completed slides.

The scan decodes small grayscale frames sequentially.  It never keeps the whole
video in memory and OCR runs only after a visual state settles or a cut occurs.
"""
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

SCAN_WIDTH = 96
SCAN_HEIGHT = 54
SCAN_FPS = 2
PIXELS = SCAN_WIDTH * SCAN_HEIGHT


def run(args, timeout=240):
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout)


def duration(video):
    value = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)]).stdout
    return float(value)


def difference(before, after):
    """Fraction of pixels that changed and mean difference in brightness."""
    changed = total = 0
    for old, new in zip(before, after):
        delta = abs(old - new)
        changed += delta > 18
        total += delta
    return changed / PIXELS, total / PIXELS


def scan_states(video, length):
    """Find stable visual states; a cut also preserves the prior slide's end."""
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(video),
            "-vf", f"fps={SCAN_FPS},scale={SCAN_WIDTH}:{SCAN_HEIGHT},format=gray",
            "-an", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frames = []
    cuts = []
    first = previous = baseline = None
    pending = False
    pending_start = 0.0
    quiet = 0
    last_stable = 0.0
    baseline_start = 0.0
    index = 0
    try:
        while True:
            frame = process.stdout.read(PIXELS)
            if not frame:
                break
            if len(frame) != PIXELS:
                raise ValueError("Incomplete video scan frame")
            when = min(length - 0.05, index / SCAN_FPS)
            index += 1
            if first is None:
                first = previous = baseline = frame
                frames.append({"time": when, "start": 0.0, "reason": "first-stable-state"})
                continue
            recent_fraction, recent_mean = difference(previous, frame)
            baseline_fraction, baseline_mean = difference(baseline, frame)
            is_cut = recent_fraction >= 0.30 and recent_mean >= 16
            if is_cut:
                cuts.append(when)
                # The last frame before a cut often has the complete slide.
                frames.append({"time": max(0, min(when - 0.5, last_stable)), "start": baseline_start,
                               "reason": "last-stable-before-cut"})
            # A single digit or a short revealed bullet changes little of a slide.
            # Require the change to settle rather than demanding a large area.
            if baseline_fraction >= 0.0005 and baseline_mean >= 0.05:
                if not pending:
                    pending_start = when
                pending = True
                quiet = quiet + 1 if recent_fraction < 0.012 and recent_mean < 1.3 else 0
                if quiet >= 2:
                    frames.append({"time": when, "start": pending_start, "reason": "settled-visual-change"})
                    baseline = frame
                    baseline_start = pending_start
                    last_stable = when
                    pending = False
                    quiet = 0
            elif not pending and recent_fraction < 0.012:
                last_stable = when
            previous = frame
        if process.wait(timeout=30) != 0:
            raise RuntimeError("Video scan failed")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        if process.stdout:
            process.stdout.close()
    if not first:
        raise ValueError("Video has no frames")
    frames.append({"time": max(0, last_stable), "start": baseline_start,
                   "reason": "final-stable-state"})
    # Distinct timestamps only. Keep the more specific reason when two events meet.
    by_time = {round(item["time"], 2): item for item in frames if 0 <= item["time"] < length}
    return sorted(by_time.values(), key=lambda item: item["time"]), sorted(set(cuts))


def visual_hash(image):
    pixels = run(["ffmpeg", "-loglevel", "error", "-nostdin", "-i", str(image), "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"], timeout=30).stdout
    if len(pixels) != 72:
        raise ValueError("Invalid comparison image")
    return sum((pixels[row * 9 + col] > pixels[row * 9 + col + 1]) << (row * 8 + col) for row in range(8) for col in range(8))


def detail_score(image):
    """Low-detail blank/fade frames have few strong adjacent edges."""
    pixels = run(["ffmpeg", "-loglevel", "error", "-nostdin", "-i", str(image),
                  "-vf", "scale=96:54,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"], timeout=30).stdout
    if len(pixels) != PIXELS:
        return 0
    edges = sum(abs(pixels[row * SCAN_WIDTH + col] - pixels[row * SCAN_WIDTH + col + 1]) > 22
                for row in range(SCAN_HEIGHT) for col in range(SCAN_WIDTH - 1))
    return edges / (SCAN_HEIGHT * (SCAN_WIDTH - 1))


def words(ocr):
    return set(re.findall(r"[a-z0-9]{2,}", ocr.lower()))


def informative(item):
    # A detailed, stationary diagram can be useful without OCR; a blank card cannot.
    return len(item["words"]) >= 2 or item["detail"] >= 0.16


def same_slide(earlier, later):
    overlap = len(earlier["words"] & later["words"])
    smaller = min(len(earlier["words"]), len(later["words"]))
    return (earlier["hash"] ^ later["hash"]).bit_count() <= 16 and (not smaller or overlap / smaller >= 0.75)


def keep_states(items):
    """Replace partial reveals with the completed slide; retain changed information."""
    kept = []
    for item in items:
        if not informative(item):
            item["path"].unlink(missing_ok=True)
            continue
        if kept and same_slide(kept[-1], item):
            prior = kept[-1]
            added = item["words"] - prior["words"]
            lost = prior["words"] - item["words"]
            replaced_number = any(word.isdigit() for word in added | lost)
            if not replaced_number and (not lost or len(lost) <= max(1, len(prior["words"]) // 5)):
                # The new stable frame contains the old text and a later reveal.
                prior["path"].unlink(missing_ok=True)
                item["reason"] = "completed-slide-reveal" if added else "last-stable-slide"
                item["sceneStart"] = prior["sceneStart"]
                kept[-1] = item
                continue
            if not added and item["detail"] <= prior["detail"]:
                item["path"].unlink(missing_ok=True)
                continue
        if any((item["hash"] ^ prior["hash"]).bit_count() <= 5 and
               len(item["words"] & prior["words"]) / max(1, len(item["words"] | prior["words"])) >= 0.85
               for prior in kept):
            item["path"].unlink(missing_ok=True)
            continue
        kept.append(item)
    return kept


def extract(video, output):
    output.mkdir(parents=True, exist_ok=True)
    length = duration(video)
    if not math.isfinite(length) or length <= 0 or length > 7200:
        raise ValueError("Video duration is outside the 2-hour limit")
    moments, _cuts = scan_states(video, length)
    selected = []
    for index, moment in enumerate(moments):
        second = moment["time"]
        image = output / f"candidate-{index:05d}.jpg"
        try:
            run(["ffmpeg", "-loglevel", "error", "-nostdin", "-ss", str(second), "-i", str(video),
                 "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", "-y", str(image)], timeout=60)
            fingerprint = visual_hash(image)
            ocr = run(["tesseract", str(image), "stdout", "-l", "eng", "--psm", "11"], timeout=30).stdout.decode("utf-8", "replace")
            ocr = re.sub(r"\s+", " ", ocr).strip()[:1200]
            following = next((other["start"] for other in moments if other["start"] > second), length)
            selected.append({"time": second, "sceneStart": moment["start"], "sceneEnd": following,
                             "ocr": ocr, "hash": fingerprint, "words": words(ocr),
                             "detail": detail_score(image), "path": image, "reason": moment["reason"]})
        except (subprocess.SubprocessError, ValueError):
            image.unlink(missing_ok=True)
    kept = keep_states(selected)
    result = []
    for index, item in enumerate(kept):
        target = output / f"frame-{index:05d}.jpg"
        os.replace(item["path"], target)
        result.append({"time": item["time"], "sceneStart": item["sceneStart"], "sceneEnd": item["sceneEnd"],
                       "ocr": item["ocr"], "file": target.name, "selection": item["reason"]})
    return {"duration": length, "frames": result}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: extract-frames.py VIDEO OUTPUT_DIR RESULT_JSON")
    Path(sys.argv[3]).write_text(json.dumps(extract(Path(sys.argv[1]), Path(sys.argv[2])), ensure_ascii=False), encoding="utf-8")
