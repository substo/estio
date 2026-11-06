import db from "@/lib/db";
import type { SettingsDomain } from "./constants";

/**
 * Which encrypted USER-scope secrets exist, without decrypting anything. One query for any number of users,
 * so list screens and sync jobs can ask "who is connected?" (the former plain token columns answered that).
 */
export async function findUserSecretKeys(input: {
    domain: SettingsDomain;
    secretKeys: readonly string[];
    userIds?: readonly string[];
}): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (input.userIds && input.userIds.length === 0) return result;
    const rows = await db.settingsSecret.findMany({
        where: {
            scopeType: "USER",
            domain: input.domain,
            secretKey: { in: [...input.secretKeys] },
            ...(input.userIds ? { scopeId: { in: [...new Set(input.userIds)] } } : {}),
        },
        select: { scopeId: true, secretKey: true },
    });
    for (const row of rows) {
        const keys = result.get(row.scopeId) ?? new Set<string>();
        keys.add(row.secretKey);
        result.set(row.scopeId, keys);
    }
    return result;
}
