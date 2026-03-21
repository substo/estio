'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAiModelPickerDefaultsAction } from "@/app/(main)/admin/conversations/actions";

export type AiModelOption = {
    value: string;
    label: string;
    description?: string;
};

export type AiModelDefaults = {
    general: string;
    draft: string;
    extraction: string;
    design: string;
};

const EMPTY_DEFAULTS: AiModelDefaults = {
    general: "",
    draft: "",
    extraction: "",
    design: "",
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

function normalizeDefaults(value: unknown): AiModelDefaults {
    if (!value || typeof value !== "object") return { ...EMPTY_DEFAULTS };
    const source = value as Record<string, unknown>;

    return {
        general: String(source.general || "").trim(),
        draft: String(source.draft || "").trim(),
        extraction: String(source.extraction || "").trim(),
        design: String(source.design || "").trim(),
    };
}

export function useAiModelCatalog() {
    const [models, setModels] = useState<AiModelOption[]>([]);
    const [defaults, setDefaults] = useState<AiModelDefaults>({ ...EMPTY_DEFAULTS });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const payload = await getAiModelPickerDefaultsAction();
                if (cancelled) return;

                const normalizedModels = Array.isArray(payload?.models)
                    ? payload.models
                        .map((item) => normalizeModelOption(item))
                        .filter((item): item is AiModelOption => !!item)
                    : [];

                setModels(normalizedModels);
                setDefaults(normalizeDefaults(payload?.defaults));
            } catch (error) {
                if (cancelled) return;
                console.error("Failed to load AI model catalog:", error);
                setModels([]);
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

    const modelValues = useMemo(() => new Set(models.map((model) => model.value)), [models]);

    const resolveModelForKind = useCallback((
        kind: keyof AiModelDefaults,
        fallbackModel?: string | null
    ) => {
        const preferred = String(defaults[kind] || "").trim();
        if (preferred && modelValues.has(preferred)) return preferred;

        const fallback = String(fallbackModel || "").trim();
        if (fallback && modelValues.has(fallback)) return fallback;

        return models[0]?.value || "";
    }, [defaults, modelValues, models]);

    return {
        models,
        defaults,
        loading,
        resolveModelForKind,
    };
}
