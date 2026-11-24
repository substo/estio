"""Local, offline, deterministic sound for Make video: an instrumental music bed and a soft whoosh. No model, no network, no licence.

usage: synth-sound.py music OUT.wav SECONDS
       synth-sound.py sfx OUT.wav

Writes a 44.1 kHz mono 16-bit WAV (the caller converts to MP3 and normalises). Needs numpy only.
"""
import sys
import wave

import numpy as np

RATE = 44100
# A slow, warm progression (Am - F - C - G) in A minor; frequencies of the chord tones in Hz.
CHORDS = [
    (220.00, 261.63, 329.63),   # Am: A3 C4 E4
    (174.61, 261.63, 349.23),   # F:  F3 C4 F4
    (196.00, 261.63, 329.63),   # C/G
    (196.00, 246.94, 293.66),   # G:  G3 B3 D4
]
BASS = [110.00, 87.31, 130.81, 98.00]
BPM = 76
BAR = 4 * 60.0 / BPM


def fade(n, fade_in, fade_out):
    env = np.ones(n)
    a, b = int(fade_in * RATE), int(fade_out * RATE)
    if a:
        env[:a] = np.linspace(0, 1, a)
    if b:
        env[-b:] = np.minimum(env[-b:], np.linspace(1, 0, b))
    return env


def pad(freqs, n, t0):
    """A soft pad: detuned triangle-ish partials with a slow swell."""
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for f in freqs:
        for detune in (-0.12, 0.0, 0.12):
            ph = 2 * np.pi * (f + detune) * t
            out += np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    swell = 0.5 - 0.5 * np.cos(2 * np.pi * t / (n / RATE))
    return out * swell * 0.05


def pluck(freq, n):
    t = np.arange(n) / RATE
    env = np.exp(-t * 5.5)
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t)) * env * 0.09


def music(seconds):
    n = int(seconds * RATE)
    out = np.zeros(n)
    bar_n = int(BAR * RATE)
    bars = int(np.ceil(seconds / BAR)) + 1
    rng = np.random.default_rng(7)   # fixed seed: the same script always gets the same bed
    for i in range(bars):
        start = i * bar_n
        if start >= n:
            break
        chord, bass = CHORDS[i % 4], BASS[i % 4]
        end = min(n, start + bar_n + int(0.6 * RATE))
        seg = end - start
        out[start:end] += pad(chord, seg, 0)
        t = np.arange(seg) / RATE
        out[start:end] += np.sin(2 * np.pi * bass * t) * np.exp(-t * 0.9) * 0.16
        # An arpeggio on the eighth notes, a little different each bar so it does not feel looped.
        step = BAR / 8
        for k in range(8):
            if rng.random() < 0.72:
                s = start + int(k * step * RATE)
                m = min(n - s, int(1.4 * RATE))
                if m > 0:
                    out[s:s + m] += pluck(chord[(k * 2 + i) % 3] * (2 if k % 4 == 3 else 1), m)
        # A very quiet pulse on the beats keeps it moving.
        for k in range(4):
            s = start + int(k * BAR / 4 * RATE)
            m = min(n - s, int(0.12 * RATE))
            if m > 0:
                tt = np.arange(m) / RATE
                out[s:s + m] += np.sin(2 * np.pi * 62 * tt) * np.exp(-tt * 30) * 0.10
    out *= fade(n, 1.5, 2.0)
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.85


def whoosh():
    n = int(1.0 * RATE)
    rng = np.random.default_rng(11)
    noise = rng.standard_normal(n)
    t = np.arange(n) / RATE
    # A band-passed noise sweep: the centre rises then falls, with a soft attack and release.
    centre = 300 + 3200 * np.sin(np.pi * np.clip(t / 0.9, 0, 1)) ** 2
    width = 0.55
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    out = np.zeros(n)
    blocks = 10
    size = n // blocks
    for b in range(blocks):
        a, e = b * size, (b + 1) * size if b < blocks - 1 else n
        c = float(np.mean(centre[a:e]))
        mask = np.exp(-0.5 * ((np.log2(np.maximum(freqs, 1) / c)) / width) ** 2)
        full = np.fft.irfft(spec * mask, n)
        win = np.zeros(n)
        win[a:e] = 1.0
        out += full * np.convolve(win, np.hanning(int(0.06 * RATE)) / np.hanning(int(0.06 * RATE)).sum(), mode="same")
    env = np.sin(np.pi * np.clip(t / 0.95, 0, 1)) ** 1.6
    out *= env
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.8


def write(path, samples):
    pcm = np.clip(samples, -1, 1)
    data = (pcm * 32767).astype("<i2").tobytes()
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(data)


def main(argv):
    if len(argv) >= 4 and argv[1] == "music":
        seconds = float(argv[3])
        if not 5 <= seconds <= 600:
            raise SystemExit("seconds must be 5 to 600")
        write(argv[2], music(seconds))
    elif len(argv) == 3 and argv[1] == "sfx":
        write(argv[2], whoosh())
    else:
        raise SystemExit("usage: synth-sound.py music OUT.wav SECONDS | sfx OUT.wav")


if __name__ == "__main__":
    main(sys.argv)
