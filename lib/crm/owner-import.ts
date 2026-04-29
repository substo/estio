import db from "@/lib/db";
import {
    type ProspectSellerType,
    sellerTypeToCompanyType,
} from "@/lib/leads/seller-type";
import {
    normalizeCompanyNameForMatch,
    normalizeWebsiteHost,
} from "@/lib/leads/agency-company-linker";

type NullableString = string | null | undefined;

export type LegacyOwnerSelectionMode = "existing" | "add";
export type ImportedOwnerEntityType = "person" | "organization";
export type ImportedOwnerEntityPath = "private_person" | "company_backed";
export type ImportedOwnerBusinessSubtype = Exclude<ProspectSellerType, "private">;
export type ImportedOwnerMatchSource =
    | "legacy_owner_id"
    | "name"
    | "name_email"
    | "name_phone"
    | "website"
    | "email"
    | "phone"
    | "name_fallback"
    | "new";

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
    ownerEntityPath: ImportedOwnerEntityPath;
    ownerBusinessSubtype: ImportedOwnerBusinessSubtype | null;
    ownerMatchSource: ImportedOwnerMatchSource;
    ownerDisplayName: string | null;
    ownerCompanyName: string | null;
};

type CompanyLike = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    type: string | null;
    payload?: unknown;
    legacyCrmOwnerId: string | null;
    legacyCrmOwnerLabel: string | null;
};

type CompanyMatchCandidate = {
    company: CompanyLike;
    matchSource: ImportedOwnerMatchSource;
    confidence: number;
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

function normalizeDigits(value: NullableString): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    const digits = normalized.replace(/\D/g, "");
    return digits.length >= 6 ? digits : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean) as string[]));
}

function normalizePhoneCandidates(values: Array<string | null | undefined>): string[] {
    const exact = uniqueStrings(values);
    const digitVariants = Array.from(new Set(values.map((value) => normalizeDigits(value)).filter(Boolean) as string[]));
    return Array.from(new Set([...exact, ...digitVariants]));
}

export function isLikelyAutomatedOwnerName(value: NullableString): boolean {
    const normalized = normalizeComparableName(value);
    if (!normalized) return false;
    if (/(automated|xml|feed|import owner|feed owner|owner rent|owner sale)/i.test(normalized)) return true;
    if (/\bdt\d{2,6}\b/i.test(normalized)) return true;
    if (/\b\d+\s*bdr\b/i.test(normalized) || /\b0bdr\b/i.test(normalized)) return true;
    return false;
}

function stripOwnerContactDecorators(value: NullableString): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    return normalized
        .replace(/\b[mt]:\s*\+?[0-9()\s-]{6,}\b/gi, "")
        .replace(/\b(?:mobile|mob|tel|phone):\s*\+?[0-9()\s-]{6,}\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
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

function looksStronglyHumanName(value: NullableString): boolean {
    const normalized = normalizeText(value);
    if (!normalized || !looksLikeHumanName(normalized)) return false;
    const parts = normalized.split(/\s+/).filter(Boolean);
    return parts.length >= 2;
}

function isLikelyBusinessName(value: NullableString): boolean {
    const normalized = normalizeComparableName(value);
    if (!normalized) return false;
    return /\b(real estate|properties|property|homes|developers?|development|management|agency|estates|holdings|group|ltd|limited|construction)\b/i.test(normalized);
}

function isLikelyGenericBusinessEmail(value: NullableString): boolean {
    const normalized = normalizeEmail(value);
    if (!normalized) return false;
    const localPart = normalized.split("@")[0] || "";
    return /^(info|hello|sales|office|admin|contact|reservations|support|lettings|rentals)$/i.test(localPart);
}

function isStructuredOwnerDisplayName(value: NullableString): boolean {
    const normalized = normalizeComparableName(value);
    if (!normalized) return false;
    return /\bowner\b/.test(normalized) && /\bdt\d{2,6}\b/.test(normalized);
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

function shouldHealOrganizationContactName(existingName: NullableString, desiredName: string | null, realHumanName: boolean): boolean {
    const current = normalizeText(existingName);
    if (!desiredName) return false;
    if (!current) return true;
    if (normalizeComparableName(current) === normalizeComparableName(desiredName)) return false;
    if (realHumanName) {
        return isStructuredOwnerDisplayName(current) || isLikelyAutomatedOwnerName(current) || !looksStronglyHumanName(current);
    }
    return isStructuredOwnerDisplayName(current) || isLikelyAutomatedOwnerName(current) || looksLikeHumanName(current);
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
    const normalizedLegacyLabel = stripOwnerContactDecorators(input.legacyOwnerLabel);

    if (isLikelyAutomatedOwnerName(normalizedOwnerName) || isLikelyAutomatedOwnerName(normalizedLegacyLabel)) {
        return "organization";
    }

    if (hasMeaningfulCompanyName(input.ownerCompany, input.ownerName)) {
        if (looksStronglyHumanName(normalizedOwnerName) && !isLikelyBusinessName(input.ownerName)) {
            return "person";
        }
        if (isLikelyBusinessName(input.ownerCompany) || isLikelyBusinessName(input.ownerName)) return "organization";
        if (!looksStronglyHumanName(normalizedOwnerName)) return "organization";
    }

    return looksLikeHumanName(normalizedOwnerName) ? "person" : "organization";
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

function buildLegacyMatchMetadata(input: ImportedOwnerInput, matchSource: ImportedOwnerMatchSource) {
    return {
        importedAt: new Date().toISOString(),
        ownerId: normalizeText(input.legacyOwnerId),
        ownerLabel: normalizeText(input.legacyOwnerLabel),
        selectionMode: input.legacyOwnerSelectionMode || null,
        matchSource,
    };
}

function normalizeExistingCompanySubtype(value: NullableString): ImportedOwnerBusinessSubtype | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    const lowered = normalized.toLowerCase();
    if (lowered === "agency" || lowered === "management" || lowered === "developer" || lowered === "other") {
        return lowered as ImportedOwnerBusinessSubtype;
    }
    if (lowered === "owner") return null;
    if (lowered === "real estate" || lowered === "realty") return "agency";
    return null;
}

export function inferOwnerBusinessSubtype(input: ImportedOwnerInput, existingCompany?: CompanyLike | null): ImportedOwnerBusinessSubtype {
    const existingSubtype = normalizeExistingCompanySubtype(existingCompany?.type || null);
    if (existingSubtype) return existingSubtype;

    const haystack = [
        normalizeText(input.ownerCompany),
        normalizeText(input.ownerName),
        normalizeText(input.legacyOwnerLabel),
        normalizeText(input.ownerNotes),
        normalizeText(input.ownerWebsite),
        normalizeText(input.ownerEmail),
    ].filter(Boolean).join(" ").toLowerCase();

    if (/\bmanage|management|property management|holiday rentals|short lets\b/.test(haystack)) return "management";
    if (/\bdeveloper|developers|development|construction|new build|new builds|homes\b/.test(haystack)) return "developer";
    if (/\bagency|real estate|properties|realty|estate agent|estate agents|brokers?\b/.test(haystack)) return "agency";
    return "other";
}

function buildCompanyMatchConfidence(matchSource: ImportedOwnerMatchSource): number {
    switch (matchSource) {
        case "legacy_owner_id":
            return 1;
        case "name_email":
        case "name_phone":
        case "website":
            return 0.97;
        case "name":
            return 0.94;
        case "email":
        case "phone":
            return 0.7;
        default:
            return 0.5;
    }
}

function sameNormalizedCompanyName(left: NullableString, right: NullableString): boolean {
    const normalizedLeft = normalizeCompanyNameForMatch(left);
    const normalizedRight = normalizeCompanyNameForMatch(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function companySignalsConflict(existing: CompanyLike, canonicalCompanyName: string, ownerEmail: string | null, phoneCandidates: string[], websiteHost: string | null): boolean {
    if (!canonicalCompanyName) return false;
    if (sameNormalizedCompanyName(existing.name, canonicalCompanyName)) return false;
    if (websiteHost && normalizeWebsiteHost(existing.website) === websiteHost) return false;
    if (ownerEmail && normalizeEmail(existing.email) === ownerEmail) return true;
    if (phoneCandidates.length > 0) {
        const existingPhone = normalizeText(existing.phone);
        const existingDigits = normalizeDigits(existing.phone);
        if ((existingPhone && phoneCandidates.includes(existingPhone)) || (existingDigits && phoneCandidates.includes(existingDigits))) {
            return true;
        }
    }
    return false;
}

export function chooseCompanyBackedContactName(input: {
    ownerName?: NullableString;
    canonicalCompanyName: string;
}): { contactName: string; genericCompanyContact: boolean } {
    const ownerName = normalizeText(input.ownerName);
    if (looksStronglyHumanName(ownerName) && !sameNormalizedCompanyName(ownerName, input.canonicalCompanyName)) {
        return {
            contactName: ownerName,
            genericCompanyContact: false,
        };
    }

    return {
        contactName: input.canonicalCompanyName,
        genericCompanyContact: true,
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

async function findContactByPhone(locationId: string, phones: string[]) {
    if (phones.length === 0) return null;
    return db.contact.findFirst({
        where: {
            locationId,
            OR: phones.map((phone) => ({ phone })),
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

async function findCompanyByExactName(locationId: string, companyName: string | null) {
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

async function findCompanyByNormalizedName(locationId: string, companyName: string | null) {
    if (!companyName) return null;
    const normalizedTarget = normalizeCompanyNameForMatch(companyName);
    if (!normalizedTarget) return null;
    const companies = await db.company.findMany({
        where: {
            locationId,
            name: { not: null },
        },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            website: true,
            type: true,
            payload: true,
            legacyCrmOwnerId: true,
            legacyCrmOwnerLabel: true,
        },
    });
    return companies.find((company) => normalizeCompanyNameForMatch(company.name) === normalizedTarget) || null;
}

async function findCompanyByWebsiteHost(locationId: string, websiteHost: string | null) {
    if (!websiteHost) return null;
    const companies = await db.company.findMany({
        where: {
            locationId,
            website: { not: null },
        },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            website: true,
            type: true,
            payload: true,
            legacyCrmOwnerId: true,
            legacyCrmOwnerLabel: true,
        },
    });
    return companies.find((company) => normalizeWebsiteHost(company.website) === websiteHost) || null;
}

async function findCompaniesByEmail(locationId: string, email: string | null) {
    if (!email) return null;
    return db.company.findMany({
        where: {
            locationId,
            email: {
                equals: email,
                mode: "insensitive",
            },
        },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            website: true,
            type: true,
            payload: true,
            legacyCrmOwnerId: true,
            legacyCrmOwnerLabel: true,
        },
    });
}

async function findCompaniesByPhone(locationId: string, phones: string[]) {
    if (phones.length === 0) return null;
    return db.company.findMany({
        where: {
            locationId,
            OR: phones.map((phone) => ({ phone })),
        },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            website: true,
            type: true,
            payload: true,
            legacyCrmOwnerId: true,
            legacyCrmOwnerLabel: true,
        },
    });
}

async function isContactFieldAvailable(
    locationId: string,
    field: "phone" | "email" | "legacyCrmOwnerId",
    value: string | null | undefined,
    excludeContactId?: string,
): Promise<boolean> {
    if (!value) return true;
    const where: Record<string, unknown> = { locationId, [field]: value };
    if (excludeContactId) where.id = { not: excludeContactId };
    const clash = await db.contact.findFirst({ where, select: { id: true } });
    return !clash;
}

async function isCompanyLegacyOwnerIdAvailable(
    locationId: string,
    legacyOwnerId: string | null | undefined,
    excludeCompanyId?: string,
): Promise<boolean> {
    if (!legacyOwnerId) return true;
    const where: Record<string, unknown> = { locationId, legacyCrmOwnerId: legacyOwnerId };
    if (excludeCompanyId) where.id = { not: excludeCompanyId };
    const clash = await db.company.findFirst({ where, select: { id: true } });
    return !clash;
}

function buildCompanyImportPayload(input: ImportedOwnerInput, subtype: ImportedOwnerBusinessSubtype, matchSource: ImportedOwnerMatchSource, canonicalCompanyName: string, genericContact: boolean) {
    return {
        legacyCrm: buildLegacyMatchMetadata(input, matchSource),
        subtype,
        canonicalCompanyName,
        genericContact,
        confidence: buildCompanyMatchConfidence(matchSource),
    };
}

async function findBestCompanyMatch(
    input: ImportedOwnerInput,
    canonicalCompanyName: string,
): Promise<CompanyMatchCandidate | null> {
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    if (legacyOwnerId) {
        const byLegacy = await findCompanyByLegacyOwnerId(input.locationId, legacyOwnerId);
        if (byLegacy) {
            return {
                company: byLegacy,
                matchSource: "legacy_owner_id",
                confidence: buildCompanyMatchConfidence("legacy_owner_id"),
            };
        }
    }

    const ownerEmail = normalizeEmail(input.ownerEmail);
    const phones = normalizePhoneCandidates([input.ownerMobile, input.ownerPhone]);
    const websiteHost = normalizeWebsiteHost(input.ownerWebsite);
    const normalizedCanonicalName = normalizeCompanyNameForMatch(canonicalCompanyName);

    const nameMatch =
        await findCompanyByExactName(input.locationId, canonicalCompanyName) ||
        await findCompanyByNormalizedName(input.locationId, canonicalCompanyName);
    if (nameMatch) {
        let matchSource: ImportedOwnerMatchSource = "name";
        if (ownerEmail && nameMatch.email && normalizeEmail(nameMatch.email) === ownerEmail) {
            matchSource = "name_email";
        } else {
            const nameMatchPhone = normalizeText(nameMatch.phone);
            const nameMatchPhoneDigits = normalizeDigits(nameMatch.phone);
            if ((nameMatchPhone && phones.includes(nameMatchPhone)) || (nameMatchPhoneDigits && phones.includes(nameMatchPhoneDigits))) {
                matchSource = "name_phone";
            } else if (websiteHost && normalizeWebsiteHost(nameMatch.website) === websiteHost) {
                matchSource = "website";
            }
        }
        return {
            company: nameMatch,
            matchSource,
            confidence: buildCompanyMatchConfidence(matchSource),
        };
    }

    const websiteMatch = await findCompanyByWebsiteHost(input.locationId, websiteHost);
    if (websiteMatch && (!normalizedCanonicalName || normalizeCompanyNameForMatch(websiteMatch.name) === normalizedCanonicalName)) {
        return {
            company: websiteMatch,
            matchSource: "website",
            confidence: buildCompanyMatchConfidence("website"),
        };
    }

    const emailMatches = await findCompaniesByEmail(input.locationId, ownerEmail);
    if (emailMatches?.length) {
        const exactNameEmailMatch = emailMatches.find((company) => sameNormalizedCompanyName(company.name, canonicalCompanyName));
        if (exactNameEmailMatch) {
            return {
                company: exactNameEmailMatch,
                matchSource: "name_email",
                confidence: buildCompanyMatchConfidence("name_email"),
            };
        }
        if (!canonicalCompanyName || isLikelyGenericBusinessEmail(ownerEmail)) {
            const safeEmailMatch = emailMatches.find((company) => !companySignalsConflict(company, canonicalCompanyName, ownerEmail, phones, websiteHost));
            if (safeEmailMatch) {
                return {
                    company: safeEmailMatch,
                    matchSource: "email",
                    confidence: buildCompanyMatchConfidence("email"),
                };
            }
        }
    }

    const phoneMatches = await findCompaniesByPhone(input.locationId, phones);
    if (phoneMatches?.length) {
        const exactNamePhoneMatch = phoneMatches.find((company) => sameNormalizedCompanyName(company.name, canonicalCompanyName));
        if (exactNamePhoneMatch) {
            return {
                company: exactNamePhoneMatch,
                matchSource: "name_phone",
                confidence: buildCompanyMatchConfidence("name_phone"),
            };
        }
        if (!canonicalCompanyName) {
            const safePhoneMatch = phoneMatches.find((company) => !companySignalsConflict(company, canonicalCompanyName, ownerEmail, phones, websiteHost));
            if (safePhoneMatch) {
                return {
                    company: safePhoneMatch,
                    matchSource: "phone",
                    confidence: buildCompanyMatchConfidence("phone"),
                };
            }
        }
    }

    return null;
}

async function upsertResolvedContact(args: {
    input: ImportedOwnerInput;
    entityPath: ImportedOwnerEntityPath;
    matchSource: ImportedOwnerMatchSource;
    desiredContactName: string | null;
    genericCompanyContact: boolean;
}) {
    const { input, entityPath, matchSource, desiredContactName, genericCompanyContact } = args;
    const ownerName = normalizeText(input.ownerName);
    const ownerEmail = normalizeEmail(input.ownerEmail);
    const ownerPhone = normalizeText(input.ownerMobile) || normalizeText(input.ownerPhone);
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    const legacyOwnerLabel = normalizeText(input.legacyOwnerLabel);
    const message = buildOwnerMessage(input);
    const payloadNotes = normalizeText(input.ownerNotes);
    const contactDisplayName = normalizeText(desiredContactName) || ownerName;
    const realHumanName = looksStronglyHumanName(ownerName);

    let existing =
        await findContactByLegacyOwnerId(input.locationId, legacyOwnerId) ||
        await findContactByEmail(input.locationId, ownerEmail) ||
        await findContactByPhone(input.locationId, normalizePhoneCandidates([ownerPhone, input.ownerMobile, input.ownerPhone])) ||
        await findContactByPossibleNames(input.locationId, uniqueStrings([ownerName, contactDisplayName]));

    if (existing) {
        const updateData: Record<string, unknown> = {};

        if (!existing.legacyCrmOwnerId && legacyOwnerId) {
            if (await isContactFieldAvailable(input.locationId, "legacyCrmOwnerId", legacyOwnerId, existing.id)) {
                updateData.legacyCrmOwnerId = legacyOwnerId;
            } else {
                console.warn(`[OWNER IMPORT] Skipping legacyCrmOwnerId=${legacyOwnerId} for contact ${existing.id} – already claimed by another contact`);
            }
        }
        if (!existing.legacyCrmOwnerLabel && legacyOwnerLabel) updateData.legacyCrmOwnerLabel = legacyOwnerLabel;
        if (!existing.email && ownerEmail) {
            if (await isContactFieldAvailable(input.locationId, "email", ownerEmail, existing.id)) {
                updateData.email = ownerEmail;
            }
        }
        if (!existing.phone && ownerPhone) {
            if (await isContactFieldAvailable(input.locationId, "phone", ownerPhone, existing.id)) {
                updateData.phone = ownerPhone;
            }
        }
        if (!existing.message && message) updateData.message = message;
        if (!existing.notes && payloadNotes) updateData.notes = payloadNotes;

        if (entityPath === "private_person" && shouldUseImportedName(existing.name, contactDisplayName)) {
            updateData.name = contactDisplayName;
        }
        if (entityPath === "company_backed" && shouldHealOrganizationContactName(existing.name, contactDisplayName, realHumanName)) {
            updateData.name = contactDisplayName;
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
        nextPayload.ownerImport = {
            entityPath,
            genericCompanyContact,
            realHumanName,
        };
        updateData.payload = nextPayload;

        return db.contact.update({
            where: { id: existing.id },
            data: updateData,
        });
    }

    const [phoneOk, emailOk, legacyIdOk] = await Promise.all([
        isContactFieldAvailable(input.locationId, "phone", ownerPhone),
        isContactFieldAvailable(input.locationId, "email", ownerEmail),
        isContactFieldAvailable(input.locationId, "legacyCrmOwnerId", legacyOwnerId),
    ]);

    return db.contact.create({
        data: {
            locationId: input.locationId,
            name: contactDisplayName,
            email: emailOk ? ownerEmail : null,
            phone: phoneOk ? ownerPhone : null,
            message,
            notes: payloadNotes,
            status: "Lead",
            contactType: "Owner",
            legacyCrmOwnerId: legacyIdOk ? legacyOwnerId : null,
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
                ownerImport: {
                    entityPath,
                    genericCompanyContact,
                    realHumanName,
                },
            },
        },
    });
}

async function upsertResolvedCompany(args: {
    input: ImportedOwnerInput;
    canonicalCompanyName: string;
    businessSubtype: ImportedOwnerBusinessSubtype;
}) {
    const { input, canonicalCompanyName, businessSubtype } = args;
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    const legacyOwnerLabel = normalizeText(input.legacyOwnerLabel);
    const ownerEmail = normalizeEmail(input.ownerEmail);
    const phones = uniqueStrings([input.ownerMobile, input.ownerPhone]);

    const match = await findBestCompanyMatch(input, canonicalCompanyName);
    let existing = match?.company || null;
    const companyType = sellerTypeToCompanyType(businessSubtype) || "Other";
    const companyPayload = buildCompanyImportPayload(input, businessSubtype, match?.matchSource || "new", canonicalCompanyName, false);

    if (existing) {
        const updateData: Record<string, unknown> = {};
        if (!existing.legacyCrmOwnerId && legacyOwnerId) {
            if (await isCompanyLegacyOwnerIdAvailable(input.locationId, legacyOwnerId, existing.id)) {
                updateData.legacyCrmOwnerId = legacyOwnerId;
            }
        }
        if (!existing.legacyCrmOwnerLabel && legacyOwnerLabel) updateData.legacyCrmOwnerLabel = legacyOwnerLabel;
        if (!existing.email && ownerEmail) updateData.email = ownerEmail;
        if (!existing.phone && phones[0]) updateData.phone = phones[0];
        if (!existing.website && normalizeText(input.ownerWebsite)) updateData.website = normalizeText(input.ownerWebsite);
        if (!normalizeExistingCompanySubtype(existing.type)) {
            updateData.type = companyType;
        }
        updateData.payload = {
            ...((existing.payload as Record<string, unknown> | null) || {}),
            ownerImport: companyPayload,
        };

        existing = await db.company.update({
            where: { id: existing.id },
            data: updateData,
        });
        return { company: existing, matchSource: match?.matchSource || "new" };
    }

    const legacyIdOk = await isCompanyLegacyOwnerIdAvailable(input.locationId, legacyOwnerId);
    const created = await db.company.create({
        data: {
            locationId: input.locationId,
            name: canonicalCompanyName,
            email: ownerEmail,
            phone: phones[0] || null,
            website: normalizeText(input.ownerWebsite),
            type: companyType,
            payload: {
                ownerImport: companyPayload,
            },
            legacyCrmOwnerId: legacyIdOk ? legacyOwnerId : null,
            legacyCrmOwnerLabel: legacyOwnerLabel,
        },
    });

    return { company: created, matchSource: "new" as ImportedOwnerMatchSource };
}

export async function resolveImportedOwner(input: ImportedOwnerInput): Promise<ImportedOwnerResolution> {
    const ownerName = normalizeText(input.ownerName);
    const companyName = hasMeaningfulCompanyName(input.ownerCompany, input.ownerName)
        ? normalizeText(input.ownerCompany)
        : null;
    const entityType = classifyImportedOwnerEntity(input);
    const entityPath: ImportedOwnerEntityPath = entityType === "person" ? "private_person" : "company_backed";
    const normalizedEmail = normalizeEmail(input.ownerEmail);
    const normalizedPhone = normalizeText(input.ownerMobile) || normalizeText(input.ownerPhone);
    const legacyOwnerId = normalizeText(input.legacyOwnerId);
    const contactSignals = uniqueStrings([normalizedPhone, input.ownerMobile, input.ownerPhone]);

    let initialMatchSource: ImportedOwnerMatchSource = "new";
    if (legacyOwnerId) initialMatchSource = "legacy_owner_id";
    else if (normalizedEmail) initialMatchSource = "email";
    else if (contactSignals.length > 0) initialMatchSource = "phone";
    else if ((entityPath === "private_person" && ownerName) || (entityPath === "company_backed" && companyName)) initialMatchSource = "name_fallback";

    let ownerContactId: string | null = null;
    let ownerCompanyId: string | null = null;
    let ownerMatchSource = initialMatchSource;
    let ownerDisplayName = normalizeText(input.ownerDisplayName) || ownerName;
    let ownerBusinessSubtype: ImportedOwnerBusinessSubtype | null = null;

    if (entityPath === "private_person") {
        const contact = await upsertResolvedContact({
            input,
            entityPath,
            matchSource: ownerMatchSource,
            desiredContactName: ownerDisplayName,
            genericCompanyContact: false,
        });
        ownerContactId = contact.id;

        if (companyName) {
            const businessSubtype = inferOwnerBusinessSubtype(input, null);
            const { company, matchSource } = await upsertResolvedCompany({
                input,
                canonicalCompanyName: companyName,
                businessSubtype,
            });
            ownerCompanyId = company.id;
            ownerBusinessSubtype = businessSubtype;
            if (ownerMatchSource === "new") ownerMatchSource = matchSource;
            await ensureContactCompanyRole(contact.id, company.id);
        }
    } else {
        const canonicalCompanyName = companyName || ownerName || normalizeText(input.legacyOwnerLabel) || "Imported Owner";
        const existingCompanyMatch = await findBestCompanyMatch(input, canonicalCompanyName);
        const businessSubtype = inferOwnerBusinessSubtype(input, existingCompanyMatch?.company || null);
        ownerBusinessSubtype = businessSubtype;

        const { company, matchSource } = await upsertResolvedCompany({
            input,
            canonicalCompanyName,
            businessSubtype,
        });
        ownerCompanyId = company.id;
        ownerMatchSource = matchSource;

        if (normalizedEmail || normalizedPhone || looksStronglyHumanName(ownerName)) {
            const { contactName: desiredContactName, genericCompanyContact } = chooseCompanyBackedContactName({
                ownerName,
                canonicalCompanyName,
            });
            const contact = await upsertResolvedContact({
                input: {
                    ...input,
                    ownerName: desiredContactName,
                    ownerDisplayName: desiredContactName,
                    ownerCompany: canonicalCompanyName,
                },
                entityPath,
                matchSource: ownerMatchSource,
                desiredContactName,
                genericCompanyContact,
            });
            ownerContactId = contact.id;
            ownerDisplayName = desiredContactName;

            await db.contact.update({
                where: { id: contact.id },
                data: {
                    payload: {
                        ...((contact.payload as Record<string, unknown> | null) || {}),
                        ownerImport: {
                            entityPath,
                            genericCompanyContact,
                            realHumanName: looksStronglyHumanName(ownerName),
                            businessSubtype,
                        },
                    },
                },
            });

            await ensureContactCompanyRole(contact.id, company.id);
        } else {
            ownerDisplayName = canonicalCompanyName;
        }

        await db.company.update({
            where: { id: company.id },
            data: {
                payload: {
                    ...((company.payload as Record<string, unknown> | null) || {}),
                    ownerImport: buildCompanyImportPayload(input, businessSubtype, ownerMatchSource, canonicalCompanyName, ownerContactId !== null && !looksStronglyHumanName(ownerName)),
                },
            },
        });
    }

    return {
        ownerContactId,
        ownerCompanyId,
        ownerEntityType: entityType,
        ownerEntityPath: entityPath,
        ownerBusinessSubtype,
        ownerMatchSource,
        ownerDisplayName,
        ownerCompanyName: companyName,
    };
}
