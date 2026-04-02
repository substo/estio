import { randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";
export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function createGoogleOAuthState(): string {
    return randomBytes(32).toString("base64url");
}

export function isGoogleOAuthStateValid(expected: string | null, received: string | null): boolean {
    if (!expected || !received) return false;

    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(received, "utf8");
    if (expectedBuffer.length !== receivedBuffer.length) return false;

    return timingSafeEqual(expectedBuffer, receivedBuffer);
}
