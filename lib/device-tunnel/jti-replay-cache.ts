export class BoundedJtiReplayCache {
    private readonly entries = new Map<string, number>();

    constructor(private readonly maximumEntries = 10_000) {
        if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
            throw new Error("JTI replay cache size must be a positive integer");
        }
    }

    consume(jti: string, expiresAtSeconds: number, nowMs = Date.now()) {
        if (!jti || !Number.isSafeInteger(expiresAtSeconds)) return false;
        for (const [key, expiresAtMs] of this.entries) {
            if (expiresAtMs <= nowMs) this.entries.delete(key);
        }
        if (this.entries.has(jti)) return false;
        // Fail closed at the bound. Evicting an unexpired JTI would make that
        // token replayable, defeating the connection fence under load.
        if (this.entries.size >= this.maximumEntries) return false;
        this.entries.set(jti, expiresAtSeconds * 1_000);
        return true;
    }

    get size() {
        return this.entries.size;
    }
}
