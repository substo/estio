import { runNativeProcess } from "../companion/process";
import { tmpdir } from "node:os";

/** Eleven v3 is ElevenLabs' expressive model: bracketed audio tags such as [whispers] or [excited] steer delivery. */
export const speechModel = "eleven_v3";
export const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM";
const voicePattern = /^[A-Za-z0-9]{10,40}$/;

/** The key the editor already uses (Keychain service `elevenlabs`), or ELEVENLABS_API_KEY. Never logged or sent anywhere but ElevenLabs. */
export async function elevenLabsKey(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.ELEVENLABS_API_KEY?.trim()) return env.ELEVENLABS_API_KEY.trim();
  try {
    const { stdout } = await runNativeProcess({ command: "/usr/bin/security", args: ["find-generic-password", "-s", "elevenlabs", "-w"], cwd: tmpdir(), timeoutMs: 15_000, maxOutputBytes: 512 });
    return stdout.trim() || null;
  } catch { return null; }
}

export interface SpeechRequest { text: string; apiKey: string; voiceId?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }
/** One narration beat to MP3 bytes. */
export async function synthesizeSpeech({ text, apiKey, voiceId = defaultVoiceId, fetchImpl = fetch, signal }: SpeechRequest): Promise<Buffer> {
  if (!voicePattern.test(voiceId)) throw new Error("invalid_voice_id");
  if (!text.trim() || text.length > 4500) throw new Error("invalid_speech_text");
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST", signal, headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: speechModel }),
  });
  if (!response.ok) throw new Error(`elevenlabs_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error("elevenlabs_empty_audio");
  return bytes;
}
