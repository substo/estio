type ParsedKeyring = {
    primaryKeyId: string;
    keys: Record<string, Buffer>;
};

let cached: ParsedKeyring | null = null;

export function parseSettingsEncryptionKeys(rawKeys: string): unknown {
    try {
        return JSON.parse(rawKeys);
    } catch {
        const trimmed = rawKeys.trim();
        const relaxedObjectMatch = trimmed.match(/^\{([\s\S]*)\}$/);
        if (!relaxedObjectMatch) {
            throw new Error("SETTINGS_ENCRYPTION_KEYS must be valid JSON.");
        }

        const entries = relaxedObjectMatch[1]
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);

        const parsed: Record<string, string> = {};
        for (const entry of entries) {
            const separatorIndex = entry.indexOf(":");
            if (separatorIndex <= 0) {
                throw new Error("SETTINGS_ENCRYPTION_KEYS must be valid JSON.");
            }

            const rawKeyId = entry.slice(0, separatorIndex).trim();
            const rawKeyValue = entry.slice(separatorIndex + 1).trim();
            const keyId = stripOptionalQuotes(rawKeyId);
            const keyValue = stripOptionalQuotes(rawKeyValue);
            if (!keyId || !keyValue) {
                throw new Error("SETTINGS_ENCRYPTION_KEYS must be valid JSON.");
            }
            parsed[keyId] = keyValue;
        }

        return parsed;
    }
}

function stripOptionalQuotes(value: string): string {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseKeyring(): ParsedKeyring {
    const rawKeys = process.env.SETTINGS_ENCRYPTION_KEYS;
    const primaryKeyId = process.env.SETTINGS_ENCRYPTION_PRIMARY_KEY_ID;

    if (!rawKeys) {
        throw new Error("SETTINGS_ENCRYPTION_KEYS is required for settings encryption.");
    }
    if (!primaryKeyId) {
        throw new Error("SETTINGS_ENCRYPTION_PRIMARY_KEY_ID is required for settings encryption.");
    }

    let parsed: unknown;
    try {
        parsed = parseSettingsEncryptionKeys(rawKeys);
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error("SETTINGS_ENCRYPTION_KEYS must be valid JSON.");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("SETTINGS_ENCRYPTION_KEYS must be an object map of key_id -> base64 key.");
    }

    const keys: Record<string, Buffer> = {};
    for (const [keyId, keyValue] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof keyValue !== "string" || !keyValue.trim()) {
            throw new Error(`SETTINGS_ENCRYPTION_KEYS[${keyId}] must be a non-empty base64 string.`);
        }
        const decoded = Buffer.from(keyValue, "base64");
        if (decoded.byteLength !== 32) {
            throw new Error(`SETTINGS_ENCRYPTION_KEYS[${keyId}] must decode to 32 bytes for AES-256-GCM.`);
        }
        keys[keyId] = decoded;
    }

    if (!keys[primaryKeyId]) {
        throw new Error(`Primary key id '${primaryKeyId}' was not found in SETTINGS_ENCRYPTION_KEYS.`);
    }

    return { primaryKeyId, keys };
}

function getKeyring(): ParsedKeyring {
    if (!cached) {
        cached = parseKeyring();
    }
    return cached;
}

export function getSettingsPrimaryKeyId(): string {
    return getKeyring().primaryKeyId;
}

export function getSettingsPrimaryKey(): Buffer {
    const ring = getKeyring();
    return ring.keys[ring.primaryKeyId];
}

export function getSettingsKeyById(keyId: string): Buffer {
    const ring = getKeyring();
    const key = ring.keys[keyId];
    if (!key) {
        throw new Error(`Encryption key '${keyId}' is not available in SETTINGS_ENCRYPTION_KEYS.`);
    }
    return key;
}

export function listSettingsKeyIds(): string[] {
    return Object.keys(getKeyring().keys);
}
