import type { Contact, Prisma, PrismaClient } from "@prisma/client";

type ContactPhoneLookupClient = PrismaClient | Prisma.TransactionClient;

const MIN_PHONE_MATCH_DIGITS = 7;
const STRONG_PHONE_MATCH_DIGITS = 9;

export function normalizePhoneDigits(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
}

export function phoneDigitsLikelyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    const left = normalizePhoneDigits(a);
    const right = normalizePhoneDigits(b);
    if (!left || !right) return false;
    if (left === right) return true;
    return (
        (left.length >= STRONG_PHONE_MATCH_DIGITS && right.endsWith(left))
        || (right.length >= STRONG_PHONE_MATCH_DIGITS && left.endsWith(right))
    );
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    });
}

export async function findContactsByIndexedPhoneDigits(
    client: ContactPhoneLookupClient,
    locationId: string,
    phoneOrDigits: string | null | undefined,
    options: { take?: number } = {}
): Promise<Contact[]> {
    const digits = normalizePhoneDigits(phoneOrDigits);
    if (digits.length < MIN_PHONE_MATCH_DIGITS) return [];

    const take = Math.max(1, Math.min(options.take || 12, 100));

    return client.$queryRaw<Contact[]>`
        SELECT *
        FROM "Contact"
        WHERE "locationId" = ${locationId}
          AND regexp_replace(COALESCE("phone", ''), '\\D', '', 'g') = ${digits}
        ORDER BY "updatedAt" DESC
        LIMIT ${take}
    `;
}

export async function findContactsByPhoneDigitsWithFallback(
    client: ContactPhoneLookupClient,
    locationId: string,
    phoneOrDigits: string | null | undefined,
    options: { take?: number } = {}
): Promise<Contact[]> {
    const digits = normalizePhoneDigits(phoneOrDigits);
    if (digits.length < MIN_PHONE_MATCH_DIGITS) return [];

    const indexedMatches = await findContactsByIndexedPhoneDigits(client, locationId, digits, options);
    if (indexedMatches.length > 0) return indexedMatches;

    const suffix = digits.length > MIN_PHONE_MATCH_DIGITS ? digits.slice(-MIN_PHONE_MATCH_DIGITS) : digits;
    const fallbackTake = Math.max(take, 12);
    const fallback = await client.contact.findMany({
        where: {
            locationId,
            phone: { contains: suffix },
        },
        take: fallbackTake,
        orderBy: { updatedAt: "desc" },
    });

    return uniqueById(fallback)
        .filter((contact) => phoneDigitsLikelyMatch(digits, contact.phone))
        .slice(0, take);
}
