import Cryptr from "cryptr";

export function getLegacyCryptr() {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error("ENCRYPTION_KEY is required.");
    }
    return new Cryptr(secret);
}
