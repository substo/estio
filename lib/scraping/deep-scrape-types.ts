export const OMISSION_REASONS = [
    'agency',
    'uncertain',
    'missing_phone',
    'non_real_estate',
    'duplicate',
    'budget_exhausted',
] as const;

export type OmissionReason = (typeof OMISSION_REASONS)[number];

export const STAGE_REASON_CODES = [
    'agency_skipped',
    'uncertain_skipped',
    'missing_phone',
    'non_real_estate',
    'relevance_ai_unavailable',
    'duplicate_listing',
    'duplicate_contact',
    'interaction_budget_exhausted',
    'task_config_ineligible',
    'task_error',
] as const;

export type StageReasonCode = (typeof STAGE_REASON_CODES)[number];

export type DeepScrapeErrorCategory = 'auth' | 'network' | 'extraction' | 'unknown';

export const DEEP_SCRAPE_RUN_STATUSES = [
    'queued',
    'running',
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const;

export type DeepScrapeRunStatus = (typeof DEEP_SCRAPE_RUN_STATUSES)[number];
export type DeepScrapeInFlightStatus = Extract<DeepScrapeRunStatus, 'queued' | 'running'>;
export type DeepScrapeTerminalStatus = Exclude<DeepScrapeRunStatus, DeepScrapeInFlightStatus>;

const TERMINAL_DEEP_RUN_STATUSES = new Set<DeepScrapeRunStatus>([
    'completed',
    'partial',
    'failed',
    'cancelled',
]);

const DEEP_RUN_TRANSITION_MAP: Record<DeepScrapeRunStatus, Set<DeepScrapeRunStatus>> = {
    queued: new Set(['running', 'failed', 'cancelled']),
    running: new Set(['completed', 'partial', 'failed', 'cancelled']),
    completed: new Set([]),
    partial: new Set([]),
    failed: new Set([]),
    cancelled: new Set([]),
};

export function isDeepScrapeTerminalStatus(status: string): status is DeepScrapeTerminalStatus {
    return TERMINAL_DEEP_RUN_STATUSES.has(status as DeepScrapeRunStatus);
}

export function isDeepScrapeInFlightStatus(status: string): status is DeepScrapeInFlightStatus {
    return status === 'queued' || status === 'running';
}

export function canTransitionDeepScrapeRunStatus(
    fromStatus: string,
    toStatus: string,
): boolean {
    if (fromStatus === toStatus) return true;
    if (!DEEP_SCRAPE_RUN_STATUSES.includes(fromStatus as DeepScrapeRunStatus)) return false;
    if (!DEEP_SCRAPE_RUN_STATUSES.includes(toStatus as DeepScrapeRunStatus)) return false;

    const allowedTransitions = DEEP_RUN_TRANSITION_MAP[fromStatus as DeepScrapeRunStatus];
    return allowedTransitions.has(toStatus as DeepScrapeRunStatus);
}

export function isQueuedRunStale(
    queuedAt: Date | string | null | undefined,
    nowMs = Date.now(),
    thresholdMs = 60_000,
): boolean {
    if (!queuedAt) return false;
    const queuedTimestamp = new Date(queuedAt).getTime();
    if (!Number.isFinite(queuedTimestamp)) return false;
    return nowMs - queuedTimestamp >= thresholdMs;
}

export interface DeepScrapeRunSummary {
    tasksScanned: number;
    tasksStarted: number;
    tasksCompleted: number;
    tasksSkipped: number;
    rootUrlsProcessed: number;
    indexPagesScraped: number;
    seedListingsFound: number;
    seedListingsNew: number;
    seedListingsDuplicate: number;
    prospectsCreated: number;
    prospectsMatched: number;
    contactsWithPhone: number;
    contactsWithoutPhone: number;
    sellerPortfoliosDiscovered: number;
    portfolioListingsDeepScraped: number;
    omittedAgency: number;
    omittedUncertain: number;
    omittedMissingPhone: number;
    omittedNonRealEstate: number;
    omittedDuplicate: number;
    omittedBudgetExhausted: number;
    errorsAuth: number;
    errorsNetwork: number;
    errorsExtraction: number;
    errorsUnknown: number;
    errorsTotal: number;
}

export interface DeepScrapeStageLog {
    stage: string;
    status: 'info' | 'success' | 'warning' | 'error' | 'skipped';
    reasonCode?: StageReasonCode;
    message?: string;
    counters?: Record<string, number>;
    metadata?: Record<string, unknown>;
}

export interface DeepScrapeConfigSnapshot {
    version: string;
    maxSeedListingsPerTask: number;
    privateConfidenceThreshold: number;
    requirePhoneForPortfolio: boolean;
    scope: {
        platform: 'bazaraki';
        enabledTasksOnly: boolean;
        targetUrlsRequired: boolean;
    };
}

export interface ProspectClassificationStateForDeepFlow {
    isAgency: boolean | null;
    confidence: number | null;
    manualOverride: boolean | null;
}

export type ProspectDeepDecision = 'private' | 'agency' | 'uncertain';

export const DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD = 70;

export function resolveProspectDeepDecision(
    state: ProspectClassificationStateForDeepFlow,
    confidenceThreshold = DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD,
): ProspectDeepDecision {
    if (state.manualOverride !== null && state.manualOverride !== undefined) {
        return state.manualOverride ? 'agency' : 'private';
    }

    if (state.confidence === null || state.confidence === undefined) {
        return 'uncertain';
    }

    if (state.confidence < confidenceThreshold) {
        return 'uncertain';
    }

    if (state.isAgency === true) return 'agency';
    if (state.isAgency === false) return 'private';
    return 'uncertain';
}

export function createEmptyDeepScrapeRunSummary(): DeepScrapeRunSummary {
    return {
        tasksScanned: 0,
        tasksStarted: 0,
        tasksCompleted: 0,
        tasksSkipped: 0,
        rootUrlsProcessed: 0,
        indexPagesScraped: 0,
        seedListingsFound: 0,
        seedListingsNew: 0,
        seedListingsDuplicate: 0,
        prospectsCreated: 0,
        prospectsMatched: 0,
        contactsWithPhone: 0,
        contactsWithoutPhone: 0,
        sellerPortfoliosDiscovered: 0,
        portfolioListingsDeepScraped: 0,
        omittedAgency: 0,
        omittedUncertain: 0,
        omittedMissingPhone: 0,
        omittedNonRealEstate: 0,
        omittedDuplicate: 0,
        omittedBudgetExhausted: 0,
        errorsAuth: 0,
        errorsNetwork: 0,
        errorsExtraction: 0,
        errorsUnknown: 0,
        errorsTotal: 0,
    };
}

export function mergeDeepScrapeRunSummary(
    base: DeepScrapeRunSummary,
    patch: Partial<DeepScrapeRunSummary>,
): DeepScrapeRunSummary {
    const next: DeepScrapeRunSummary = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const typedKey = key as keyof DeepScrapeRunSummary;
        next[typedKey] = (next[typedKey] || 0) + value;
    }
    return next;
}

export function categorizeScrapeError(error: unknown): DeepScrapeErrorCategory {
    const message = String((error as any)?.message || '').toLowerCase();
    if (!message) return 'unknown';
    const hasAuthSignal = /\b(auth|authorization|unauthorized|forbidden|credential|credentials|session|token|cookie|login)\b/.test(message);
    if (hasAuthSignal) return 'auth';
    if (message.includes('invalid url') || message.includes('cannot navigate')) return 'extraction';
    if (message.includes('network') || message.includes('econn') || message.includes('fetch') || message.includes('dns')) return 'network';
    if (message.includes('selector') || message.includes('extract') || message.includes('parse')) return 'extraction';
    return 'unknown';
}

export function omissionReasonToSummaryKey(reason: OmissionReason): keyof DeepScrapeRunSummary {
    switch (reason) {
        case 'agency':
            return 'omittedAgency';
        case 'uncertain':
            return 'omittedUncertain';
        case 'missing_phone':
            return 'omittedMissingPhone';
        case 'non_real_estate':
            return 'omittedNonRealEstate';
        case 'duplicate':
            return 'omittedDuplicate';
        case 'budget_exhausted':
            return 'omittedBudgetExhausted';
    }
}

export function errorCategoryToSummaryKey(category: DeepScrapeErrorCategory): keyof DeepScrapeRunSummary {
    switch (category) {
        case 'auth':
            return 'errorsAuth';
        case 'network':
            return 'errorsNetwork';
        case 'extraction':
            return 'errorsExtraction';
        case 'unknown':
        default:
            return 'errorsUnknown';
    }
}

export function countOmission(
    summary: DeepScrapeRunSummary,
    reason: OmissionReason,
    amount = 1,
): DeepScrapeRunSummary {
    const key = omissionReasonToSummaryKey(reason);
    return {
        ...summary,
        [key]: summary[key] + amount,
    };
}

export function countErrorCategory(
    summary: DeepScrapeRunSummary,
    category: DeepScrapeErrorCategory,
    amount = 1,
): DeepScrapeRunSummary {
    const key = errorCategoryToSummaryKey(category);
    return {
        ...summary,
        [key]: summary[key] + amount,
        errorsTotal: summary.errorsTotal + amount,
    };
}
