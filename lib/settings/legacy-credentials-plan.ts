/**
 * Pure planning for scripts/settings/move-legacy-credentials.ts: which legacy plain/app-encrypted credential
 * copies to store as encrypted settings secrets, and which to clear. Never overwrites an existing secret.
 */

export type MoveAction = "store_secret_and_clear" | "clear_only" | "skip_unreadable" | "nothing";

export type MoveDecision = {
    action: MoveAction;
    /** The value to store as the secret (never logged). */
    value: string | null;
    note: string;
};

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * WhatsApp verify token: the location.integrations document copy wins over the Location column
 * (that is what the settings screen showed).
 */
export function planWebhookSecretMove(input: { documentValue: unknown; columnValue: unknown; hasSecret: boolean }): MoveDecision {
    const documentValue = clean(input.documentValue);
    const columnValue = clean(input.columnValue);
    const legacy = documentValue || columnValue;
    if (!legacy && input.documentValue === undefined && !input.columnValue) return { action: "nothing", value: null, note: "no legacy copy" };
    if (input.hasSecret) return { action: "clear_only", value: null, note: "already has secret; would clear legacy copies" };
    if (!legacy) return { action: "clear_only", value: null, note: "legacy copy is empty; would clear it" };
    const note = documentValue && columnValue && documentValue !== columnValue
        ? "document and column differ; document value wins"
        : documentValue ? "from document" : "from column";
    return { action: "store_secret_and_clear", value: legacy, note };
}

/**
 * Outlook browser password or cookies: the column holds app-encrypted text. `decrypt` throws when the
 * ciphertext cannot be read with the current CREDENTIAL_ENCRYPTION_KEY/JWT_SECRET; such rows are skipped
 * (the person reconnects) and the drop migration refuses to run while they remain.
 */
export function planOutlookColumnMove(input: { encrypted: string | null; hasSecret: boolean; decrypt: (value: string) => string }): MoveDecision {
    if (!input.encrypted) return { action: "nothing", value: null, note: "no legacy copy" };
    if (input.hasSecret) return { action: "clear_only", value: null, note: "already has secret; would clear column" };
    try {
        const value = input.decrypt(input.encrypted);
        if (!value) return { action: "skip_unreadable", value: null, note: "decrypted to an empty value; left in place" };
        return { action: "store_secret_and_clear", value, note: "decrypts; would store secret and clear column" };
    } catch {
        return { action: "skip_unreadable", value: null, note: "cannot decrypt with the current key; left in place" };
    }
}
