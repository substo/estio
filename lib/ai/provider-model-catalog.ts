import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import type { AiModelCapability, AiTaskId } from "@/lib/ai/model-capabilities";
import { AI_TASK_DEFINITIONS, getModelCapabilities, modelSupportsTask } from "@/lib/ai/model-capabilities";
import type { ModelOption } from "@/lib/ai/fetch-models";

export type AiProviderModelProvider = "google_gemini" | "openai_api" | "chatgpt_subscription";
export type AiProviderModelScopeType = "GLOBAL" | "LOCATION" | "USER";
export type AiProviderModelStatus = "active" | "stale" | "unavailable";

export type DiscoveredProviderModel = {
    provider: AiProviderModelProvider;
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    modelId: string;
    displayName?: string | null;
    description?: string | null;
    capabilities: AiModelCapability[];
    source?: string | null;
    rawMetadata?: unknown;
    pricing?: unknown;
};

export type StoredProviderModel = DiscoveredProviderModel & {
    id: string;
    status: AiProviderModelStatus;
    firstSeenAt: Date;
    lastSeenAt: Date;
    lastCheckedAt: Date;
    unavailableSince: Date | null;
};

export type ProviderCatalogRefreshResult = {
    provider: AiProviderModelProvider;
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    discovered: number;
    activated: number;
    stale: number;
    unavailable: number;
};

export type ResolvedProviderModel = {
    modelId: string;
    provider: AiProviderModelProvider;
    status: AiProviderModelStatus;
    capabilities: AiModelCapability[];
    fallbackReason?: string;
};

type RawProviderModelRow = {
    id: string;
    provider: string;
    scopeType: string;
    scopeId: string;
    modelId: string;
    displayName: string | null;
    description: string | null;
    capabilities: unknown;
    status: string;
    source: string | null;
    rawMetadata: unknown;
    firstSeenAt: Date;
    lastSeenAt: Date;
    lastCheckedAt: Date;
    unavailableSince: Date | null;
};

const STALE_TO_UNAVAILABLE_DAYS = 7;

function normalizeScopeId(scopeId?: string | null): string {
    return String(scopeId || "global").trim() || "global";
}

function normalizeCapabilities(value: unknown): AiModelCapability[] {
    const raw = Array.isArray(value) ? value : [];
    return Array.from(new Set(
        raw
            .map((item) => String(item || "").trim())
            .filter(Boolean)
    )) as AiModelCapability[];
}

function normalizeStatus(value: unknown): AiProviderModelStatus {
    const normalized = String(value || "").trim();
    if (normalized === "stale" || normalized === "unavailable") return normalized;
    return "active";
}

function toStoredProviderModel(row: RawProviderModelRow): StoredProviderModel {
    const rawMetadata = row.rawMetadata;
    const metadataRecord = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
        ? rawMetadata as Record<string, unknown>
        : {};

    return {
        id: row.id,
        provider: row.provider as AiProviderModelProvider,
        scopeType: row.scopeType as AiProviderModelScopeType,
        scopeId: row.scopeId,
        modelId: row.modelId,
        displayName: row.displayName,
        description: row.description,
        capabilities: normalizeCapabilities(row.capabilities),
        status: normalizeStatus(row.status),
        source: row.source,
        rawMetadata,
        pricing: metadataRecord.providerPricing || null,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        lastCheckedAt: row.lastCheckedAt,
        unavailableSince: row.unavailableSince,
    };
}

function mergeRawMetadataWithPricing(rawMetadata: unknown, pricing: unknown): unknown {
    const base = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
        ? rawMetadata as Record<string, unknown>
        : rawMetadata === undefined || rawMetadata === null
            ? {}
            : { providerRawMetadata: rawMetadata };

    if (pricing === undefined || pricing === null) return base;

    return {
        ...base,
        providerPricing: pricing,
    };
}

function storedModelSupportsTask(record: StoredProviderModel, taskId: AiTaskId): boolean {
    const task = AI_TASK_DEFINITIONS[taskId];
    if (!task) return true;
    const capabilities = new Set(record.capabilities);
    return task.requiredCapabilities.every((capability) => capabilities.has(capability));
}

function isMissingCatalogTableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    return /ai_provider_models/i.test(message) && /(does not exist|P2021|relation)/i.test(message);
}

export function classifyProviderModelCapabilities(input: {
    provider: AiProviderModelProvider;
    modelId: string;
    label?: string | null;
    description?: string | null;
}): AiModelCapability[] {
    if (input.provider === "google_gemini") {
        return getModelCapabilities({
            value: input.modelId,
            label: input.label || undefined,
            description: input.description || undefined,
        });
    }

    const id = input.modelId.toLowerCase();
    if (input.provider === "openai_api") {
        if (id.includes("image") || id.includes("dall-e")) {
            return ["imageGeneration", "imageEdit"];
        }
        if (id.includes("embedding")) return ["embedding"];
        if (id.includes("audio") || id.includes("transcribe") || id.includes("whisper")) return ["audioInput"];
        if (id.startsWith("openai:gpt-") || id.startsWith("gpt-") || id.startsWith("openai:o") || id.startsWith("o")) {
            return ["text", "json", "vision", "streaming"];
        }
    }

    if (input.provider === "chatgpt_subscription") {
        if (id.includes("image")) return [];
        return ["text", "json", "streaming"];
    }

    return [];
}

export function calculateMissingProviderModelStatus(input: {
    lastSeenAt: Date;
    checkedAt: Date;
    staleToUnavailableDays?: number;
}): AiProviderModelStatus {
    const days = input.staleToUnavailableDays ?? STALE_TO_UNAVAILABLE_DAYS;
    const elapsedMs = input.checkedAt.getTime() - input.lastSeenAt.getTime();
    const thresholdMs = days * 24 * 60 * 60 * 1000;
    return elapsedMs >= thresholdMs ? "unavailable" : "stale";
}

export async function getStoredProviderModels(input: {
    provider?: AiProviderModelProvider;
    scopeType?: AiProviderModelScopeType;
    scopeId?: string;
    includeUnavailable?: boolean;
} = {}): Promise<StoredProviderModel[]> {
    try {
        const provider = input.provider || null;
        const scopeType = input.scopeType || null;
        const scopeId = input.scopeId ? normalizeScopeId(input.scopeId) : null;
        const includeUnavailable = input.includeUnavailable === true;

        const rows = await db.$queryRaw<RawProviderModelRow[]>(Prisma.sql`
            SELECT
                id,
                provider,
                scope_type AS "scopeType",
                scope_id AS "scopeId",
                model_id AS "modelId",
                display_name AS "displayName",
                description,
                capabilities,
                status,
                source,
                raw_metadata AS "rawMetadata",
                first_seen_at AS "firstSeenAt",
                last_seen_at AS "lastSeenAt",
                last_checked_at AS "lastCheckedAt",
                unavailable_since AS "unavailableSince"
            FROM ai_provider_models
            WHERE (${provider}::text IS NULL OR provider = ${provider})
              AND (${scopeType}::text IS NULL OR scope_type = ${scopeType})
              AND (${scopeId}::text IS NULL OR scope_id = ${scopeId})
              AND (${includeUnavailable}::boolean OR status <> 'unavailable')
            ORDER BY status ASC, display_name DESC NULLS LAST, model_id DESC
        `);

        return rows.map(toStoredProviderModel);
    } catch (error) {
        if (isMissingCatalogTableError(error)) return [];
        throw error;
    }
}

export async function getStoredProviderModelOptions(input: {
    provider: AiProviderModelProvider;
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    taskId?: AiTaskId;
}): Promise<ModelOption[]> {
    const records = await getStoredProviderModels({
        provider: input.provider,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
    });

    return records
        .filter((record) => record.status === "active")
        .filter((record) => !input.taskId || storedModelSupportsTask(record, input.taskId))
        .map((record) => ({
            value: record.modelId,
            label: record.displayName || record.modelId,
            description: record.description || undefined,
        }));
}

export async function refreshProviderModelCatalog(input: {
    provider: AiProviderModelProvider;
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    models: DiscoveredProviderModel[];
    checkedAt?: Date;
    staleToUnavailableDays?: number;
}): Promise<ProviderCatalogRefreshResult> {
    const checkedAt = input.checkedAt || new Date();
    const scopeId = normalizeScopeId(input.scopeId);
    const deduped = new Map<string, DiscoveredProviderModel>();

    for (const model of input.models) {
        const modelId = String(model.modelId || "").trim();
        if (!modelId) continue;
        deduped.set(modelId, {
            ...model,
            scopeId,
            modelId,
            capabilities: normalizeCapabilities(model.capabilities),
            rawMetadata: mergeRawMetadataWithPricing(model.rawMetadata, model.pricing),
        });
    }

    for (const model of deduped.values()) {
        await db.$executeRaw(Prisma.sql`
            INSERT INTO ai_provider_models (
                id,
                provider,
                scope_type,
                scope_id,
                model_id,
                display_name,
                description,
                capabilities,
                status,
                source,
                raw_metadata,
                first_seen_at,
                last_seen_at,
                last_checked_at,
                unavailable_since,
                updated_at
            ) VALUES (
                ${randomUUID()},
                ${input.provider},
                ${input.scopeType},
                ${scopeId},
                ${model.modelId},
                ${model.displayName || null},
                ${model.description || null},
                ${JSON.stringify(model.capabilities)}::jsonb,
                'active',
                ${model.source || null},
                ${JSON.stringify(model.rawMetadata || null)}::jsonb,
                ${checkedAt},
                ${checkedAt},
                ${checkedAt},
                NULL,
                ${checkedAt}
            )
            ON CONFLICT (provider, scope_type, scope_id, model_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                capabilities = EXCLUDED.capabilities,
                status = 'active',
                source = EXCLUDED.source,
                raw_metadata = EXCLUDED.raw_metadata,
                last_seen_at = EXCLUDED.last_seen_at,
                last_checked_at = EXCLUDED.last_checked_at,
                unavailable_since = NULL,
                updated_at = EXCLUDED.updated_at
        `);
    }

    const existing = await getStoredProviderModels({
        provider: input.provider,
        scopeType: input.scopeType,
        scopeId,
        includeUnavailable: true,
    });
    const seen = new Set(deduped.keys());
    let stale = 0;
    let unavailable = 0;

    for (const record of existing) {
        if (seen.has(record.modelId) || record.status === "unavailable") continue;

        const nextStatus = calculateMissingProviderModelStatus({
            lastSeenAt: record.lastSeenAt,
            checkedAt,
            staleToUnavailableDays: input.staleToUnavailableDays,
        });
        if (nextStatus === "unavailable") unavailable += 1;
        else stale += 1;

        await db.$executeRaw(Prisma.sql`
            UPDATE ai_provider_models
            SET
                status = ${nextStatus},
                last_checked_at = ${checkedAt},
                unavailable_since = CASE
                    WHEN ${nextStatus} = 'unavailable' THEN COALESCE(unavailable_since, ${checkedAt})
                    ELSE unavailable_since
                END,
                updated_at = ${checkedAt}
            WHERE id = ${record.id}
        `);
    }

    return {
        provider: input.provider,
        scopeType: input.scopeType,
        scopeId,
        discovered: deduped.size,
        activated: deduped.size,
        stale,
        unavailable,
    };
}

export async function resolveProviderModelForTask(input: {
    provider: AiProviderModelProvider;
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    taskId: AiTaskId;
    requestedModel?: string | null;
    fallbackModels?: ModelOption[];
}): Promise<ResolvedProviderModel | null> {
    const requested = String(input.requestedModel || "").trim();
    const records = await getStoredProviderModels({
        provider: input.provider,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        includeUnavailable: true,
    });

    const active = records.filter((record) => record.status === "active");
    const requestedRecord = requested
        ? records.find((record) => record.modelId === requested)
        : null;
    if (requestedRecord?.status === "active" && storedModelSupportsTask(requestedRecord, input.taskId)) {
        return {
            modelId: requestedRecord.modelId,
            provider: requestedRecord.provider,
            status: requestedRecord.status,
            capabilities: requestedRecord.capabilities,
        };
    }

    const fallbackRecord = active.find((record) => storedModelSupportsTask(record, input.taskId));
    if (fallbackRecord) {
        return {
            modelId: fallbackRecord.modelId,
            provider: fallbackRecord.provider,
            status: fallbackRecord.status,
            capabilities: fallbackRecord.capabilities,
            fallbackReason: requested
                ? `Requested model ${requested} is unavailable or incompatible.`
                : undefined,
        };
    }

    const fallbackOption = (input.fallbackModels || []).find((model) => modelSupportsTask(model, input.taskId));
    if (fallbackOption) {
        return {
            modelId: fallbackOption.value,
            provider: input.provider,
            status: "active",
            capabilities: getModelCapabilities(fallbackOption),
            fallbackReason: "Using curated fallback because no active provider catalog models are stored.",
        };
    }

    return null;
}
