import { randomUUID } from "crypto";

type MetricPayload = Record<string, unknown>;

export function createTraceId(): string {
    return randomUUID();
}

export function logPerformanceMetric(name: string, payload: MetricPayload) {
    const safePayload = {
        ...payload,
        ts: new Date().toISOString(),
    };
    console.log(`[perf:${name}]`, JSON.stringify(safePayload));
}

export async function withServerTiming<T>(name: string, payload: MetricPayload, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
        const result = await fn();
        logPerformanceMetric(name, {
            ...payload,
            ok: true,
            durationMs: Date.now() - startedAt,
        });
        return result;
    } catch (error: any) {
        logPerformanceMetric(name, {
            ...payload,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: String(error?.message || error || "unknown"),
        });
        throw error;
    }
}

