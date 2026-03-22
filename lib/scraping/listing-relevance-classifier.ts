import { callLLMWithMetadata } from '@/lib/ai/llm';
import { getModelForTask } from '@/lib/ai/model-router';
import type { RawListing } from './listing-scraper';

type RelevanceSource = 'cached' | 'rule' | 'ai' | 'fallback';

export interface ListingRelevanceDecision {
    isRealEstate: boolean;
    confidence: number;
    source: RelevanceSource;
    reason: string;
    checkedAt: string;
    version: string;
}

const RELEVANCE_VERSION = 'v1';

const RELEVANCE_RAW_ATTRIBUTE_KEYS = {
    decision: 'System listing relevance',
    confidence: 'System listing relevance confidence',
    source: 'System listing relevance source',
    reason: 'System listing relevance reason',
    checkedAt: 'System listing relevance checked at',
    version: 'System listing relevance version',
} as const;

const POSITIVE_TERMS = [
    'apartment',
    'studio',
    'villa',
    'house',
    'flat',
    'property',
    'real estate',
    'land',
    'plot',
    'office',
    'shop',
    'warehouse',
    'penthouse',
    'maisonette',
    'bedroom',
    'bathroom',
    'sq.m',
    'm²',
    'for rent',
    'for sale',
];

const NEGATIVE_TERMS = [
    'car',
    'cars',
    'vehicle',
    'motorbike',
    'bike',
    'job',
    'jobs',
    'iphone',
    'android',
    'laptop',
    'playstation',
    'xbox',
    'sofa',
    'furniture',
    'pet',
    'dog',
    'cat',
    'stroller',
    'baby',
    'watch',
    'shoes',
    'dress',
    'tractor',
];

const normalizeText = (value: unknown): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

const parseBoolean = (value: unknown): boolean | null => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    if (/^(true|yes|real_estate|realestate|1)$/i.test(value.trim())) return true;
    if (/^(false|no|non_real_estate|nonrealestate|0)$/i.test(value.trim())) return false;
    return null;
};

const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value !== 'string') return null;
    const parsed = parseInt(value.replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const readText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
};

export function buildListingRelevanceRawAttributes(
    decision: ListingRelevanceDecision
): Record<string, string> {
    return {
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.decision]: decision.isRealEstate ? 'real_estate' : 'non_real_estate',
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.confidence]: String(clamp(decision.confidence, 0, 100)),
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.source]: decision.source,
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.reason]: decision.reason.slice(0, 240),
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.checkedAt]: decision.checkedAt,
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.version]: decision.version,
    };
}

export function getCachedListingRelevanceDecision(
    rawAttributes: unknown
): ListingRelevanceDecision | null {
    if (!rawAttributes || typeof rawAttributes !== 'object') return null;
    const attrs = rawAttributes as Record<string, unknown>;

    const boolDecision = parseBoolean(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.decision]);
    if (boolDecision === null) return null;

    // Versioned cache guard: reclassify rows created by older heuristics/models.
    const version = normalizeText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.version]);
    if (!version || version !== RELEVANCE_VERSION) return null;

    const confidence = parseNumber(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.confidence]) ?? 90;
    const source = normalizeText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.source]) || 'cached';
    const reason = readText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.reason]) || 'cached listing relevance decision';
    const checkedAtRaw = readText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.checkedAt]);
    const checkedAt = checkedAtRaw || new Date(0).toISOString();

    return {
        isRealEstate: boolDecision,
        confidence: clamp(confidence, 0, 100),
        source: 'cached',
        reason,
        checkedAt,
        version,
    };
}

function buildRuleInput(listing: RawListing): string {
    const attributesText = listing.rawAttributes
        ? Object.entries(listing.rawAttributes)
            .slice(0, 20)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' | ')
        : '';

    return [
        listing.url,
        listing.title,
        listing.description?.slice(0, 500) || '',
        listing.propertyType || '',
        listing.listingType || '',
        listing.location || '',
        attributesText,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function classifyWithRules(listing: RawListing): ListingRelevanceDecision & { uncertain: boolean } {
    let score = 0;
    const reasons: string[] = [];

    const haystack = buildRuleInput(listing);
    const url = normalizeText(listing.url);

    if (url.includes('/real-estate')) {
        score += 4;
        reasons.push('URL is inside real-estate taxonomy');
    }

    if (typeof listing.bedrooms === 'number' || typeof listing.bathrooms === 'number') {
        score += 2;
        reasons.push('has bedroom/bathroom structure');
    }
    if (typeof listing.propertyArea === 'number' || typeof listing.plotArea === 'number') {
        score += 2;
        reasons.push('has property size structure');
    }

    const positiveHits = POSITIVE_TERMS.filter((term) => haystack.includes(term));
    const negativeHits = NEGATIVE_TERMS.filter((term) => haystack.includes(term));

    if (positiveHits.length > 0) {
        score += Math.min(4, positiveHits.length);
        reasons.push(`positive terms: ${positiveHits.slice(0, 3).join(', ')}`);
    }

    if (negativeHits.length > 0) {
        score -= Math.min(5, negativeHits.length);
        reasons.push(`negative terms: ${negativeHits.slice(0, 3).join(', ')}`);
    }

    const uncertain = score > -2 && score < 2;
    const isRealEstate = score >= 0;
    const confidence = clamp(58 + Math.abs(score) * 10, 30, 97);

    return {
        isRealEstate,
        confidence,
        source: 'rule',
        reason: reasons.length > 0 ? reasons.join('; ') : 'rule-based fallback',
        checkedAt: new Date().toISOString(),
        version: RELEVANCE_VERSION,
        uncertain,
    };
}

async function classifyWithAI(listing: RawListing): Promise<ListingRelevanceDecision | null> {
    const model = getModelForTask('listing_relevance_classification');

    const systemPrompt = `You classify marketplace listings for a real-estate CRM.

Return JSON only:
{
  "isRealEstate": true/false,
  "confidence": 0-100,
  "reason": "one short sentence"
}

Rules:
- Real estate includes homes, apartments, land, offices, shops, warehouses, rentals, sales.
- Non-real-estate includes vehicles, electronics, services, jobs, pets, fashion, general goods.
- If uncertain, prefer true with lower confidence (45-60).`;

    const payload = {
        url: listing.url,
        title: listing.title,
        description: listing.description?.slice(0, 800) || '',
        propertyType: listing.propertyType || null,
        listingType: listing.listingType || null,
        location: listing.location || null,
        rawAttributes: listing.rawAttributes || null,
    };

    try {
        const aiResult = await callLLMWithMetadata(
            model,
            systemPrompt,
            JSON.stringify(payload),
            { jsonMode: true, temperature: 0.1, maxOutputTokens: 220 }
        );

        const parsed = JSON.parse(aiResult.text || '{}') as Record<string, unknown>;
        const isRealEstate = parsed.isRealEstate === true;
        const confidence = clamp(parseNumber(parsed.confidence) ?? 55, 0, 100);
        const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim().slice(0, 240)
            : 'ai listing relevance classification';

        return {
            isRealEstate,
            confidence,
            source: 'ai',
            reason,
            checkedAt: new Date().toISOString(),
            version: RELEVANCE_VERSION,
        };
    } catch {
        return null;
    }
}

export async function classifyListingRelevance(
    listing: RawListing,
    existingRawAttributes?: unknown
): Promise<ListingRelevanceDecision> {
    const cached = getCachedListingRelevanceDecision(existingRawAttributes);
    if (cached) return cached;

    const ruleDecision = classifyWithRules(listing);
    if (!ruleDecision.uncertain) {
        return ruleDecision;
    }

    const aiDecision = await classifyWithAI(listing);
    if (aiDecision) return aiDecision;

    return {
        ...ruleDecision,
        source: 'fallback',
        reason: `${ruleDecision.reason}; AI unavailable, using rule fallback`.slice(0, 240),
    };
}

export function isInternalSystemRawAttributeKey(key: string): boolean {
    return key.startsWith('System listing relevance');
}
