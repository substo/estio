import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
    DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
    DEFAULT_VIEWING_SESSION_PIN_LENGTH,
    DEFAULT_VIEWING_SESSION_TOKEN_TTL_HOURS,
} from "@/lib/viewings/sessions/types";

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const VIEWING_SESSION_HASH_PEPPER = String(process.env.VIEWING_SESSION_HASH_PEPPER || JWT_SECRET || "").trim();

if (!JWT_SECRET) {
    console.warn("[viewing-session-security] JWT_SECRET is not set. Session auth tokens will fail.");
}

if (!VIEWING_SESSION_HASH_PEPPER) {
    console.warn("[viewing-session-security] VIEWING_SESSION_HASH_PEPPER/JWT_SECRET is not set. Token hashing is not secure.");
}

export type ViewingSessionAccessTokenPayload = {
    sessionId: string;
    locationId: string;
    role: "client" | "agent";
    iat: number;
    exp: number;
};

export type ViewingSessionJoinSecrets = {
    token: string;
    tokenHash: string;
    pinCode: string;
    pinCodeHash: string;
    pinCodeSalt: string;
    expiresAt: Date;
};

function sha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashViewingSessionToken(token: string): string {
    const normalized = String(token || "").trim();
    if (!normalized) throw new Error("Missing session token.");
    return sha256(`${VIEWING_SESSION_HASH_PEPPER}:${normalized}`);
}

export function createPinCodeHash(pinCode: string, salt?: string): { hash: string; salt: string } {
    const normalizedPin = String(pinCode || "").trim();
    if (!normalizedPin) throw new Error("Missing pin code.");
    const resolvedSalt = String(salt || crypto.randomBytes(16).toString("hex")).trim();
    const hash = sha256(`${VIEWING_SESSION_HASH_PEPPER}:${resolvedSalt}:${normalizedPin}`);
    return { hash, salt: resolvedSalt };
}

export function verifyPinCode(inputPin: string, expectedHash: string, salt: string): boolean {
    try {
        const computed = createPinCodeHash(inputPin, salt).hash;
        return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(String(expectedHash || "")));
    } catch {
        return false;
    }
}

function generatePinCode(length: number = DEFAULT_VIEWING_SESSION_PIN_LENGTH): string {
    const digits = Math.max(4, Math.min(8, Math.floor(Number(length) || DEFAULT_VIEWING_SESSION_PIN_LENGTH)));
    let out = "";
    while (out.length < digits) {
        out += Math.floor(Math.random() * 10).toString();
    }
    return out.slice(0, digits);
}

export function generateViewingSessionJoinSecrets(options?: {
    pinLength?: number;
    expiresInHours?: number;
}): ViewingSessionJoinSecrets {
    const token = crypto.randomBytes(32).toString("base64url");
    const pinCode = generatePinCode(options?.pinLength);
    const tokenHash = hashViewingSessionToken(token);
    const { hash: pinCodeHash, salt: pinCodeSalt } = createPinCodeHash(pinCode);
    const expiresInHours = Math.max(1, Math.min(72, Math.floor(Number(options?.expiresInHours || DEFAULT_VIEWING_SESSION_TOKEN_TTL_HOURS))));
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    return {
        token,
        tokenHash,
        pinCode,
        pinCodeHash,
        pinCodeSalt,
        expiresAt,
    };
}

export function generateViewingSessionAccessToken(args: {
    sessionId: string;
    locationId: string;
    role: "client" | "agent";
    ttlSeconds?: number;
}): string {
    if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is not set.");

    const ttlSeconds = Math.max(60, Math.min(24 * 60 * 60, Math.floor(Number(args.ttlSeconds || DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS))));
    return jwt.sign(
        {
            sessionId: args.sessionId,
            locationId: args.locationId,
            role: args.role,
        },
        JWT_SECRET,
        {
            algorithm: "HS256",
            expiresIn: ttlSeconds,
        }
    );
}

export function verifyViewingSessionAccessToken(token: string): ViewingSessionAccessTokenPayload {
    if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is not set.");
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as ViewingSessionAccessTokenPayload;
}
