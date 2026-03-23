import { callLLMWithMetadata } from './llm';
import { getModelForTask } from './model-router';
import db from '@/lib/db';
import {
    type ProspectSellerType,
    normalizeProspectSellerType,
    resolveEffectiveSellerType,
    sellerTypeToLegacyAgencyFlag,
} from '@/lib/leads/seller-type';

export interface ClassificationSampleListing {
    title?: string | null;
    price?: number | null;
    currency?: string | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    petsAllowed?: string | null;
    propertyArea?: number | null;
    location?: string | null;
    url?: string | null;
}

export interface ClassificationInput {
    name?: string | null;
    description?: string | null;
    listingCount?: number | null;
    platformRegistered?: string | null;
    profileUrl?: string | null;
    contactChannels?: string[];
    sampleListingTitles?: string[];
    sampleListings?: ClassificationSampleListing[];
    businessName?: string | null;
    businessVerified?: boolean | null;
    businessAddress?: string | null;
    businessWebsite?: string | null;
    businessDescription?: string | null;
}

export interface ClassificationResult {
    sellerType: ProspectSellerType;
    isAgency: boolean;
    confidenceScore: number;
    reasoning: string;
}

export interface ProspectClassificationDecision {
    shouldClassify: boolean;
    reason: string;
}

const CLASSIFICATION_PROMPT = `You are an expert real estate industry classifier for a CRM application in Cyprus.

Your task is to determine whether a property seller/landlord on a classifieds platform is:
- A **Private Individual** seller or landlord ("private")
- A **Real Estate Agency** ("agency")
- A **Property Management Company** ("management")
- A **Property Developer / Development Company** ("developer")
- A **Non-private real-estate business that does not cleanly fit agency/management/developer** ("other")

## Signals to Evaluate

**Strong Agency Indicators** (each significantly increases confidence):
- Name contains corporate identifiers: "Properties", "Real Estate", "Estates", "Developers", "Group", "Ltd", "LLC", "Realty", "Management", "Consultants"
- Name contains Greek corporate identifiers: "ΜΕΣΙΤΙΚΟ", "ΚΤΗΜΑΤΙΚΑ", "ΛΤΔ"
- Platform registration says "Company" (vs personal)
- Has a profile URL (agencies tend to have dedicated pages)
- Has business profile block data (website and office address)
- Marked as "Verified account" in seller business profile
- Has 8+ active listings on the platform (very strong)
- Has 5-7 active listings plus other agency indicators
- Description uses corporate language: "our team", "we offer", "our portfolio", "years of experience"

**Strong Private Indicators** (each significantly increases confidence):
- Name is a simple personal name (first + last, no corporate suffix)
- 1-2 listings only
- Listing descriptions are informal/personal language
- Registration text says "Private" or just a date without "Company"

**Ambiguous Cases** (moderate confidence):
- 3-4 listings could be either a small agency or an active private seller
- Generic names without clear corporate identifiers

## Output Format
Return a JSON object:
{
  "sellerType": "private" | "agency" | "management" | "developer" | "other",
  "confidenceScore": 0-100,
  "reasoning": "Brief 1-2 sentence explanation"
}

Rules:
- confidenceScore >= 70 means you are fairly certain
- confidenceScore 40-69 means ambiguous, lean one way
- confidenceScore < 40 means very uncertain
- If almost no data is provided, return confidenceScore: 30 with sellerType: "private"`;

const parsePetsAllowed = (rawAttributes: unknown): string | null => {
    if (!rawAttributes || typeof rawAttributes !== 'object') return null;
    const entries = Object.entries(rawAttributes as Record<string, unknown>);
    const petEntry = entries.find(([key]) => /pet/i.test(key));
    if (!petEntry) return null;
    const value = petEntry[1];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
};

const readBusinessAttribute = (rawAttributes: unknown, keyPattern: RegExp): string | null => {
    if (!rawAttributes || typeof rawAttributes !== 'object') return null;
    for (const [key, value] of Object.entries(rawAttributes as Record<string, unknown>)) {
        if (!keyPattern.test(key)) continue;
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    }
    return null;
};

/**
 * Builds a classification payload from a ProspectLead and its scraped portfolio.
 * This is used so agency/private evaluation reflects "other listings from this seller",
 * not just the current listing page.
 */
export async function buildClassificationInputForProspect(
    prospectId: string,
    overrides: Partial<ClassificationInput> = {},
): Promise<ClassificationInput | null> {
    const prospect = await db.prospectLead.findUnique({
        where: { id: prospectId },
        select: {
            name: true,
            platformRegistered: true,
            profileUrl: true,
            listingCount: true,
            email: true,
            phone: true,
            scrapedListings: {
                where: {
                    status: { not: 'SKIPPED' },
                },
                orderBy: { createdAt: 'desc' },
                take: 12,
                select: {
                    title: true,
                    description: true,
                    price: true,
                    currency: true,
                    bedrooms: true,
                    bathrooms: true,
                    propertyArea: true,
                    locationText: true,
                    url: true,
                    contactChannels: true,
                    otherListingsCount: true,
                    rawAttributes: true,
                },
            },
        },
    });

    if (!prospect) return null;

    const dbListingCount = await db.scrapedListing.count({
        where: {
            prospectLeadId: prospectId,
            status: { not: 'SKIPPED' },
        },
    });

    const maxOtherListingsCount = prospect.scrapedListings.reduce((max, listing) => {
        const current = listing.otherListingsCount || 0;
        return current > max ? current : max;
    }, 0);

    const normalizedListingCount = Math.max(
        prospect.listingCount || 0,
        dbListingCount,
        maxOtherListingsCount,
    );

    if (normalizedListingCount > 0 && normalizedListingCount !== (prospect.listingCount || 0)) {
        await db.prospectLead.update({
            where: { id: prospectId },
            data: { listingCount: normalizedListingCount },
        });
    }

    const baseSampleListings: ClassificationSampleListing[] = prospect.scrapedListings.slice(0, 5).map((listing) => ({
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        petsAllowed: parsePetsAllowed(listing.rawAttributes),
        propertyArea: listing.propertyArea,
        location: listing.locationText,
        url: listing.url,
    }));

    const baseSampleTitles = baseSampleListings
        .map((listing) => listing.title)
        .filter((title): title is string => Boolean(title));

    const baseContactChannels = Array.from(
        new Set(
            prospect.scrapedListings.flatMap((listing) => listing.contactChannels || [])
        )
    );
    if (prospect.phone) baseContactChannels.push('phone');
    if (prospect.email) baseContactChannels.push('email');

    const mergedContactChannels = Array.from(
        new Set([...(baseContactChannels || []), ...(overrides.contactChannels || [])])
    );
    const mergedSampleTitles = Array.from(
        new Set([...(overrides.sampleListingTitles || []), ...baseSampleTitles])
    ).slice(0, 5);
    const mergedSampleListings = [...(overrides.sampleListings || []), ...baseSampleListings].slice(0, 5);

    const descriptionFromPortfolio = prospect.scrapedListings
        .map((listing) => listing.description)
        .find((description): description is string => Boolean(description && description.trim()));

    const businessNameFromPortfolio = prospect.scrapedListings
        .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business name$/i))
        .find((value): value is string => Boolean(value && value.trim()));
    const businessWebsiteFromPortfolio = prospect.scrapedListings
        .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business website$/i))
        .find((value): value is string => Boolean(value && value.trim()));
    const businessAddressFromPortfolio = prospect.scrapedListings
        .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business address$/i))
        .find((value): value is string => Boolean(value && value.trim()));
    const businessDescriptionFromPortfolio = prospect.scrapedListings
        .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business description$/i))
        .find((value): value is string => Boolean(value && value.trim()));
    const businessVerifiedRaw = prospect.scrapedListings
        .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business verified$/i))
        .find((value): value is string => Boolean(value && value.trim()));
    const businessVerifiedFromPortfolio = businessVerifiedRaw
        ? /^(yes|true|verified)$/i.test(businessVerifiedRaw)
        : null;

    return {
        name: overrides.name ?? businessNameFromPortfolio ?? prospect.name,
        description: overrides.description ?? descriptionFromPortfolio ?? null,
        listingCount: overrides.listingCount ?? (normalizedListingCount > 0 ? normalizedListingCount : null),
        platformRegistered: overrides.platformRegistered ?? prospect.platformRegistered,
        profileUrl: overrides.profileUrl ?? prospect.profileUrl,
        contactChannels: mergedContactChannels.length > 0 ? mergedContactChannels : undefined,
        sampleListingTitles: mergedSampleTitles.length > 0 ? mergedSampleTitles : undefined,
        sampleListings: mergedSampleListings.length > 0 ? mergedSampleListings : undefined,
        businessName: overrides.businessName ?? businessNameFromPortfolio ?? null,
        businessVerified: overrides.businessVerified ?? businessVerifiedFromPortfolio,
        businessAddress: overrides.businessAddress ?? businessAddressFromPortfolio ?? null,
        businessWebsite: overrides.businessWebsite ?? businessWebsiteFromPortfolio ?? null,
        businessDescription: overrides.businessDescription ?? businessDescriptionFromPortfolio ?? null,
    };
}

/**
 * Idempotency guard for prospect classification.
 * Skip reruns when a manual override exists or AI classification already populated fields.
 */
export async function shouldRunProspectClassification(
    prospectId: string,
): Promise<ProspectClassificationDecision> {
    const prospect = await db.prospectLead.findUnique({
        where: { id: prospectId },
        select: {
            sellerTypeManual: true,
            sellerType: true,
            isAgencyManual: true,
            agencyConfidence: true,
            agencyReasoning: true,
        },
    });

    if (!prospect) {
        return { shouldClassify: false, reason: 'Prospect not found.' };
    }

    if (prospect.sellerTypeManual !== null || prospect.isAgencyManual !== null) {
        return { shouldClassify: false, reason: 'Manual seller type override already set.' };
    }

    const hasExistingAiClassification =
        prospect.agencyConfidence !== null ||
        Boolean(prospect.agencyReasoning && prospect.agencyReasoning.trim().length > 0);

    if (hasExistingAiClassification) {
        return { shouldClassify: false, reason: 'Existing AI classification already present.' };
    }

    return { shouldClassify: true, reason: 'No existing classification found.' };
}

/**
 * AI-based prospect classification that determines if a prospect is an agency or private individual.
 * Uses multi-signal analysis via Gemini Flash for cost efficiency.
 */
export async function classifyProspect(input: ClassificationInput): Promise<ClassificationResult> {
    const model = getModelForTask('prospect_classification');

    const signals: string[] = [];
    if (input.name) signals.push(`Name: "${input.name}"`);
    if (input.description) signals.push(`Description: "${input.description.substring(0, 500)}"`);
    if (input.listingCount !== null && input.listingCount !== undefined) signals.push(`Active listings on platform: ${input.listingCount}`);
    if (input.platformRegistered) signals.push(`Registration info: "${input.platformRegistered}"`);
    if (input.profileUrl) signals.push(`Has profile page: ${input.profileUrl}`);
    if (input.contactChannels && input.contactChannels.length > 0) signals.push(`Contact channels: ${input.contactChannels.join(', ')}`);
    if (input.sampleListingTitles && input.sampleListingTitles.length > 0) {
        signals.push(`Sample listing titles:\n${input.sampleListingTitles.slice(0, 5).map(t => `  - "${t}"`).join('\n')}`);
    }
    if (input.businessName) signals.push(`Business profile name: "${input.businessName}"`);
    if (input.businessVerified !== null && input.businessVerified !== undefined) signals.push(`Business profile verified: ${input.businessVerified ? 'yes' : 'no'}`);
    if (input.businessAddress) signals.push(`Business address: "${input.businessAddress}"`);
    if (input.businessWebsite) signals.push(`Business website: ${input.businessWebsite}`);
    if (input.businessDescription) signals.push(`Business profile description: "${input.businessDescription.substring(0, 500)}"`);
    if (input.sampleListings && input.sampleListings.length > 0) {
        const sampleLines = input.sampleListings.slice(0, 5).map((listing) => {
            const bits: string[] = [];
            if (listing.title) bits.push(`title="${listing.title}"`);
            if (listing.price !== null && listing.price !== undefined) bits.push(`price=${listing.currency || 'EUR'} ${listing.price}`);
            if (listing.bedrooms !== null && listing.bedrooms !== undefined) bits.push(`beds=${listing.bedrooms}`);
            if (listing.bathrooms !== null && listing.bathrooms !== undefined) bits.push(`baths=${listing.bathrooms}`);
            if (listing.petsAllowed) bits.push(`pets="${listing.petsAllowed}"`);
            if (listing.propertyArea !== null && listing.propertyArea !== undefined) bits.push(`size=${listing.propertyArea}m²`);
            if (listing.location) bits.push(`location="${listing.location}"`);
            if (listing.url) bits.push(`url=${listing.url}`);
            return `  - ${bits.join(', ')}`;
        });
        signals.push(`Sample listings with details:\n${sampleLines.join('\n')}`);
    }

    if (signals.length === 0) {
        return { sellerType: 'private', isAgency: false, confidenceScore: 20, reasoning: 'No data available for classification.' };
    }

    const userContent = `Classify this seller:\n\n${signals.join('\n')}`;

    try {
        const aiResult = await callLLMWithMetadata(model, CLASSIFICATION_PROMPT, userContent, {
            jsonMode: true,
            temperature: 0.1,
        });

        if (aiResult.text) {
            const parsed = JSON.parse(aiResult.text);
            const typedSellerType = normalizeProspectSellerType(parsed.sellerType);
            const fallbackFromBoolean = parsed.isAgency === true ? 'agency' : 'private';
            const resolvedSellerType = typedSellerType || fallbackFromBoolean;
            return {
                sellerType: resolvedSellerType,
                isAgency: sellerTypeToLegacyAgencyFlag(resolvedSellerType),
                confidenceScore: Math.min(100, Math.max(0, parseInt(parsed.confidenceScore) || 50)),
                reasoning: parsed.reasoning || '',
            };
        }
    } catch (e: any) {
        console.warn(`[ProspectClassifier] AI classification failed: ${e.message}`);
    }

    // Fallback: default to private with low confidence
    return {
        sellerType: 'private',
        isAgency: false,
        confidenceScore: 20,
        reasoning: 'Classification failed, defaulting to private.',
    };
}

/**
 * Classify and update a ProspectLead record in the database.
 * Respects manual overrides — skips AI if isAgencyManual is set.
 * Logs usage to AgentExecution for the enterprise AI ledger.
 */
export async function classifyAndUpdateProspect(
    prospectId: string,
    locationId: string,
    input: ClassificationInput,
): Promise<ClassificationResult> {
    // Check if there's a manual override — if so, skip AI entirely
    const prospect = await db.prospectLead.findUnique({
        where: { id: prospectId },
        select: {
            sellerType: true,
            sellerTypeManual: true,
            isAgency: true,
            isAgencyManual: true,
        },
    });

    if (
        prospect?.sellerTypeManual !== null && prospect?.sellerTypeManual !== undefined ||
        prospect?.isAgencyManual !== null && prospect?.isAgencyManual !== undefined
    ) {
        const effectiveSellerType = resolveEffectiveSellerType({
            sellerType: prospect?.sellerType || null,
            sellerTypeManual: prospect?.sellerTypeManual || null,
            isAgency: prospect?.isAgency ?? null,
            isAgencyManual: prospect?.isAgencyManual ?? null,
        });
        try {
            const { stageAgencyProfileCompanyMatch } = await import('@/lib/leads/agency-company-linker');
            await stageAgencyProfileCompanyMatch(prospectId, locationId);
        } catch (e: any) {
            console.warn(`[ProspectClassifier] Failed to stage agency/company match for ${prospectId}: ${e.message}`);
        }

        return {
            sellerType: effectiveSellerType,
            isAgency: sellerTypeToLegacyAgencyFlag(effectiveSellerType),
            confidenceScore: 100,
            reasoning: 'Manual override by user.',
        };
    }

    const model = getModelForTask('prospect_classification');
    const result = await classifyProspect(input);

    // Only auto-set sellerType if confidence is >= 70
    const shouldAutoSet = result.confidenceScore >= 70;
    const storedSellerType: ProspectSellerType = shouldAutoSet ? result.sellerType : 'private';
    const storedAgencyFlag = sellerTypeToLegacyAgencyFlag(storedSellerType);

    await db.prospectLead.update({
        where: { id: prospectId },
        data: {
            sellerType: storedSellerType,
            isAgency: storedAgencyFlag,
            agencyConfidence: result.confidenceScore,
            agencyReasoning: result.reasoning,
        },
    });

    // Stage agency profile + company match metadata for pre-import workflows.
    try {
        const { stageAgencyProfileCompanyMatch } = await import('@/lib/leads/agency-company-linker');
        await stageAgencyProfileCompanyMatch(prospectId, locationId);
    } catch (e: any) {
        console.warn(`[ProspectClassifier] Failed to stage agency/company match for ${prospectId}: ${e.message}`);
    }

    // Log to enterprise AI usage ledger
    try {
        await db.agentExecution.create({
            data: {
                locationId,
                sourceType: 'scraper',
                sourceId: prospectId,
                taskTitle: 'Prospect Agency Classification',
                taskStatus: 'done',
                status: 'success',
                skillName: 'prospect_classifier',
                intent: 'classification',
                model,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                cost: 0,
            },
        });
    } catch (e) {
        // Non-critical — don't fail the classification
    }

    return result;
}
