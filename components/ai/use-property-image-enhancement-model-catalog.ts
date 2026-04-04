'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { getPropertyImageEnhancementModelCatalogAction } from "@/app/(main)/admin/conversations/actions";
import type { AiModelOption } from "@/components/ai/use-ai-model-catalog";

type PropertyImageEnhancementModelDefaults = {
    analysis: string;
    generation: string;
};

const EMPTY_DEFAULTS: PropertyImageEnhancementModelDefaults = {
    analysis: "",
    generation: "",
};

function normalizeModelOption(value: unknown): AiModelOption | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const modelValue = String(source.value || "").trim();
    if (!modelValue) return null;

    const label = String(source.label || "").trim() || modelValue;
    const descriptionRaw = String(source.description || "").trim();
    return {
        value: modelValue,
        label,
        description: descriptionRaw || undefined,
    };
}

function normalizeDefaults(value: unknown): PropertyImageEnhancementModelDefaults {
    if (!value || typeof value !== "object") return { ...EMPTY_DEFAULTS };
    const source = value as Record<string, unknown>;

    return {
        analysis: String(source.analysis || "").trim(),
        generation: String(source.generation || "").trim(),
    };
}

export function usePropertyImageEnhancementModelCatalog() {
    const [analysisModels, setAnalysisModels] = useState<AiModelOption[]>([]);
    const [generationModels, setGenerationModels] = useState<AiModelOption[]>([]);
    const [defaults, setDefaults] = useState<PropertyImageEnhancementModelDefaults>({ ...EMPTY_DEFAULTS });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const payload = await getPropertyImageEnhancementModelCatalogAction();
                if (cancelled) return;

                const normalizedAnalysis = Array.isArray(payload?.analysisModels)
                    ? payload.analysisModels
                        .map((item) => normalizeModelOption(item))
                        .filter((item): item is AiModelOption => !!item)
                    : [];
                const normalizedGeneration = Array.isArray(payload?.generationModels)
                    ? payload.generationModels
                        .map((item) => normalizeModelOption(item))
                        .filter((item): item is AiModelOption => !!item)
                    : [];

                setAnalysisModels(normalizedAnalysis);
                setGenerationModels(normalizedGeneration);
                setDefaults(normalizeDefaults(payload?.defaults));
            } catch (error) {
                if (cancelled) return;
                console.error("Failed to load property image enhancement model catalog:", error);
                setAnalysisModels([]);
                setGenerationModels([]);
                setDefaults({ ...EMPTY_DEFAULTS });
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const modelMap = useMemo(() => {
        const entries = [...analysisModels, ...generationModels].map((model) => [model.value, model] as const);
        return new Map(entries);
    }, [analysisModels, generationModels]);

    const getModelLabel = useCallback((value: string | null | undefined) => {
        const normalized = String(value || "").trim();
        if (!normalized) return "";
        return modelMap.get(normalized)?.label || normalized;
    }, [modelMap]);

    return {
        analysisModels,
        generationModels,
        defaults,
        loading,
        getModelLabel,
    };
}
