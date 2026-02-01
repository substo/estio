import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get encryption key from environment
 * Falls back to a derived key from JWT_SECRET if CREDENTIAL_ENCRYPTION_KEY not set
 */
function getEncryptionKey(): Buffer {
    const key = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET;

    if (!key) {
        throw new Error('CREDENTIAL_ENCRYPTION_KEY or JWT_SECRET must be set for credential encryption');
    }

    // Ensure key is exactly 32 bytes for AES-256
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypts a password using AES-256-GCM
 * Returns a string in format: iv:tag:ciphertext (all base64 encoded)
 */
export function encryptPassword(password: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(password, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const tag = cipher.getAuthTag();

    // Format: iv:tag:ciphertext
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypts a password encrypted with encryptPassword
 */
export function decryptPassword(encryptedData: string): string {
    const key = getEncryptionKey();

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Encrypts session cookies for storage
 */
export function encryptCookies(cookies: any[]): string {
    return encryptPassword(JSON.stringify(cookies));
}

/**
 * Decrypts stored session cookies
 */
export function decryptCookies(encryptedCookies: string): any[] {
    const json = decryptPassword(encryptedCookies);
    return JSON.parse(json);
}
