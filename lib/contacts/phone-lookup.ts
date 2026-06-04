import { Prisma, type Contact, type PrismaClient } from "@prisma/client";

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

function uniquePhoneDigits(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(
        values
            .map(normalizePhoneDigits)
            .filter((digits) => digits.length >= MIN_PHONE_MATCH_DIGITS)
    ));
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

export async function findContactsByIndexedPhoneDigitsBatch(
    client: ContactPhoneLookupClient,
    locationId: string,
    phonesOrDigits: Array<string | null | undefined>
): Promise<Contact[]> {
    const digits = uniquePhoneDigits(phonesOrDigits);
    if (digits.length === 0) return [];

    return client.$queryRaw<Contact[]>`
        SELECT *
        FROM "Contact"
        WHERE "locationId" = ${locationId}
          AND regexp_replace(COALESCE("phone", ''), '\\D', '', 'g') IN (${Prisma.join(digits)})
        ORDER BY "updatedAt" DESC
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
    const take = Math.max(1, Math.min(options.take || 12, 100));

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

export async function findContactsByPhoneDigitsBatchWithFallback(
    client: ContactPhoneLookupClient,
    locationId: string,
    phonesOrDigits: Array<string | null | undefined>
): Promise<Contact[]> {
    const digits = uniquePhoneDigits(phonesOrDigits);
    if (digits.length === 0) return [];

    const indexedMatches = await findContactsByIndexedPhoneDigitsBatch(client, locationId, digits);
    const unmatchedDigits = digits.filter((candidate) =>
        !indexedMatches.some((contact) => phoneDigitsLikelyMatch(candidate, contact.phone))
    );
    if (unmatchedDigits.length === 0) return indexedMatches;

    const suffixes = Array.from(new Set(unmatchedDigits.map((value) =>
        value.length > MIN_PHONE_MATCH_DIGITS ? value.slice(-MIN_PHONE_MATCH_DIGITS) : value
    )));
    const fallback = await client.contact.findMany({
        where: {
            locationId,
            OR: suffixes.map((suffix) => ({ phone: { contains: suffix } })),
        },
        take: Math.max(12, suffixes.length * 3),
        orderBy: { updatedAt: "desc" },
    });

    return uniqueById([
        ...indexedMatches,
        ...fallback.filter((contact) =>
            unmatchedDigits.some((candidate) => phoneDigitsLikelyMatch(candidate, contact.phone))
        ),
    ]);
}
