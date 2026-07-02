"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiModelOption } from "@/components/ai/use-ai-model-catalog";

const STORAGE_PREFIX = "estio.aiModelSelection.v1";

function storageKeyForUsage(usageKey: string) {
    return `${STORAGE_PREFIX}.${usageKey}`;
}

function readStoredModel(usageKey: string): string {
    if (typeof window === "undefined") return "";
    try {
        return String(window.localStorage.getItem(storageKeyForUsage(usageKey)) || "").trim();
    } catch {
        return "";
    }
}

function writeStoredModel(usageKey: string, model: string) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(storageKeyForUsage(usageKey), model);
    } catch {
        // Local storage can be blocked in private or embedded browser contexts.
    }
}

export function usePersistentAiModelSelection({
    usageKey,
    models,
    defaultModel,
}: {
    usageKey: string;
    models: AiModelOption[];
    defaultModel: string;
}) {
    const [selectedModel, setSelectedModel] = useState(() => String(defaultModel || "").trim());
    const [hasUserSelectedModel, setHasUserSelectedModel] = useState(false);
    const hasUserSelectedModelRef = useRef(false);

    const modelValues = useMemo(() => new Set(models.map((model) => model.value)), [models]);

    useEffect(() => {
        if (hasUserSelectedModelRef.current) return;

        const storedModel = readStoredModel(usageKey);
        if (storedModel && modelValues.has(storedModel)) {
            hasUserSelectedModelRef.current = true;
            setHasUserSelectedModel(true);
            setSelectedModel(storedModel);
            return;
        }

        const normalizedDefault = String(defaultModel || "").trim();
        if (normalizedDefault) {
            setSelectedModel(normalizedDefault);
        }
    }, [defaultModel, modelValues, usageKey]);

    const handleModelChange = useCallback((model: string) => {
        const normalizedModel = String(model || "").trim();
        hasUserSelectedModelRef.current = true;
        setHasUserSelectedModel(true);
        setSelectedModel(normalizedModel);
        if (normalizedModel) writeStoredModel(usageKey, normalizedModel);
    }, [usageKey]);

    return {
        selectedModel,
        setSelectedModel,
        hasUserSelectedModel,
        setHasUserSelectedModel,
        hasUserSelectedModelRef,
        handleModelChange,
    };
}
