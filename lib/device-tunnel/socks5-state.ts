export type Socks5ConnectionPhase = "greeting" | "request" | "stream";

/** Keeps the SOCKS handshake boundary explicit so TLS bytes cannot be reparsed. */
export class Socks5ConnectionState {
    private current: Socks5ConnectionPhase = "greeting";

    get phase(): Socks5ConnectionPhase {
        return this.current;
    }

    get isStreaming(): boolean {
        return this.current === "stream";
    }

    acceptGreeting(): void {
        if (this.current !== "greeting") throw new Error("SOCKS greeting is out of sequence");
        this.current = "request";
    }

    acceptConnectRequest(): void {
        if (this.current !== "request") throw new Error("SOCKS connect request is out of sequence");
        this.current = "stream";
    }

    shouldWriteFailure(hasPendingOpen: boolean): boolean {
        return this.current === "request" || hasPendingOpen;
    }
}
