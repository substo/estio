import db from "@/lib/db";

type NullableString = string | null | undefined;

export type LegacyOwnerSelectionMode = "existing" | "add";
export type ImportedOwnerEntityType = "person" | "organization";

export type ImportedOwnerInput = {
    locationId: string;
    ownerName?: NullableString;
    ownerDisplayName?: NullableString;
    ownerCompany?: NullableString;
    ownerEmail?: NullableString;
    ownerPhone?: NullableString;
    ownerMobile?: NullableString;
    ownerFax?: NullableString;
    ownerWebsite?: NullableString;
    ownerAddress?: NullableString;
    ownerBirthday?: NullableString;
    ownerViewingNotification?: NullableString;
    ownerNotes?: NullableString;
    legacyOwnerId?: NullableString;
    legacyOwnerLabel?: NullableString;
    legacyOwnerSelectionMode?: LegacyOwnerSelectionMode | null;
};

export type ImportedOwnerResolution = {
    ownerContactId: string | null;
    ownerCompanyId: string | null;
    ownerEntityType: ImportedOwnerEntityType;
    ownerMatchSource: "legacy_owner_id" | "email" | "phone" | "name_fallback" | "new";
    ownerDisplayName: string | null;
    ownerCompanyName: string | null;
};

function normalizeText(value: NullableString): string | null {
    const normalized = String(value || "").trim();
    return normalized || null;
}

function normalizeEmail(value: NullableString): string | null {
    const normalized = normalizeText(value);
    return normalized ? normalized.toLowerCase() : null;
}

function normalizeComparableName(value: NullableString): string | null {
    const normalized = normalizeText(value);
    return normalized ? normalized.toLowerCase() : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean) as string[]));
}

export function isLikelyAutomatedOwnerName(value: NullableString): boolean {
    const normalized = normalizeComparableName(value);
    if (!normalized) return false;
    if (/(automated|xml|feed|import owner|feed owner|owner rent|owner sale)/i.test(normalized)) return true;
    const digitCount = normalized.replace(/\D/g, "").length;
    return digitCount >= 4;
}

function looksLikeHumanName(value: NullableString): boolean {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    if (isLikelyAutomatedOwnerName(normalized)) return false;
    if (/[0-9]/.test(normalized)) return false;
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 0 || parts.length > 4) return false;
    return parts.every((part) => /^[A-Za-z.'-]+$/.test(part));
}

export function hasMeaningfulCompanyName(companyName: NullableString, ownerName?: NullableString): boolean {
    const normalizedCompany = normalizeText(companyName);
    if (!normalizedCompany) return false;
    const normalizedOwner = normalizeComparableName(ownerName);
    const normalizedCompanyComparable = normalizeComparableName(normalizedCompany);
    if (normalizedCompanyComparable && normalizedCompanyComparable === normalizedOwner) return false;
    return true;
}

export function classifyImportedOwnerEntity(input: {
    ownerName?: NullableString;
    ownerCompany?: NullableString;
    legacyOwnerLabel?: NullableString;
}): ImportedOwnerEntityType {
    const normalizedOwnerName = normalizeText(input.ownerName);
    const normalizedLegacyLabel = normalizeText(input.legacyOwnerLabel);

    if (isLikelyAutomatedOwnerName(normalizedOwnerName) || isLikelyAutomatedOwnerName(normalizedLegacyLabel)) {
        return "organization";
    }

    if (hasMeaningfulCompanyName(input.ownerCompany, input.ownerName)) {
        if (!looksLikeHumanName(normalizedOwnerName)) return "organization";
    }

    return looksLikeHumanName(normalizedOwnerName) ? "person" : "organization";
}

function shouldUseImportedName(existingName: NullableString, importedName: NullableString): boolean {
    const current = normalizeText(existingName);
    const incoming = normalizeText(importedName);
    if (!incoming) return false;
    if (!current) return true;
    if (isLikelyAutomatedOwnerName(incoming) && !isLikelyAutomatedOwnerName(current)) return false;
    if (normalizeComparableName(current) === normalizeComparableName(incoming)) return false;
    return isLikelyAutomatedOwnerName(current) && !isLikelyAutomatedOwnerName(incoming);
}

function buildOwnerMessage(input: ImportedOwnerInput): string | null {
    const lines = [
        "Imported from CRM.",
        `Company: ${normalizeText(input.ownerCompany) || ""}`,
        `Notes: ${normalizeText(input.ownerNotes) || ""}`,
    ];
    const message = lines.join(" \n").trim();
    return message.length > 20 ? message : null;
}

function buildLegacyMatchMetadata(input: ImportedOwnerInput, matchSource: ImportedOwnerResolution["ownerMatchSource"]) {
    return {
        importedAt: new Date().toISOString(),
        ownerId: normalizeText(input.legacyOwnerId),
        ownerLabel: normalizeText(input.legacyOwnerLabel),
        selectionMode: input.legacyOwnerSelectionMode || null,
        matchSource,
    };
}

async function ensureContactCompanyRole(contactId: string, companyId: string) {
    await db.contactCompanyRole.upsert({
        where: {
            contactId_companyId_role: {
                contactId,
                companyId,
                role: "owner",
            },
        },
        update: {},
        create: {
            contactId,
            companyId,
            role: "owner",
        },
    });
}

async function findContactByLegacyOwnerId(locationId: string, legacyOwnerId: string | null) {
    if (!legacyOwnerId) return null;
    return db.contact.findUnique({
        where: {
            locationId_legacyCrmOwnerId: {
                locationId,
                legacyCrmOwnerId: legacyOwnerId,
            },
        },
    });
}

async function findCompanyByLegacyOwnerId(locationId: string, legacyOwnerId: string | null) {
    if (!legacyOwnerId) return null;
    return db.company.findUnique({
        where: {
            locationId_legacyCrmOwnerId: {
                locationId,
                legacyCrmOwnerId: legacyOwnerId,
            },
        },
    });
}

async function findContactByEmail(locationId: string, email: string | null) {
    if (!email) return null;
    return db.contact.findFirst({
        where: {
            locationId,
            email: {
                equals: email,
                mode: "insensitive",
            },
        },
    });
}

async function findCompanyByEmail(locationId: string, email: string | null) {
    if (!email) return null;
    return db.company.findFirst({
        where: {
            locationId,
            email: {
                equals: email,
                mode: "insensitive",
            },
        },
    });
}

async function findContactByPhone(locationId: string, phones: string[]) {
    if (phones.length === 0) return null;
    return db.contact.findFirst({
        where: {
            locationId,
            OR: phones.map((phone) => ({ phone })),
        },
    });
}

async function findCompanyByPhone(locationId: string, phones: string[]) {
    if (phones.length === 0) return null;
    return db.company.findFirst({
        where: {
            locationId,
            OR: phones.map((phone) => ({ phone })),
        },
    });
}

async function findContactByNameFallback(locationId: string, ownerName: string | null) {
    if (!ownerName || isLikelyAutomatedOwnerName(ownerName)) return null;
    return db.contact.findFirst({
        where: {
            locationId,
            name: {
                equals: ownerName,
                mode: "insensitive",
            },
        },
    });
}

async function findContactByPossibleNames(locationId: string, ownerNames: string[]) {
    const uniqueNames = Array.from(new Set(ownerNames.map((value) => normalizeText(value)).filter(Boolean) as string[]))
        .filter((value) => !isLikelyAutomatedOwnerName(value));
    if (uniqueNames.length === 0) return null;
    return db.contact.findFirst({
        where: {
            locationId,
            OR: uniqueNames.map((name) => ({
                name: {
                    equals: name,
                    mode: "insensitive",
                },
            })),
        },
    });
}

async function findCompanyByNameFallback(locationId: string, companyName: string | null) {
    if (!companyName) return null;
    return db.company.findFirst({
        where: {
            locationId,
            name: {
                equals: companyName,
                mode: "insensitive",
            },
        },
    });
}

async function upsertResolvedContact(input: ImportedOwnerInput, entityType: ImportedOwnerEntityType, matchSource: ImportedOwnerResolution["ownerMatchSource"]) {
    const ownerName = normalizeText(input.ownerName);
    const ownerDisplayName = normalizeText(input.ownerDisplayName) || ownerName;
    const ownerEmail = normalizeEmail(input.ownerEmail);
    const ownerPhone = normalizeText(input.ownerMobile) || normalizeText(input.ownerPhone);
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    const legacyOwnerLabel = normalizeText(input.legacyOwnerLabel);
    const message = buildOwnerMessage(input);
    const payloadNotes = normalizeText(input.ownerNotes);

    let existing =
        await findContactByLegacyOwnerId(input.locationId, legacyOwnerId) ||
        await findContactByEmail(input.locationId, ownerEmail) ||
        await findContactByPhone(input.locationId, uniqueStrings([ownerPhone, input.ownerMobile, input.ownerPhone])) ||
        await findContactByPossibleNames(input.locationId, [ownerName, ownerDisplayName]);

    if (existing) {
        const updateData: Record<string, unknown> = {};

        if (!existing.legacyCrmOwnerId && legacyOwnerId) updateData.legacyCrmOwnerId = legacyOwnerId;
        if (!existing.legacyCrmOwnerLabel && legacyOwnerLabel) updateData.legacyCrmOwnerLabel = legacyOwnerLabel;
        if (!existing.email && ownerEmail) updateData.email = ownerEmail;
        if (!existing.phone && ownerPhone) updateData.phone = ownerPhone;
        if (!existing.message && message) updateData.message = message;
        if (!existing.notes && payloadNotes) updateData.notes = payloadNotes;
        if (entityType === "person" && shouldUseImportedName(existing.name, ownerDisplayName)) {
            updateData.name = ownerDisplayName;
        }
        if (!existing.contactType || existing.contactType === "Lead") {
            updateData.contactType = "Owner";
        }

        const nextPayload = { ...((existing.payload as Record<string, unknown> | null) || {}) };
        nextPayload.legacyCrm = buildLegacyMatchMetadata(input, matchSource);
        nextPayload.company = normalizeText(input.ownerCompany) || nextPayload.company;
        nextPayload.fax = normalizeText(input.ownerFax) || nextPayload.fax;
        nextPayload.birthday = normalizeText(input.ownerBirthday) || nextPayload.birthday;
        nextPayload.website = normalizeText(input.ownerWebsite) || nextPayload.website;
        nextPayload.address = normalizeText(input.ownerAddress) || nextPayload.address;
        nextPayload.viewingNotification = normalizeText(input.ownerViewingNotification) || nextPayload.viewingNotification;
        nextPayload.notes = payloadNotes || nextPayload.notes;
        updateData.payload = nextPayload;

        existing = await db.contact.update({
            where: { id: existing.id },
            data: updateData,
        });
        return existing;
    }

    return db.contact.create({
        data: {
            locationId: input.locationId,
            name: ownerDisplayName,
            email: ownerEmail,
            phone: ownerPhone,
            message,
            notes: payloadNotes,
            status: "Lead",
            contactType: "Owner",
            legacyCrmOwnerId: legacyOwnerId,
            legacyCrmOwnerLabel: legacyOwnerLabel,
            payload: {
                legacyCrm: buildLegacyMatchMetadata(input, matchSource),
                company: normalizeText(input.ownerCompany),
                fax: normalizeText(input.ownerFax),
                birthday: normalizeText(input.ownerBirthday),
                website: normalizeText(input.ownerWebsite),
                address: normalizeText(input.ownerAddress),
                viewingNotification: normalizeText(input.ownerViewingNotification),
                notes: payloadNotes,
            },
        },
    });
}

async function upsertResolvedCompany(input: ImportedOwnerInput, companyName: string, matchSource: ImportedOwnerResolution["ownerMatchSource"]) {
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    const legacyOwnerLabel = normalizeText(input.legacyOwnerLabel);
    const ownerEmail = normalizeEmail(input.ownerEmail);
    const phones = uniqueStrings([input.ownerMobile, input.ownerPhone]);

    let existing =
        await findCompanyByLegacyOwnerId(input.locationId, legacyOwnerId) ||
        await findCompanyByEmail(input.locationId, ownerEmail) ||
        await findCompanyByPhone(input.locationId, phones) ||
        await findCompanyByNameFallback(input.locationId, companyName);

    if (existing) {
        const updateData: Record<string, unknown> = {};
        if (!existing.legacyCrmOwnerId && legacyOwnerId) updateData.legacyCrmOwnerId = legacyOwnerId;
        if (!existing.legacyCrmOwnerLabel && legacyOwnerLabel) updateData.legacyCrmOwnerLabel = legacyOwnerLabel;
        if (!existing.email && ownerEmail) updateData.email = ownerEmail;
        if (!existing.phone && phones[0]) updateData.phone = phones[0];
        if (!existing.website && normalizeText(input.ownerWebsite)) updateData.website = normalizeText(input.ownerWebsite);
        if (!existing.type) updateData.type = "owner";

        existing = await db.company.update({
            where: { id: existing.id },
            data: updateData,
        });
        return existing;
    }

    return db.company.create({
        data: {
            locationId: input.locationId,
            name: companyName,
            email: ownerEmail,
            phone: phones[0] || null,
            website: normalizeText(input.ownerWebsite),
            type: "owner",
            legacyCrmOwnerId: legacyOwnerId,
            legacyCrmOwnerLabel: legacyOwnerLabel,
        },
    });
}

export async function resolveImportedOwner(input: ImportedOwnerInput): Promise<ImportedOwnerResolution> {
    const ownerName = normalizeText(input.ownerName);
    const ownerDisplayName = normalizeText(input.ownerDisplayName) || ownerName;
    const companyName = hasMeaningfulCompanyName(input.ownerCompany, input.ownerName)
        ? normalizeText(input.ownerCompany)
        : null;
    const entityType = classifyImportedOwnerEntity(input);
    const normalizedEmail = normalizeEmail(input.ownerEmail);
    const normalizedPhone = normalizeText(input.ownerMobile) || normalizeText(input.ownerPhone);
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    const contactSignals = uniqueStrings([normalizedPhone, input.ownerMobile, input.ownerPhone]);

    let matchSource: ImportedOwnerResolution["ownerMatchSource"] = "new";
    if (legacyOwnerId) matchSource = "legacy_owner_id";
    else if (normalizedEmail) matchSource = "email";
    else if (contactSignals.length > 0) matchSource = "phone";
    else if ((entityType === "person" && ownerName) || (entityType === "organization" && companyName)) matchSource = "name_fallback";

    let ownerContactId: string | null = null;
    let ownerCompanyId: string | null = null;

    if (entityType === "person") {
        const contact = await upsertResolvedContact(input, entityType, matchSource);
        ownerContactId = contact.id;

        if (companyName) {
            const company = await upsertResolvedCompany(input, companyName, matchSource);
            ownerCompanyId = company.id;
            await ensureContactCompanyRole(contact.id, company.id);
        }
    } else {
        const canonicalCompanyName = companyName || ownerName || normalizeText(input.legacyOwnerLabel) || "Imported Owner";
        const company = await upsertResolvedCompany(input, canonicalCompanyName, matchSource);
        ownerCompanyId = company.id;

        if (normalizedEmail || normalizedPhone || looksLikeHumanName(ownerName)) {
            const contact = await upsertResolvedContact(
                {
                    ...input,
                    ownerName: looksLikeHumanName(ownerName) ? ownerName : (normalizeText(input.legacyOwnerLabel) || canonicalCompanyName),
                },
                "organization",
                matchSource
            );
            ownerContactId = contact.id;
            await ensureContactCompanyRole(contact.id, company.id);
        }
    }

    return {
        ownerContactId,
        ownerCompanyId,
        ownerEntityType: entityType,
        ownerMatchSource: matchSource,
        ownerDisplayName,
        ownerCompanyName: companyName,
    };
}
