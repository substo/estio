type Entry = { audio: Buffer; expiresAt: number };

const clips = new Map<string, Entry>();
const pending = new Map<string, Promise<Buffer>>();
const MAX_BYTES = 48 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;

export async function getOrGenerateReplaySpeech(key: string, generate: () => Promise<Buffer>): Promise<{ audio: Buffer; generated: boolean }> {
    const now = Date.now();
    for (const [oldKey, entry] of clips) if (entry.expiresAt <= now) clips.delete(oldKey);
    const cached = clips.get(key);
    if (cached) {
        clips.delete(key);
        clips.set(key, cached);
        return { audio: cached.audio, generated: false };
    }
    const inFlight = pending.get(key);
    if (inFlight) return { audio: await inFlight, generated: false };

    const request = generate();
    pending.set(key, request);
    try {
        const audio = await request;
        if (audio.length <= MAX_BYTES) {
            clips.set(key, { audio, expiresAt: Date.now() + TTL_MS });
            let bytes = [...clips.values()].reduce((sum, entry) => sum + entry.audio.length, 0);
            while (bytes > MAX_BYTES) {
                const oldestKey = clips.keys().next().value;
                if (!oldestKey) break;
                bytes -= clips.get(oldestKey)?.audio.length || 0;
                clips.delete(oldestKey);
            }
        }
        return { audio, generated: true };
    } finally {
        pending.delete(key);
    }
}
