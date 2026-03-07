type RetryOptions = {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
};

type CircuitBreakerOptions = {
    failureThreshold?: number;
    coolDownMs?: number;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
    const text = String((error as any)?.message || error || "").toLowerCase();
    if (!text) return true;
    if (text.includes("abort") || text.includes("timeout") || text.includes("econn") || text.includes("network")) return true;
    if (text.includes("429") || text.includes("502") || text.includes("503") || text.includes("504")) return true;
    return false;
}

export async function withTimeout<T>(task: () => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race<T>([
            task(),
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function withRetry<T>(task: () => Promise<T>, options?: RetryOptions): Promise<T> {
    const attempts = Math.max(1, Number(options?.attempts || 3));
    const baseDelayMs = Math.max(50, Number(options?.baseDelayMs || 250));
    const maxDelayMs = Math.max(baseDelayMs, Number(options?.maxDelayMs || 2000));

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            lastError = error;
            if (attempt >= attempts || !isRetryableError(error)) break;
            const backoff = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
            const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(backoff * 0.15)));
            await sleep(backoff + jitter);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || "Retry attempts exhausted"));
}

class CircuitBreakerState {
    private failures = 0;
    private openedAtMs: number | null = null;

    constructor(
        private readonly failureThreshold: number,
        private readonly coolDownMs: number
    ) { }

    canExecute() {
        if (this.openedAtMs == null) return true;
        if (Date.now() - this.openedAtMs >= this.coolDownMs) {
            this.failures = 0;
            this.openedAtMs = null;
            return true;
        }
        return false;
    }

    onSuccess() {
        this.failures = 0;
        this.openedAtMs = null;
    }

    onFailure() {
        this.failures += 1;
        if (this.failures >= this.failureThreshold) {
            this.openedAtMs = Date.now();
        }
    }
}

const breakers = new Map<string, CircuitBreakerState>();

function getBreaker(key: string, options?: CircuitBreakerOptions) {
    const existing = breakers.get(key);
    if (existing) return existing;
    const state = new CircuitBreakerState(
        Math.max(1, Number(options?.failureThreshold || 5)),
        Math.max(1000, Number(options?.coolDownMs || 30_000))
    );
    breakers.set(key, state);
    return state;
}

export async function withCircuitBreaker<T>(
    key: string,
    task: () => Promise<T>,
    options?: CircuitBreakerOptions
): Promise<T> {
    const breaker = getBreaker(key, options);
    if (!breaker.canExecute()) {
        throw new Error(`Circuit open for ${key}`);
    }

    try {
        const result = await task();
        breaker.onSuccess();
        return result;
    } catch (error) {
        breaker.onFailure();
        throw error;
    }
}

export async function withResilience<T>(args: {
    breakerKey: string;
    timeoutMs?: number;
    timeoutMessage?: string;
    retry?: RetryOptions;
    breaker?: CircuitBreakerOptions;
    task: () => Promise<T>;
}): Promise<T> {
    const timeoutMs = Math.max(1000, Number(args.timeoutMs || 10_000));
    const timeoutMessage = args.timeoutMessage || `Timeout while executing ${args.breakerKey}`;

    return withCircuitBreaker(
        args.breakerKey,
        () => withRetry(
            () => withTimeout(args.task, timeoutMs, timeoutMessage),
            args.retry
        ),
        args.breaker
    );
}
