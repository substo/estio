import type { people_v1 } from "googleapis";
import db from "@/lib/db";

export const GOOGLE_CONTACT_DIRECTORY_MAX_AGE_MS = 10 * 60 * 1000;

export type GoogleContactSearchResult = {
    resourceName: string | undefined;
    name: string | undefined;
    email: string | undefined;
    phone: string | undefined;
    photo: string | undefined;
    etag: string | undefined;
    updateTime: Date | undefined;
    searchEmails?: string[];
    searchPhones?: string[];
};

export function normalizeGoogleContactSearchText(value: string | null | undefined): string {
    return String(value || "")
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

export function normalizeGoogleContactPhone(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
}

export function getGoogleContactPhoneSuffix(value: string | null | undefined): string {
    const digits = normalizeGoogleContactPhone(value);
    return digits.length >= 7 ? digits.slice(-7) : digits;
}

export function isGoogleContactPhoneQuery(query: string): boolean {
    return /^[+\d\s\-()]+$/.test(query.trim()) && normalizeGoogleContactPhone(query).length >= 6;
}

export function mapGooglePersonToSearchResult(
    person: people_v1.Schema$Person,
    getPrimaryPhone: (person: people_v1.Schema$Person) => string | undefined,
    getUpdateTime: (person: people_v1.Schema$Person) => Date | undefined,
): GoogleContactSearchResult {
    return {
        resourceName: person.resourceName || undefined,
        name: person.names?.[0]?.displayName || undefined,
        email: person.emailAddresses?.[0]?.value || undefined,
        phone: getPrimaryPhone(person),
        photo: person.photos?.[0]?.url || undefined,
        etag: person.etag || undefined,
        updateTime: getUpdateTime(person),
        searchEmails: (person.emailAddresses || [])
            .map(email => email.value || "")
            .filter(Boolean),
        searchPhones: (person.phoneNumbers || [])
            .flatMap(phone => [phone.canonicalForm || "", phone.value || ""])
            .filter(Boolean),
    };
}

export function buildGoogleContactDirectoryEntry(
    userId: string,
    result: GoogleContactSearchResult,
) {
    if (!result.resourceName) return null;

    const phoneDigits = normalizeGoogleContactPhone(result.phone);
    const normalizedName = normalizeGoogleContactSearchText(result.name);
    const normalizedEmail = normalizeGoogleContactSearchText(result.email);
    const searchEmails = (result.searchEmails || [result.email || ""])
        .map(normalizeGoogleContactSearchText)
        .filter(Boolean);
    const searchPhoneDigits = (result.searchPhones || [result.phone || ""])
        .map(normalizeGoogleContactPhone)
        .filter(Boolean);
    const phoneKeys = [...new Set(searchPhoneDigits.flatMap(phone => [
        phone,
        getGoogleContactPhoneSuffix(phone),
    ]).filter(Boolean))];

    return {
        userId,
        resourceName: result.resourceName,
        name: result.name || null,
        email: result.email || null,
        phone: result.phone || null,
        photo: result.photo || null,
        etag: result.etag || null,
        googleUpdatedAt: result.updateTime || null,
        normalizedName,
        normalizedEmail,
        searchText: [...new Set([
            normalizedName,
            ...searchEmails,
            ...searchPhoneDigits,
        ].filter(Boolean))].join(" "),
        phoneDigits,
        phoneSuffix: getGoogleContactPhoneSuffix(phoneDigits),
        phoneKeys,
    };
}

function mapDirectoryEntryToSearchResult(entry: {
    resourceName: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    photo: string | null;
    etag: string | null;
    googleUpdatedAt: Date | null;
}): GoogleContactSearchResult {
    return {
        resourceName: entry.resourceName,
        name: entry.name || undefined,
        email: entry.email || undefined,
        phone: entry.phone || undefined,
        photo: entry.photo || undefined,
        etag: entry.etag || undefined,
        updateTime: entry.googleUpdatedAt || undefined,
    };
}

export async function searchGoogleContactDirectoryIndex(
    userId: string,
    query: string,
    pageSize: number,
): Promise<{ available: boolean; fresh: boolean; results: GoogleContactSearchResult[] }> {
    const state = await db.googleContactDirectoryState.findUnique({
        where: { userId },
        select: { refreshedAt: true },
    });

    if (!state) return { available: false, fresh: false, results: [] };

    const normalizedQuery = normalizeGoogleContactSearchText(query);
    const phoneQuery = isGoogleContactPhoneQuery(query);
    const phoneDigits = normalizeGoogleContactPhone(query);
    const phoneSuffix = getGoogleContactPhoneSuffix(query);

    const entries = await db.googleContactDirectoryEntry.findMany({
        where: {
            userId,
            OR: phoneQuery
                ? [
                    { phoneKeys: { has: phoneDigits } },
                    ...(phoneSuffix ? [{ phoneKeys: { has: phoneSuffix } }] : []),
                ]
                : [
                    { searchText: { contains: normalizedQuery } },
                    ...(phoneDigits ? [{ searchText: { contains: phoneDigits } }] : []),
                ],
        },
        take: pageSize,
        orderBy: [{ normalizedName: "asc" }, { resourceName: "asc" }],
    });

    return {
        available: true,
        fresh: Date.now() - state.refreshedAt.getTime() <= GOOGLE_CONTACT_DIRECTORY_MAX_AGE_MS,
        results: entries.map(mapDirectoryEntryToSearchResult),
    };
}

export async function getGoogleContactDirectoryIndexStatus(
    userId: string,
): Promise<{ available: boolean; fresh: boolean }> {
    const state = await db.googleContactDirectoryState.findUnique({
        where: { userId },
        select: { refreshedAt: true },
    });
    if (!state) return { available: false, fresh: false };
    return {
        available: true,
        fresh: Date.now() - state.refreshedAt.getTime() <= GOOGLE_CONTACT_DIRECTORY_MAX_AGE_MS,
    };
}

export async function replaceGoogleContactDirectoryIndex(
    userId: string,
    results: GoogleContactSearchResult[],
): Promise<void> {
    const entries = results
        .map(result => buildGoogleContactDirectoryEntry(userId, result))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    await db.$transaction(async tx => {
        await tx.googleContactDirectoryEntry.deleteMany({ where: { userId } });
        if (entries.length > 0) {
            await tx.googleContactDirectoryEntry.createMany({ data: entries });
        }
        await tx.googleContactDirectoryState.upsert({
            where: { userId },
            create: { userId, refreshedAt: new Date(), contactCount: entries.length },
            update: { refreshedAt: new Date(), contactCount: entries.length },
        });
    });
}

export async function clearGoogleContactDirectoryIndex(userId: string): Promise<void> {
    await db.$transaction([
        db.googleContactDirectoryEntry.deleteMany({ where: { userId } }),
        db.googleContactDirectoryState.deleteMany({ where: { userId } }),
    ]);
}
