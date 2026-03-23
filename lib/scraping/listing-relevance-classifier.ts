import { callLLMWithMetadata } from '@/lib/ai/llm';
import { getModelForTask } from '@/lib/ai/model-router';
import type { RawListing } from './listing-scraper';

type RelevanceSource = 'cached' | 'rule' | 'ai' | 'fallback';
export type ListingRelevanceDiagnosticCode =
    | 'none'
    | 'ai_unavailable_fail_closed'
    | 'ai_invalid_response_fail_closed';

export interface ListingRelevanceDecision {
    isRealEstate: boolean;
    confidence: number;
    source: RelevanceSource;
    reason: string;
    checkedAt: string;
    version: string;
    diagnosticCode: ListingRelevanceDiagnosticCode;
    aiAttempted: boolean;
    aiAttempts: number;
}

export interface ClassifyListingRelevanceOptions {
    forceReclassify?: boolean;
    disableAI?: boolean;
}

const RELEVANCE_VERSION = 'v2';

const RELEVANCE_RAW_ATTRIBUTE_KEYS = {
    decision: 'System listing relevance',
    confidence: 'System listing relevance confidence',
    source: 'System listing relevance source',
    reason: 'System listing relevance reason',
    checkedAt: 'System listing relevance checked at',
    version: 'System listing relevance version',
    diagnosticCode: 'System listing relevance diagnostic code',
    aiAttempted: 'System listing relevance ai attempted',
    aiAttempts: 'System listing relevance ai attempts',
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

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildTermRegex = (term: string): RegExp => {
    const escaped = escapeRegExp(term).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
};

const POSITIVE_TERM_PATTERNS = POSITIVE_TERMS.map((term) => ({ term, regex: buildTermRegex(term) }));
const NEGATIVE_TERM_PATTERNS = NEGATIVE_TERMS.map((term) => ({ term, regex: buildTermRegex(term) }));

const NON_REAL_ESTATE_URL_HINTS = [
    '/for-sale/home-garden',
    '/for-sale/electronics',
    '/for-sale/clothes-shoes',
    '/for-sale/children-babies',
    '/for-sale/animals',
    '/for-sale/jobs',
];

const delay = async (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`timeout:${timeoutMs}`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

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
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.diagnosticCode]: decision.diagnosticCode,
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.aiAttempted]: decision.aiAttempted ? 'true' : 'false',
        [RELEVANCE_RAW_ATTRIBUTE_KEYS.aiAttempts]: String(Math.max(0, Math.floor(decision.aiAttempts))),
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
    const reason = readText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.reason]) || 'cached listing relevance decision';
    const checkedAtRaw = readText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.checkedAt]);
    const checkedAt = checkedAtRaw || new Date(0).toISOString();
    const diagnosticCodeRaw = normalizeText(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.diagnosticCode]);
    const diagnosticCode: ListingRelevanceDiagnosticCode = (
        diagnosticCodeRaw === 'ai_unavailable_fail_closed'
        || diagnosticCodeRaw === 'ai_invalid_response_fail_closed'
    )
        ? diagnosticCodeRaw
        : 'none';
    const aiAttempted = parseBoolean(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.aiAttempted]) ?? false;
    const aiAttempts = Math.max(0, parseNumber(attrs[RELEVANCE_RAW_ATTRIBUTE_KEYS.aiAttempts]) ?? 0);

    return {
        isRealEstate: boolDecision,
        confidence: clamp(confidence, 0, 100),
        source: 'cached',
        reason,
        checkedAt,
        version,
        diagnosticCode,
        aiAttempted,
        aiAttempts,
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

function collectTermHits(
    haystack: string,
    patterns: Array<{ term: string; regex: RegExp }>
): string[] {
    return patterns
        .filter(({ regex }) => regex.test(haystack))
        .map(({ term }) => term);
}

export function classifyListingRelevanceWithRules(
    listing: RawListing
): ListingRelevanceDecision & { uncertain: boolean; score: number } {
    let score = 0;
    const reasons: string[] = [];

    const haystack = buildRuleInput(listing);
    const url = normalizeText(listing.url);

    if (url.includes('/real-estate')) {
        score += 4;
        reasons.push('URL is inside real-estate taxonomy');
    }
    if (NON_REAL_ESTATE_URL_HINTS.some((hint) => url.includes(hint))) {
        score -= 5;
        reasons.push('URL is inside non-real-estate taxonomy');
    }

    if (typeof listing.bedrooms === 'number' || typeof listing.bathrooms === 'number') {
        score += 2;
        reasons.push('has bedroom/bathroom structure');
    }
    if (typeof listing.propertyArea === 'number' || typeof listing.plotArea === 'number') {
        score += 2;
        reasons.push('has property size structure');
    }

    const positiveHits = collectTermHits(haystack, POSITIVE_TERM_PATTERNS);
    const negativeHits = collectTermHits(haystack, NEGATIVE_TERM_PATTERNS);

    if (positiveHits.length > 0) {
        score += Math.min(6, positiveHits.length);
        reasons.push(`positive terms: ${positiveHits.slice(0, 3).join(', ')}`);
    }

    if (negativeHits.length > 0) {
        score -= Math.min(8, negativeHits.length * 2);
        reasons.push(`negative terms: ${negativeHits.slice(0, 3).join(', ')}`);
    }

    const uncertain = score > -3 && score < 3;
    const isRealEstate = score >= 3;
    const confidence = uncertain
        ? clamp(45 + Math.abs(score) * 5, 45, 64)
        : clamp(68 + Math.abs(score) * 6, 65, 98);

    return {
        isRealEstate,
        confidence,
        source: 'rule',
        reason: (reasons.length > 0 ? reasons.join('; ') : 'rule-based fallback') + `; score=${score}`,
        checkedAt: new Date().toISOString(),
        version: RELEVANCE_VERSION,
        diagnosticCode: 'none',
        aiAttempted: false,
        aiAttempts: 0,
        uncertain,
        score,
    };
}

interface AIClassificationAttemptResult {
    decision: ListingRelevanceDecision | null;
    attempts: number;
    failure: 'none' | 'unavailable' | 'invalid_response';
}

function parseAIRelevanceResponse(text: string): {
    isRealEstate: boolean;
    confidence: number;
    reason: string;
} | null {
    const parsed = JSON.parse(text || '{}') as Record<string, unknown>;
    if (typeof parsed.isRealEstate !== 'boolean') {
        return null;
    }
    const confidence = parseNumber(parsed.confidence);
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 240)
        : 'ai listing relevance classification';

    return {
        isRealEstate: parsed.isRealEstate,
        confidence: clamp(confidence ?? 55, 0, 100),
        reason,
    };
}

async function classifyWithAI(
    listing: RawListing,
    options: Pick<ClassifyListingRelevanceOptions, 'disableAI'> = {}
): Promise<AIClassificationAttemptResult> {
    if (options.disableAI) {
        return {
            decision: null,
            attempts: 0,
            failure: 'unavailable',
        };
    }

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
- If uncertain, choose false with confidence between 35 and 55.`;

    const payload = {
        url: listing.url,
        title: listing.title,
        description: listing.description?.slice(0, 800) || '',
        propertyType: listing.propertyType || null,
        listingType: listing.listingType || null,
        location: listing.location || null,
        rawAttributes: listing.rawAttributes || null,
    };

    const maxAttempts = 3;
    let failure: AIClassificationAttemptResult['failure'] = 'unavailable';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const aiResult = await withTimeout(
                callLLMWithMetadata(
                    model,
                    systemPrompt,
                    JSON.stringify(payload),
                    { jsonMode: true, temperature: 0.1, maxOutputTokens: 220 }
                ),
                15_000,
            );

            const parsed = parseAIRelevanceResponse(aiResult.text || '');
            if (!parsed) {
                failure = 'invalid_response';
            } else {
                return {
                    decision: {
                        isRealEstate: parsed.isRealEstate,
                        confidence: parsed.confidence,
                        source: 'ai',
                        reason: parsed.reason,
                        checkedAt: new Date().toISOString(),
                        version: RELEVANCE_VERSION,
                        diagnosticCode: 'none',
                        aiAttempted: true,
                        aiAttempts: attempt,
                    },
                    attempts: attempt,
                    failure: 'none',
                };
            }
        } catch {
            failure = 'unavailable';
        }

        if (attempt < maxAttempts) {
            await delay(250 * attempt);
        }
    }

    return {
        decision: null,
        attempts: maxAttempts,
        failure,
    };
}

export async function classifyListingRelevance(
    listing: RawListing,
    existingRawAttributes?: unknown,
    options: ClassifyListingRelevanceOptions = {}
): Promise<ListingRelevanceDecision> {
    const cached = options.forceReclassify
        ? null
        : getCachedListingRelevanceDecision(existingRawAttributes);
    if (cached) return cached;

    const ruleDecision = classifyListingRelevanceWithRules(listing);
    if (!ruleDecision.uncertain) {
        return ruleDecision;
    }

    const aiAttempt = await classifyWithAI(listing, {
        disableAI: options.disableAI,
    });
    if (aiAttempt.decision) return aiAttempt.decision;

    const failureReason = aiAttempt.failure === 'invalid_response'
        ? `AI returned invalid JSON after ${aiAttempt.attempts} attempt(s); fail-closed`
        : `AI unavailable after ${aiAttempt.attempts} attempt(s); fail-closed`;

    return {
        isRealEstate: false,
        confidence: clamp(ruleDecision.confidence - 10, 20, 60),
        source: 'fallback',
        reason: `${ruleDecision.reason}; ${failureReason}`.slice(0, 240),
        checkedAt: new Date().toISOString(),
        version: RELEVANCE_VERSION,
        diagnosticCode: aiAttempt.failure === 'invalid_response'
            ? 'ai_invalid_response_fail_closed'
            : 'ai_unavailable_fail_closed',
        aiAttempted: true,
        aiAttempts: aiAttempt.attempts,
    };
}

export function isInternalSystemRawAttributeKey(key: string): boolean {
    return key.startsWith('System listing relevance');
}
