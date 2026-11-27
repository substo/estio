import assert from "node:assert/strict";
import { test } from "node:test";
import { soundFromTranscript, soundFromVolume, speechMatchesLine } from "./shot-sound";

const line = "Weak sound is the first mistake that makes viewers leave.";

test("speech that says the line uses the clip's own sound", () => {
  assert.equal(soundFromTranscript("weak sound is the first mistake that makes viewers leave", line), "own");
  assert.equal(soundFromTranscript("So, weak sound, it's the first mistake, makes viewers leave", line), "own");
});
test("silence, a tone, b-roll chatter or unrelated speech keep the voiceover", () => {
  assert.equal(soundFromTranscript(null, line), "voiceover");
  assert.equal(soundFromTranscript("", line), "voiceover");
  assert.equal(soundFromTranscript("beep", line), "voiceover");
  assert.equal(soundFromTranscript("let me show you around the kitchen today", line), "voiceover");
  assert.equal(speechMatchesLine("yes", "Yes."), false);
});
test("the ffmpeg fallback: no audio, silence and a steady tone are not speech", () => {
  assert.equal(soundFromVolume(""), "voiceover");
  assert.equal(soundFromVolume("mean_volume: -91.0 dB\nmax_volume: -91.0 dB"), "voiceover");
  assert.equal(soundFromVolume("mean_volume: -20.1 dB\nmax_volume: -17.1 dB"), "voiceover");
  assert.equal(soundFromVolume("mean_volume: -27.0 dB\nmax_volume: -8.2 dB"), "own");
});
