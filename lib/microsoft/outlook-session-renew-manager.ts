import { outlookPuppeteerService } from '@/lib/microsoft/outlook-puppeteer';

type RenewMode = 'auto' | 'manual';

interface RenewState {
    inFlight: boolean;
    currentPromise?: Promise<RenewRunResult>;
    lastAttemptAt?: Date;
    lastAttemptMode?: RenewMode;
    lastSuccessAt?: Date;
    lastError?: string;
    lastErrorAt?: Date;
}

export interface RenewRunResult {
    success: boolean;
    error?: string;
}

export interface RenewStatusSnapshot {
    inFlight: boolean;
    lastAttemptAt: Date | null;
    lastAttemptMode: RenewMode | null;
    lastSuccessAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
    throttled: boolean;
    nextEligibleAt: Date | null;
    cooldownMs: number;
}

export interface RenewRequestResult {
    started: boolean;
    inFlight: boolean;
    throttled: boolean;
    nextEligibleAt: Date | null;
    result?: RenewRunResult;
}

// Throttle background renew attempts to avoid repeated login attempts from page refreshes/tabs.
const AUTO_RENEW_COOLDOWN_MS = 15 * 60 * 1000;
const renewStates = new Map<string, RenewState>();

function getState(userId: string): RenewState {
    let state = renewStates.get(userId);
    if (!state) {
        state = { inFlight: false };
        renewStates.set(userId, state);
    }
    return state;
}

function getNextEligibleAt(state: RenewState): Date | null {
    if (!state.lastAttemptAt) return null;
    return new Date(state.lastAttemptAt.getTime() + AUTO_RENEW_COOLDOWN_MS);
}

function getThrottleState(state: RenewState): { throttled: boolean; nextEligibleAt: Date | null } {
    const nextEligibleAt = getNextEligibleAt(state);
    if (!nextEligibleAt) return { throttled: false, nextEligibleAt: null };
    return {
        throttled: Date.now() < nextEligibleAt.getTime(),
        nextEligibleAt
    };
}

async function runRenew(userId: string, mode: RenewMode): Promise<RenewRunResult> {
    const state = getState(userId);
    state.lastAttemptAt = new Date();
    state.lastAttemptMode = mode;
    state.inFlight = true;

    try {
        const refreshResult = await outlookPuppeteerService.refreshSession(userId);
        if (!refreshResult.success) {
            const error = 'Automatic session renewal failed. Please reconnect manually.';
            state.lastError = error;
            state.lastErrorAt = new Date();
            return { success: false, error };
        }

        state.lastSuccessAt = new Date();
        state.lastError = undefined;
        state.lastErrorAt = undefined;
        return { success: true };
    } catch (error: any) {
        const message = error?.message || 'Failed to renew Outlook session';
        state.lastError = message;
        state.lastErrorAt = new Date();
        return { success: false, error: message };
    } finally {
        state.inFlight = false;
        state.currentPromise = undefined;
    }
}

export function getOutlookSessionRenewStatus(userId: string): RenewStatusSnapshot {
    const state = getState(userId);
    const { throttled, nextEligibleAt } = getThrottleState(state);

    return {
        inFlight: state.inFlight,
        lastAttemptAt: state.lastAttemptAt ?? null,
        lastAttemptMode: state.lastAttemptMode ?? null,
        lastSuccessAt: state.lastSuccessAt ?? null,
        lastError: state.lastError ?? null,
        lastErrorAt: state.lastErrorAt ?? null,
        throttled,
        nextEligibleAt,
        cooldownMs: AUTO_RENEW_COOLDOWN_MS,
    };
}

export async function requestOutlookSessionRenew(
    userId: string,
    options?: { mode?: RenewMode; force?: boolean; awaitCompletion?: boolean }
): Promise<RenewRequestResult> {
    const mode = options?.mode ?? 'auto';
    const force = options?.force ?? false;
    const awaitCompletion = options?.awaitCompletion ?? false;
    const state = getState(userId);

    if (state.inFlight) {
        if (awaitCompletion && state.currentPromise) {
            const result = await state.currentPromise;
            return {
                started: false,
                inFlight: false,
                throttled: false,
                nextEligibleAt: getNextEligibleAt(state),
                result
            };
        }

        return {
            started: false,
            inFlight: true,
            throttled: false,
            nextEligibleAt: getNextEligibleAt(state)
        };
    }

    const { throttled, nextEligibleAt } = getThrottleState(state);
    if (!force && throttled) {
        return {
            started: false,
            inFlight: false,
            throttled: true,
            nextEligibleAt
        };
    }

    const promise = runRenew(userId, mode);
    state.currentPromise = promise;

    if (!awaitCompletion) {
        void promise;
        return {
            started: true,
            inFlight: true,
            throttled: false,
            nextEligibleAt: getNextEligibleAt(state)
        };
    }

    const result = await promise;
    return {
        started: true,
        inFlight: false,
        throttled: false,
        nextEligibleAt: getNextEligibleAt(state),
        result
    };
}
