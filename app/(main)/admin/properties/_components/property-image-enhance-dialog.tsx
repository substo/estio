"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Edit2, Plus } from "lucide-react";
import { toast } from "sonner";
import { AiModelSelect } from "@/components/ai/ai-model-select";
import { usePropertyImageEnhancementModelCatalog } from "@/components/ai/use-property-image-enhancement-model-catalog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import type {
    EnhancementAggression,
    EnhancementMode,
    ImageEnhancementAnalysis,
    ImageEnhancementGeneratedResult,
    PropertyImagePromptProfile,
    PropertyImagePromptProfileUpsert,
    PropertyImageRoomType,
} from "@/lib/ai/property-image-enhancement-types";
import { resolvePromptProfileContext, resolvePromptProfileAnalysisData } from "@/lib/ai/property-image-prompt-profiles";
import { buildGenerationPrompt } from "@/lib/ai/property-image-enhancement-prompt";
import {
    readPropertyImageEnhancementModelPreference,
    resolvePreferredPropertyImageEnhancementModel,
    writePropertyImageEnhancementModelPreference,
    type PropertyImageEnhancementModelPreference,
} from "@/lib/ai/property-image-enhancement-model-preferences";
import {
    PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY,
    PROPERTY_IMAGE_ROOM_TYPE_PREDICTION_MIN_CONFIDENCE,
    PROPERTY_IMAGE_ROOM_TYPE_PRESETS,
    PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY,
    normalizePropertyImageRoomTypeKey,
    normalizePropertyImageRoomTypeLabel,
    resolvePropertyImageRoomType,
    toRoomTypeSelectValue,
} from "@/lib/ai/property-image-room-types";
import {
    PROPERTY_IMAGE_AI_APPLY_MODES,
    type PropertyImageAiApplyMode,
} from "@/lib/properties/property-media-ai";
import { PRECISION_REMOVE_SMART_PRESETS } from "@/lib/ai/property-image-semantic-mask-classes";
import {
    PropertyImageCompareViewer,
} from "./property-image-compare-viewer";
import {
    PropertyImageMaskEditor,
    type PrecisionMaskEditorHandle,
    type PrecisionMaskSelectableRegion,
    type PrecisionMaskEditorState,
    type PrecisionMaskSnapshot,
    type PrecisionMaskTool,
} from "./property-image-mask-editor";

interface PropertyImageLike {
    url: string;
    cloudflareImageId?: string | null;
    kind: string;
    sortOrder: number;
    metadata?: unknown;
}

interface GeneratedVariantPayload {
    url: string;
    cloudflareImageId: string;
    applyMode: PropertyImageAiApplyMode;
    promptProfileUpsert?: PropertyImagePromptProfileUpsert;
}

interface PropertyImageEnhanceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
    propertyId?: string;
    image: PropertyImageLike | null;
    imageIndex: number;
    roomPromptProfiles?: PropertyImagePromptProfile[];
    precisionRemoveEnabled?: boolean;
    onApplyVariant: (payload: GeneratedVariantPayload) => void;
}

interface AnalyzeApiResponse {
    success: true;
    analysis: ImageEnhancementAnalysis;
    model: string;
}

interface GenerateApiResponse {
    success: true;
    generatedImageId: string;
    generatedImageUrl: string;
    actionLog: string[];
    finalPrompt: string;
    reusablePrompt: string;
    model: string;
}

interface PrecisionRemoveApiResponse {
    success: true;
    generatedImageId: string;
    generatedImageUrl: string;
    actionLog: string[];
    model: string;
    maskCoverage?: number;
}

type PrecisionRemoveMaskMode = "user_provided" | "background" | "foreground" | "semantic";

type PrecisionRemoveRunOptions = {
    maskMode?: PrecisionRemoveMaskMode;
    snapshot?: PrecisionMaskSnapshot | null;
    semanticMaskClassIds?: number[];
    generationModel?: string;
};

interface RoomTypePredictApiResponse {
    success: true;
    suggestedRoomType: PropertyImageRoomType;
    candidates: PropertyImageRoomType[];
    model: string;
}

const EMPTY_PRECISION_EDITOR_STATE: PrecisionMaskEditorState = {
    isReady: false,
    canUndo: false,
    canRedo: false,
    hasMask: false,
    maskCoverage: 0,
    editorWidth: 0,
    editorHeight: 0,
    naturalWidth: 0,
    naturalHeight: 0,
};

const EMPTY_MODEL_PREFERENCE: PropertyImageEnhancementModelPreference = {
    analysis: "",
    generation: "",
};

function resolvePrecisionSelectableRegions(analysis: ImageEnhancementAnalysis | null): PrecisionMaskSelectableRegion[] {
    if (!analysis) return [];

    return analysis.detectedElements
        .filter((element) => (
            element.bbox
            && Number.isFinite(element.bbox.x)
            && Number.isFinite(element.bbox.y)
            && Number.isFinite(element.bbox.width)
            && Number.isFinite(element.bbox.height)
            && element.bbox.width > 0
            && element.bbox.height > 0
        ))
        .map((element) => ({
            id: element.id,
            label: element.label,
            confidence: Number(element.confidence || 0),
            bbox: {
                x: element.bbox!.x,
                y: element.bbox!.y,
                width: element.bbox!.width,
                height: element.bbox!.height,
            },
        }));
}

export function PropertyImageEnhanceDialog({
    open,
    onOpenChange,
    locationId,
    propertyId,
    image,
    imageIndex,
    roomPromptProfiles = [],
    precisionRemoveEnabled = false,
    onApplyVariant,
}: PropertyImageEnhanceDialogProps) {
    const precisionEditorRef = useRef<PrecisionMaskEditorHandle | null>(null);
    const analysisModelTouchedRef = useRef(false);
    const generationModelTouchedRef = useRef(false);
    const roomTypePredictionRequestRef = useRef("");
    const {
        analysisModels,
        generationModels,
        defaults: modelDefaults,
        loading: modelCatalogLoading,
        getModelLabel,
    } = usePropertyImageEnhancementModelCatalog();
    const [mode, setMode] = useState<EnhancementMode>("polish");
    const [analysis, setAnalysis] = useState<ImageEnhancementAnalysis | null>(null);
    const [selectedFixIds, setSelectedFixIds] = useState<string[]>([]);
    const [removedDetectedElementIds, setRemovedDetectedElementIds] = useState<string[]>([]);
    const [aggression, setAggression] = useState<EnhancementAggression>("balanced");
    const [roomTypeSelectValue, setRoomTypeSelectValue] = useState(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
    const [customRoomTypeLabel, setCustomRoomTypeLabel] = useState("");
    const [reuseSavedRoomPrompt, setReuseSavedRoomPrompt] = useState(false);
    const [isPredictingRoomType, setIsPredictingRoomType] = useState(false);
    const [roomTypePrediction, setRoomTypePrediction] = useState<PropertyImageRoomType | null>(null);
    const [roomTypeCandidates, setRoomTypeCandidates] = useState<PropertyImageRoomType[]>([]);
    const [roomTypePredictionModel, setRoomTypePredictionModel] = useState<string | null>(null);
    const [userInstructions, setUserInstructions] = useState("");
    const [selectedAnalysisModel, setSelectedAnalysisModel] = useState("");
    const [selectedGenerationModel, setSelectedGenerationModel] = useState("");
    const [persistedModelPreference, setPersistedModelPreference] = useState<PropertyImageEnhancementModelPreference>(EMPTY_MODEL_PREFERENCE);
    const [usedAnalysisModel, setUsedAnalysisModel] = useState<string | null>(null);
    const [showAnalysisSettings, setShowAnalysisSettings] = useState(true);
    const [precisionTool, setPrecisionTool] = useState<PrecisionMaskTool>("brush");
    const [precisionBrushSize, setPrecisionBrushSize] = useState(36);
    const [precisionEraseMode, setPrecisionEraseMode] = useState(false);
    const [precisionGuidance, setPrecisionGuidance] = useState("");
    const [precisionClickSelectEnabled, setPrecisionClickSelectEnabled] = useState(false);
    const [precisionSelectableRegions, setPrecisionSelectableRegions] = useState<PrecisionMaskSelectableRegion[]>([]);
    const [isDetectingPrecisionObjects, setIsDetectingPrecisionObjects] = useState(false);
    const [precisionEditorState, setPrecisionEditorState] = useState<PrecisionMaskEditorState>(EMPTY_PRECISION_EDITOR_STATE);
    const [lastPrecisionRequest, setLastPrecisionRequest] = useState<PrecisionRemoveRunOptions | null>(null);
    const [selectedApplyMode, setSelectedApplyMode] = useState<PropertyImageAiApplyMode | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generated, setGenerated] = useState<ImageEnhancementGeneratedResult | null>(null);
    const [editingFixId, setEditingFixId] = useState<string | null>(null);
    const [editingFixLabel, setEditingFixLabel] = useState("");
    const [isAddingFix, setIsAddingFix] = useState(false);
    const [newFixLabel, setNewFixLabel] = useState("");

    const canRun = useMemo(() => {
        if (!propertyId) return false;
        if (!image) return false;
        return Boolean(image.cloudflareImageId || image.url);
    }, [propertyId, image]);
    const selectedRoomType = useMemo(() => {
        if (roomTypeSelectValue === PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY) {
            const normalizedCustomLabel = normalizePropertyImageRoomTypeLabel(customRoomTypeLabel);
            const normalizedCustomKey = normalizePropertyImageRoomTypeKey(normalizedCustomLabel);
            return resolvePropertyImageRoomType({
                key: normalizedCustomKey,
                label: normalizedCustomLabel,
            });
        }

        return resolvePropertyImageRoomType({
            key: roomTypeSelectValue,
        });
    }, [roomTypeSelectValue, customRoomTypeLabel]);
    const selectedRoomPrompt = useMemo(() => (
        resolvePromptProfileContext({
            profiles: roomPromptProfiles,
            roomTypeKey: selectedRoomType.key,
        })
    ), [roomPromptProfiles, selectedRoomType.key]);
    const hasSelectedRoomPrompt = Boolean(String(selectedRoomPrompt || "").trim());
    const effectivePriorPrompt = reuseSavedRoomPrompt && hasSelectedRoomPrompt ? selectedRoomPrompt : undefined;

    const selectedRoomAnalysis = useMemo(() => (
        resolvePromptProfileAnalysisData({
            profiles: roomPromptProfiles,
            roomTypeKey: selectedRoomType.key,
        })
    ), [roomPromptProfiles, selectedRoomType.key]);

    const effectiveAnalysis = useMemo(() => {
        if (analysis) return analysis;
        if (effectivePriorPrompt) {
            if (selectedRoomAnalysis) {
                return selectedRoomAnalysis;
            }
            return {
                sceneSummary: "Reusing saved room profile prompt.",
                sceneContext: effectivePriorPrompt,
                detectedElements: [],
                suggestedFixes: [],
                actionLogDraft: [],
            } as ImageEnhancementAnalysis;
        }
        return null;
    }, [analysis, effectivePriorPrompt, selectedRoomAnalysis]);

    const stage = generated ? "review" : "edit";
    const isBusy = isAnalyzing || isGenerating || isRemoving || isDetectingPrecisionObjects;
    const liveFinalPrompt = useMemo(() => {
        if (!effectiveAnalysis) return "";
        return buildGenerationPrompt({
            analysis: effectiveAnalysis,
            selectedFixIds,
            removedDetectedElementIds,
            aggression,
            priorPrompt: effectivePriorPrompt,
            userInstructions,
        });
    }, [effectiveAnalysis, selectedFixIds, removedDetectedElementIds, aggression, effectivePriorPrompt, userInstructions]);

    useEffect(() => {
        if (!open) {
            setMode("polish");
            setAnalysis(null);
            setSelectedFixIds([]);
            setRemovedDetectedElementIds([]);
            setAggression("balanced");
            setRoomTypeSelectValue(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
            setCustomRoomTypeLabel("");
            setReuseSavedRoomPrompt(false);
            setIsPredictingRoomType(false);
            setRoomTypePrediction(null);
            setRoomTypeCandidates([]);
            setRoomTypePredictionModel(null);
            roomTypePredictionRequestRef.current = "";
            setUserInstructions("");
            analysisModelTouchedRef.current = false;
            generationModelTouchedRef.current = false;
            setUsedAnalysisModel(null);
            setShowAnalysisSettings(true);
            setPrecisionTool("brush");
            setPrecisionBrushSize(36);
            setPrecisionEraseMode(false);
            setPrecisionGuidance("");
            setPrecisionClickSelectEnabled(false);
            setPrecisionSelectableRegions([]);
            setIsDetectingPrecisionObjects(false);
            setPrecisionEditorState(EMPTY_PRECISION_EDITOR_STATE);
            setLastPrecisionRequest(null);
            setSelectedApplyMode(null);
            setIsAnalyzing(false);
            setIsGenerating(false);
            setIsRemoving(false);
            setError(null);
            setGenerated(null);
            setEditingFixId(null);
            setEditingFixLabel("");
            setIsAddingFix(false);
            setNewFixLabel("");
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        setPrecisionSelectableRegions([]);
        setPrecisionClickSelectEnabled(false);
    }, [open, image?.cloudflareImageId, image?.url]);

    useEffect(() => {
        if (!open) return;
        if (!hasSelectedRoomPrompt) {
            setReuseSavedRoomPrompt(false);
        } else {
            setReuseSavedRoomPrompt(true);
            if (selectedRoomAnalysis) {
                const defaultFixes = selectedRoomAnalysis.suggestedFixes
                    .filter((f) => f.defaultSelected)
                    .map((f) => f.id);
                setSelectedFixIds(defaultFixes);
            }
        }
        // intentionally omitting reuseSavedRoomPrompt to allow manual overrides without resetting
    }, [open, hasSelectedRoomPrompt, selectedRoomType.key, selectedRoomAnalysis]);

    useEffect(() => {
        if (!open) return;
        setPersistedModelPreference(readPropertyImageEnhancementModelPreference(locationId));
    }, [open, locationId]);

    useEffect(() => {
        if (!open) return;
        const next = resolvePreferredPropertyImageEnhancementModel({
            allowedValues: analysisModels.map((model) => model.value),
            currentValue: analysisModelTouchedRef.current ? selectedAnalysisModel : "",
            persistedValue: persistedModelPreference.analysis,
            defaultValue: modelDefaults.analysis,
            fallbackValue: analysisModels[0]?.value,
        });
        if (next !== selectedAnalysisModel) {
            setSelectedAnalysisModel(next);
        }
    }, [
        open,
        analysisModels,
        modelDefaults.analysis,
        persistedModelPreference.analysis,
        selectedAnalysisModel,
    ]);

    useEffect(() => {
        if (!open) return;
        const next = resolvePreferredPropertyImageEnhancementModel({
            allowedValues: generationModels.map((model) => model.value),
            currentValue: generationModelTouchedRef.current ? selectedGenerationModel : "",
            persistedValue: persistedModelPreference.generation,
            defaultValue: modelDefaults.generation,
            fallbackValue: generationModels[0]?.value,
        });
        if (next !== selectedGenerationModel) {
            setSelectedGenerationModel(next);
        }
    }, [
        open,
        generationModels,
        modelDefaults.generation,
        persistedModelPreference.generation,
        selectedGenerationModel,
    ]);

    useEffect(() => {
        if (!open || !canRun || !propertyId || !image) return;
        if (mode !== "polish") return;

        const sourceIdentity = String(image.cloudflareImageId || image.url || "").trim();
        const requestKey = `${propertyId}:${sourceIdentity}`;
        if (!requestKey || roomTypePredictionRequestRef.current === requestKey) return;
        roomTypePredictionRequestRef.current = requestKey;

        let cancelled = false;
        setIsPredictingRoomType(true);
        setRoomTypePrediction(null);
        setRoomTypeCandidates([]);
        setRoomTypePredictionModel(null);

        (async () => {
            try {
                const response = await fetch("/api/images/enhance/room-type/predict", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        locationId,
                        propertyId,
                        cloudflareImageId: image.cloudflareImageId,
                        sourceUrl: image.url,
                        analysisModel: selectedAnalysisModel || undefined,
                    }),
                });

                const json = await response.json().catch(() => null);
                if (!response.ok) {
                    throw new Error(String(json?.error || "Failed to predict room type."));
                }

                const payload = json as RoomTypePredictApiResponse;
                const suggested = resolvePropertyImageRoomType(payload.suggestedRoomType);
                const candidates = (Array.isArray(payload.candidates) ? payload.candidates : [])
                    .map((candidate) => resolvePropertyImageRoomType(candidate))
                    .slice(0, 5);
                const isConfident = Number(suggested.confidence || 0) >= PROPERTY_IMAGE_ROOM_TYPE_PREDICTION_MIN_CONFIDENCE;

                if (cancelled) return;
                setRoomTypePrediction(suggested);
                setRoomTypeCandidates(candidates);
                setRoomTypePredictionModel(payload.model || null);

                if (isConfident) {
                    const nextSelectValue = toRoomTypeSelectValue(suggested.key);
                    setRoomTypeSelectValue(nextSelectValue);
                    setCustomRoomTypeLabel(nextSelectValue === PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY ? suggested.label : "");
                    return;
                }

                setRoomTypeSelectValue(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
                setCustomRoomTypeLabel("");
            } catch (err) {
                if (cancelled) return;
                console.error("[PropertyImageEnhanceDialog] room type prediction error:", err);
                setRoomTypeSelectValue(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
                setCustomRoomTypeLabel("");
            } finally {
                if (!cancelled) {
                    setIsPredictingRoomType(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        open,
        canRun,
        propertyId,
        image,
        mode,
        locationId,
        selectedAnalysisModel,
    ]);

    useEffect(() => {
        if (!open) return;
        if (!analysisModelTouchedRef.current && !generationModelTouchedRef.current) return;

        const next = writePropertyImageEnhancementModelPreference(locationId, {
            analysis: selectedAnalysisModel,
            generation: selectedGenerationModel,
        });
        setPersistedModelPreference(next);
    }, [open, locationId, selectedAnalysisModel, selectedGenerationModel]);

    useEffect(() => {
        if (!open) return;
        const regions = resolvePrecisionSelectableRegions(effectiveAnalysis);
        if (regions.length === 0) return;
        if (precisionSelectableRegions.length > 0) return;
        setPrecisionSelectableRegions(regions);
    }, [open, effectiveAnalysis, precisionSelectableRegions.length]);

    const handleAnalysisModelChange = (value: string) => {
        analysisModelTouchedRef.current = true;
        setSelectedAnalysisModel(value);
    };

    const handleGenerationModelChange = (value: string) => {
        generationModelTouchedRef.current = true;
        setSelectedGenerationModel(value);
    };

    const startEditingFix = (fixId: string, label: string) => {
        setEditingFixId(fixId);
        setEditingFixLabel(label);
    };

    const saveEditingFix = () => {
        const current = analysis || effectiveAnalysis;
        if (!editingFixId || !current) return;
        const normalized = editingFixLabel.trim();
        if (!normalized) {
            setEditingFixId(null);
            return;
        }

        setAnalysis({
            ...current,
            suggestedFixes: current.suggestedFixes.map((f) =>
                f.id === editingFixId ? { ...f, label: normalized, promptInstruction: normalized } : f
            ),
        });
        setEditingFixId(null);
    };

    const saveNewFix = () => {
        const current = analysis || effectiveAnalysis;
        if (!current) return;
        const normalized = newFixLabel.trim();
        if (!normalized) {
            setIsAddingFix(false);
            return;
        }

        const newFixId = `custom_${Date.now()}`;
        const newFix = {
            id: newFixId,
            label: normalized,
            description: "Custom user fix",
            impact: "high" as const,
            defaultSelected: true,
            promptInstruction: normalized,
        };

        setAnalysis({
            ...current,
            suggestedFixes: [...current.suggestedFixes, newFix],
        });
        setSelectedFixIds((prev) => [...prev, newFixId]);
        setIsAddingFix(false);
        setNewFixLabel("");
    };

    const toggleFix = (fixId: string) => {
        setSelectedFixIds((prev) => (
            prev.includes(fixId)
                ? prev.filter((id) => id !== fixId)
                : [...prev, fixId]
        ));
    };

    const toggleDetectedElementRemoval = (elementId: string) => {
        setRemovedDetectedElementIds((prev) => (
            prev.includes(elementId)
                ? prev.filter((id) => id !== elementId)
                : [...prev, elementId]
        ));
    };

    const handleRoomTypeSelectChange = (value: string) => {
        setRoomTypeSelectValue(value);
        if (value !== PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY) {
            setCustomRoomTypeLabel("");
        }
    };

    const handleCustomRoomTypeLabelChange = (value: string) => {
        setCustomRoomTypeLabel(value);
    };

    function handleModeChange(nextMode: EnhancementMode) {
        if (stage === "review") return;
        setMode(nextMode);
        setError(null);
    }

    async function handlePrecisionDetectSelectableObjects() {
        if (!canRun || !image || !propertyId) return;

        setError(null);
        setIsDetectingPrecisionObjects(true);

        try {
            const existingRegions = resolvePrecisionSelectableRegions(effectiveAnalysis);
            if (existingRegions.length > 0) {
                setPrecisionSelectableRegions(existingRegions);
                setPrecisionClickSelectEnabled(true);
                toast.success(`Loaded ${existingRegions.length} selectable objects from current analysis.`);
                return;
            }

            const response = await fetch("/api/images/enhance/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId,
                    propertyId,
                    cloudflareImageId: image.cloudflareImageId,
                    sourceUrl: image.url,
                    analysisModel: selectedAnalysisModel || undefined,
                    priorPrompt: effectivePriorPrompt,
                    userInstructions: userInstructions.trim() || undefined,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to detect selectable objects."));
            }

            const payload = json as AnalyzeApiResponse;
            const regions = resolvePrecisionSelectableRegions(payload.analysis);
            if (regions.length === 0) {
                throw new Error("No selectable objects were detected for click selection.");
            }

            setPrecisionSelectableRegions(regions);
            setPrecisionClickSelectEnabled(true);
            toast.success(`Detected ${regions.length} selectable objects.`);
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] precision detect objects error:", err);
            const message = err instanceof Error ? err.message : "Failed to detect selectable objects.";
            setError(message);
            toast.error(message);
        } finally {
            setIsDetectingPrecisionObjects(false);
        }
    }

    async function handleAnalyze() {
        if (!canRun || !image || !propertyId) return;
        if (!selectedAnalysisModel.trim()) {
            const message = "Choose an analysis model before running photo analysis.";
            setError(message);
            toast.error(message);
            return;
        }

        setError(null);
        setGenerated(null);
        setIsAnalyzing(true);

        try {
            const response = await fetch("/api/images/enhance/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId,
                    propertyId,
                    cloudflareImageId: image.cloudflareImageId,
                    sourceUrl: image.url,
                    analysisModel: selectedAnalysisModel,
                    priorPrompt: effectivePriorPrompt,
                    userInstructions,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to analyze image."));
            }

            const payload = json as AnalyzeApiResponse;
            
            // Merge with previously preserved fixes if reusing prompt to retain old custom chips
            if (effectiveAnalysis && effectiveAnalysis.suggestedFixes.length > 0) {
                const newFixes = payload.analysis.suggestedFixes;
                const mergedFixes = [...effectiveAnalysis.suggestedFixes];
                for (const n of newFixes) {
                    if (!mergedFixes.find(o => o.id === n.id)) {
                        mergedFixes.push(n);
                    }
                }
                payload.analysis.suggestedFixes = mergedFixes;
            }

            const defaults = payload.analysis.suggestedFixes
                .filter((item) => item.defaultSelected)
                .map((item) => item.id);

            setAnalysis(payload.analysis);
            setSelectedFixIds(defaults);
            setRemovedDetectedElementIds([]);
            setUsedAnalysisModel(payload.model);
            setShowAnalysisSettings(false);
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] analyze error:", err);
            const message = err instanceof Error ? err.message : "Failed to analyze image.";
            setError(message);
            toast.error(message);
        } finally {
            setIsAnalyzing(false);
        }
    }

    async function handleGenerate() {
        if (!canRun || !image || !propertyId || !effectiveAnalysis) return;
        if (!selectedGenerationModel.trim()) {
            const message = "Choose a generation model before creating the enhanced image.";
            setError(message);
            toast.error(message);
            return;
        }

        setError(null);
        setIsGenerating(true);

        try {
            const response = await fetch("/api/images/enhance/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId,
                    propertyId,
                    cloudflareImageId: image.cloudflareImageId,
                    sourceUrl: image.url,
                    analysis: effectiveAnalysis,
                    selectedFixIds,
                    removedDetectedElementIds,
                    aggression,
                    generationModel: selectedGenerationModel,
                    priorPrompt: effectivePriorPrompt,
                    userInstructions,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to generate enhanced image."));
            }

            const payload = json as GenerateApiResponse;
            setSelectedApplyMode(null);
            setGenerated({
                mode: "polish",
                generatedImageId: payload.generatedImageId,
                generatedImageUrl: payload.generatedImageUrl,
                actionLog: payload.actionLog,
                model: payload.model,
                finalPrompt: payload.finalPrompt,
                reusablePrompt: payload.reusablePrompt,
            });
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] generate error:", err);
            const message = err instanceof Error ? err.message : "Failed to generate enhanced image.";
            setError(message);
            toast.error(message);
        } finally {
            setIsGenerating(false);
        }
    }

    async function handlePrecisionRemove(options?: PrecisionRemoveRunOptions | null) {
        if (!canRun || !image || !propertyId) return;

        const maskMode: PrecisionRemoveMaskMode = options?.maskMode || "user_provided";
        const generationModel = String(options?.generationModel || selectedGenerationModel || "").trim();
        let snapshot = options?.snapshot || null;

        if (!generationModel) {
            const message = "Choose a generation model before removing content.";
            setError(message);
            toast.error(message);
            return;
        }

        if (maskMode === "user_provided") {
            snapshot = snapshot || await precisionEditorRef.current?.exportMask() || null;
            if (!snapshot) {
                const message = "Draw a mask before removing content.";
                setError(message);
                toast.error(message);
                return;
            }
        }

        setError(null);
        setIsRemoving(true);

        try {
            const editorWidth = snapshot?.editorWidth || precisionEditorState.editorWidth || undefined;
            const editorHeight = snapshot?.editorHeight || precisionEditorState.editorHeight || undefined;

            const response = await fetch("/api/images/enhance/precision-remove", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId,
                    propertyId,
                    cloudflareImageId: image.cloudflareImageId,
                    sourceUrl: image.url,
                    maskMode,
                    maskPngBase64: snapshot?.maskPngBase64,
                    editorWidth,
                    editorHeight,
                    semanticMaskClassIds: options?.semanticMaskClassIds,
                    guidance: precisionGuidance.trim() || undefined,
                    generationModel,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to remove selected content."));
            }

            const payload = json as PrecisionRemoveApiResponse;
            setLastPrecisionRequest({
                maskMode,
                snapshot,
                semanticMaskClassIds: options?.semanticMaskClassIds,
                generationModel,
            });
            setSelectedApplyMode(null);
            setGenerated({
                mode: "precision_remove",
                generatedImageId: payload.generatedImageId,
                generatedImageUrl: payload.generatedImageUrl,
                actionLog: payload.actionLog,
                model: payload.model,
                maskCoverage: payload.maskCoverage,
                reusablePrompt: "",
            });
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] precision remove error:", err);
            const message = err instanceof Error ? err.message : "Failed to remove selected content.";
            setError(message);
            toast.error(message);
        } finally {
            setIsRemoving(false);
        }
    }

    async function handleRegenerate() {
        if (!generated) return;

        if (generated.mode === "precision_remove") {
            await handlePrecisionRemove(lastPrecisionRequest);
            return;
        }

        await handleGenerate();
    }

    function handleBackToEdit() {
        setGenerated(null);
        setSelectedApplyMode(null);
        setError(null);
    }

    function handleApplyVariant() {
        if (!generated || !selectedApplyMode) return;
        if (generated.mode === "polish" && selectedRoomType.key === PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY) {
            const message = "Choose a room type before keeping this result so prompt memory can be saved.";
            setError(message);
            toast.error(message);
            return;
        }

        const promptProfileUpsert = (
            generated.mode === "polish"
            && selectedRoomType.key !== PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY
            && String(generated.reusablePrompt || "").trim()
        ) ? {
            roomTypeKey: selectedRoomType.key,
            roomTypeLabel: selectedRoomType.label,
            promptContext: String(generated.reusablePrompt || "").trim(),
            analysisData: effectiveAnalysis ? {
                ...effectiveAnalysis,
                suggestedFixes: effectiveAnalysis.suggestedFixes.map(f => ({
                    ...f,
                    defaultSelected: selectedFixIds.includes(f.id)
                }))
            } : undefined,
        } : undefined;

        onApplyVariant({
            url: generated.generatedImageUrl,
            cloudflareImageId: generated.generatedImageId,
            applyMode: selectedApplyMode,
            promptProfileUpsert,
        });
        toast.success("Enhanced image added. Click Save Property to persist.");
        onOpenChange(false);
    }

    function handleApplyPrecisionIterationAndContinue() {
        if (!generated || generated.mode !== "precision_remove") return;

        onApplyVariant({
            url: generated.generatedImageUrl,
            cloudflareImageId: generated.generatedImageId,
            applyMode: "replace_original",
        });
        toast.success("Iteration applied. Continue masking additional objects.");
        setGenerated(null);
        setSelectedApplyMode(null);
        setLastPrecisionRequest(null);
        setError(null);
    }

    function renderModeSwitcher() {
        if (!precisionRemoveEnabled) return null;

        return (
            <div className="space-y-2">
                <Label className="text-sm font-medium">Mode</Label>
                <div className="grid grid-cols-2 gap-2">
                    {[
                        { value: "polish", label: "Polish" },
                        { value: "precision_remove", label: "Precision Remove" },
                    ].map((option) => {
                        const active = mode === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={stage === "review"}
                                onClick={() => handleModeChange(option.value as EnhancementMode)}
                                className={cn(
                                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                                    active
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-background hover:bg-muted",
                                    stage === "review" ? "cursor-not-allowed opacity-60" : ""
                                )}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    function renderRoomTypeSelector() {
        return (
            <div className="space-y-2">
                <Label className="text-sm font-medium">Room Type</Label>
                <Select value={roomTypeSelectValue} onValueChange={handleRoomTypeSelectChange}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select room type" />
                    </SelectTrigger>
                    <SelectContent>
                        {PROPERTY_IMAGE_ROOM_TYPE_PRESETS.map((preset) => (
                            <SelectItem key={preset.key} value={preset.key}>
                                {preset.label}
                            </SelectItem>
                        ))}
                        <SelectItem value={PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY}>Custom...</SelectItem>
                    </SelectContent>
                </Select>

                {roomTypeSelectValue === PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY ? (
                    <Input
                        value={customRoomTypeLabel}
                        onChange={(event) => handleCustomRoomTypeLabelChange(event.target.value)}
                        placeholder="Example: Outdoor Barbecue Area"
                    />
                ) : null}

                {isPredictingRoomType ? (
                    <p className="text-xs text-muted-foreground">Detecting room type from the source image...</p>
                ) : roomTypePrediction ? (
                    <p className="text-xs text-muted-foreground">
                        Suggested: {roomTypePrediction.label} ({Math.round(Number(roomTypePrediction.confidence || 0) * 100)}%)
                        {Number(roomTypePrediction.confidence || 0) < PROPERTY_IMAGE_ROOM_TYPE_PREDICTION_MIN_CONFIDENCE
                            ? " — confidence is low, so room type defaults to Unclassified."
                            : ""}
                    </p>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Room type helps load and evolve prompt memory for similar images.
                    </p>
                )}

                {roomTypeCandidates.length > 1 ? (
                    <p className="text-xs text-muted-foreground">
                        Top candidates: {roomTypeCandidates.slice(0, 3).map((candidate) => candidate.label).join(", ")}
                    </p>
                ) : null}

                {roomTypePredictionModel ? (
                    <p className="text-xs text-muted-foreground">
                        Prediction model: {getModelLabel(roomTypePredictionModel)}
                    </p>
                ) : null}
            </div>
        );
    }

    function renderPolishControls() {
        return (
            <>
                <div className="space-y-3 rounded-md border p-3">
                    {renderRoomTypeSelector()}

                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label className="text-sm font-medium">Use Saved Room Profile Prompt</Label>
                            <p className="text-xs text-muted-foreground">
                                {hasSelectedRoomPrompt
                                    ? "Reuses the saved approved prompt for this room type during analysis and generation."
                                    : "No saved prompt exists for this room type yet."}
                            </p>
                        </div>
                        <Switch
                            checked={reuseSavedRoomPrompt}
                            onCheckedChange={setReuseSavedRoomPrompt}
                            disabled={!hasSelectedRoomPrompt}
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Additional Instructions / Override</Label>
                    <Textarea
                        value={userInstructions}
                        onChange={(event) => setUserInstructions(event.target.value)}
                        placeholder="Example: Remove the two people near the pool, keep the pool shape and terrace exactly the same, and preserve the natural sky."
                        className="min-h-[110px] text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                        Use this when analysis misses something. Your notes are sent to both analysis and generation.
                    </p>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Label className="text-sm font-medium">Step 1. Analyze</Label>
                            <p className="text-xs text-muted-foreground">
                                Use a structured vision model to identify issues and prepare fix chips.
                            </p>
                        </div>
                        {analysis ? <Badge variant="outline">Complete</Badge> : null}
                    </div>

                    {analysis && !showAnalysisSettings ? (
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                                Last analysis model: {getModelLabel(usedAnalysisModel || selectedAnalysisModel)}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShowAnalysisSettings(true)}
                                disabled={isBusy}
                            >
                                Change Analysis Model
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Analysis Model</Label>
                                <AiModelSelect
                                    value={selectedAnalysisModel}
                                    models={analysisModels}
                                    onValueChange={handleAnalysisModelChange}
                                    disabled={isBusy || modelCatalogLoading}
                                    placeholder={modelCatalogLoading ? "Loading models..." : "Select analysis model"}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Only models compatible with structured image analysis are shown here.
                                </p>
                            </div>

                            {analysisModels.length === 0 && !modelCatalogLoading ? (
                                <p className="text-xs text-amber-700">
                                    No compatible analysis models are available for this location&apos;s Google AI key.
                                </p>
                            ) : null}

                            <Button
                                type="button"
                                onClick={handleAnalyze}
                                disabled={isBusy || modelCatalogLoading || analysisModels.length === 0 || !selectedAnalysisModel}
                            >
                                {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {analysis ? "Re-analyze Photo" : "Analyze Photo"}
                            </Button>
                        </div>
                    )}
                </div>

                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Label className="text-sm font-medium">Step 2. Generate</Label>
                            <p className="text-xs text-muted-foreground">
                                Choose an image-editing model and create the listing-ready result.
                            </p>
                        </div>
                        {effectiveAnalysis ? <Badge variant="secondary">Ready</Badge> : null}
                    </div>

                    {!effectiveAnalysis ? (
                        <p className="text-xs text-muted-foreground">
                            Run analysis or use a saved room profile prompt so the next step has context to work from.
                        </p>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Generation Model</Label>
                                <AiModelSelect
                                    value={selectedGenerationModel}
                                    models={generationModels}
                                    onValueChange={handleGenerationModelChange}
                                    disabled={isBusy || modelCatalogLoading}
                                    placeholder={modelCatalogLoading ? "Loading models..." : "Select generation model"}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Only models that look capable of returning edited images are shown here.
                                </p>
                            </div>

                            {generationModels.length === 0 && !modelCatalogLoading ? (
                                <p className="text-xs text-amber-700">
                                    No compatible image-generation models are available for this location&apos;s Google AI key.
                                </p>
                            ) : null}

                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Enhancement Aggression</Label>
                                <RadioGroup
                                    value={aggression}
                                    onValueChange={(value) => setAggression(value as EnhancementAggression)}
                                    className="grid gap-3"
                                >
                                    {[
                                        { value: "conservative", label: "Conservative", help: "Minimal correction, strict scene preservation." },
                                        { value: "balanced", label: "Balanced", help: "Moderate polish with realistic upgrades." },
                                        { value: "aggressive", label: "Aggressive", help: "Stronger cleanup and visual polish." },
                                    ].map((option) => (
                                        <label
                                            key={option.value}
                                            className={cn(
                                                "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                                                aggression === option.value ? "border-primary bg-primary/5" : "border-border"
                                            )}
                                        >
                                            <RadioGroupItem value={option.value} className="mt-0.5" />
                                            <span>
                                                <span className="font-medium">{option.label}</span>
                                                <span className="block text-xs text-muted-foreground">{option.help}</span>
                                            </span>
                                        </label>
                                    ))}
                                </RadioGroup>
                            </div>

                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleGenerate}
                                disabled={isBusy || modelCatalogLoading || generationModels.length === 0 || !selectedGenerationModel}
                            >
                                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Generate Enhanced Image
                            </Button>
                        </>
                    )}
                </div>
            </>
        );
    }

    function renderPrecisionControls() {
        return (
            <>
                <div className="space-y-2">
                    <Label className="text-sm font-medium">Generation Model</Label>
                    <AiModelSelect
                        value={selectedGenerationModel}
                        models={generationModels}
                        onValueChange={handleGenerationModelChange}
                        disabled={isBusy || modelCatalogLoading}
                        placeholder={modelCatalogLoading ? "Loading models..." : "Select generation model"}
                    />
                    <p className="text-xs text-muted-foreground">
                        Select the image-editing model used for object removal.
                    </p>
                    {generationModels.length === 0 && !modelCatalogLoading ? (
                        <p className="text-xs text-amber-700">
                            No compatible image-generation models are available for this location&apos;s Google AI key.
                        </p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Selection Tool</Label>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { value: "brush", label: "Brush" },
                            { value: "box", label: "Box" },
                        ].map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setPrecisionTool(option.value as PrecisionMaskTool)}
                                className={cn(
                                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                                    precisionTool === option.value
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-background hover:bg-muted"
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Label className="text-sm font-medium">Click To Select (Beta)</Label>
                            <p className="text-xs text-muted-foreground">
                                Detect objects, then click highlighted regions directly on the image to add them to the mask.
                            </p>
                        </div>
                        <Switch
                            checked={precisionClickSelectEnabled}
                            onCheckedChange={setPrecisionClickSelectEnabled}
                            disabled={precisionSelectableRegions.length === 0 || isBusy}
                        />
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handlePrecisionDetectSelectableObjects()}
                        disabled={isBusy}
                    >
                        {isDetectingPrecisionObjects ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {precisionSelectableRegions.length > 0 ? "Re-detect Objects" : "Detect Objects"}
                    </Button>

                    {precisionSelectableRegions.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                            {precisionSelectableRegions.length} selectable object regions available.
                        </p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Brush Size</Label>
                        <span className="text-xs text-muted-foreground">{precisionBrushSize}px</span>
                    </div>
                    <input
                        type="range"
                        min={8}
                        max={200}
                        step={2}
                        value={precisionBrushSize}
                        onChange={(event) => setPrecisionBrushSize(Number(event.target.value))}
                        className="w-full accent-primary"
                    />
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                        <Label className="text-sm font-medium">Erase Mask</Label>
                        <p className="text-xs text-muted-foreground">
                            Remove part of the current selection instead of adding to it.
                        </p>
                    </div>
                    <Switch checked={precisionEraseMode} onCheckedChange={setPrecisionEraseMode} />
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => precisionEditorRef.current?.undo()}
                        disabled={!precisionEditorState.canUndo || isBusy}
                    >
                        Undo
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => precisionEditorRef.current?.redo()}
                        disabled={!precisionEditorState.canRedo || isBusy}
                    >
                        Redo
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => precisionEditorRef.current?.clear()}
                        disabled={!precisionEditorState.hasMask || isBusy}
                    >
                        Clear
                    </Button>
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Replacement Guidance (optional)</Label>
                    <Textarea
                        value={precisionGuidance}
                        onChange={(event) => setPrecisionGuidance(event.target.value)}
                        placeholder="Example: Fill the removed area with matching paving and natural shadows."
                        className="min-h-[90px] text-sm"
                    />
                </div>

                <p className="text-xs text-muted-foreground">
                    Paint slightly beyond the object edges for cleaner removal.
                </p>

                {precisionEditorState.hasMask ? (
                    <p className="text-xs text-muted-foreground">
                        Current mask coverage: {(precisionEditorState.maskCoverage * 100).toFixed(1)}%
                    </p>
                ) : null}

                <Button
                    type="button"
                    onClick={() => void handlePrecisionRemove({ maskMode: "user_provided" })}
                    disabled={!precisionEditorState.isReady || !precisionEditorState.hasMask || isBusy || !selectedGenerationModel}
                >
                    {isRemoving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Remove Selected Area
                </Button>

                <div className="space-y-2 rounded-md border p-3">
                    <Label className="text-sm font-medium">Smart Remove</Label>
                    <p className="text-xs text-muted-foreground">
                        One-click automatic segmentation for common cleanup tasks.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        {PRECISION_REMOVE_SMART_PRESETS.map((preset) => (
                            <Button
                                key={preset.key}
                                type="button"
                                variant="secondary"
                                onClick={() => void handlePrecisionRemove({
                                    maskMode: preset.maskMode,
                                    semanticMaskClassIds: preset.semanticMaskClassIds,
                                })}
                                disabled={!precisionEditorState.isReady || isBusy || !selectedGenerationModel}
                                title={preset.description}
                            >
                                {isRemoving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                </div>

                <p className="text-xs text-muted-foreground">
                    Active generation model: {getModelLabel(selectedGenerationModel)}
                </p>
            </>
        );
    }

    function renderReviewRail() {
        if (!generated) return null;

        return (
            <>
                <div className="space-y-1">
                    <Badge variant="outline">Review</Badge>
                    <p className="text-sm text-muted-foreground">
                        Compare the original with the edited result before saving a new variant.
                    </p>
                </div>

                <div className="space-y-1">
                    <Label>Action Log</Label>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {generated.actionLog.length > 0 ? (
                            generated.actionLog.map((line, idx) => (
                                <li key={`${idx}-${line}`}>{line}</li>
                            ))
                        ) : (
                            <li>Generated with the current enhancement settings.</li>
                        )}
                    </ul>
                </div>

                <p className="text-xs text-muted-foreground">Generation model: {getModelLabel(generated.model)}</p>

                {generated.mode === "precision_remove" && generated.maskCoverage !== undefined ? (
                    <p className="text-xs text-muted-foreground">
                        Mask coverage: {(generated.maskCoverage * 100).toFixed(1)}%
                    </p>
                ) : null}

                {generated.mode === "precision_remove" ? (
                    <div className="space-y-2 rounded-md border p-3">
                        <div>
                            <Label className="text-sm font-medium">Iteration Workflow</Label>
                            <p className="text-xs text-muted-foreground">
                                Apply this pass as a reversible replacement, then continue removing more objects.
                            </p>
                        </div>
                        <Button type="button" variant="secondary" onClick={handleApplyPrecisionIterationAndContinue} disabled={isBusy}>
                            Apply Iteration & Continue Editing
                        </Button>
                    </div>
                ) : null}

                {generated.mode === "polish" && generated.finalPrompt ? (
                    <div className="space-y-2">
                        <Label>Final Prompt Used</Label>
                        <Textarea value={generated.finalPrompt} readOnly className="min-h-[120px] text-xs" />
                    </div>
                ) : null}

                {generated.mode === "polish" ? (
                    <div className="space-y-3 rounded-md border p-3">
                        {renderRoomTypeSelector()}
                    </div>
                ) : null}

                <div className="space-y-2 rounded-md border p-3">
                    <div>
                        <Label className="text-sm font-medium">Apply To Gallery</Label>
                        <p className="text-xs text-muted-foreground">
                            Choose how this result should appear in the property image gallery.
                        </p>
                    </div>
                    <RadioGroup
                        value={selectedApplyMode || ""}
                        onValueChange={(value) => setSelectedApplyMode(value as PropertyImageAiApplyMode)}
                        className="grid gap-3"
                    >
                        {[
                            {
                                value: PROPERTY_IMAGE_AI_APPLY_MODES[0],
                                label: "Replace original",
                                help: "Use this AI result in the current image slot and keep the original available for revert.",
                            },
                            {
                                value: PROPERTY_IMAGE_AI_APPLY_MODES[1],
                                label: "Add before original",
                                help: "Insert this AI result right before the current source image and keep both visible.",
                            },
                            {
                                value: PROPERTY_IMAGE_AI_APPLY_MODES[2],
                                label: "Add as primary",
                                help: "Add this AI result as the first gallery image while preserving the current source image.",
                            },
                        ].map((option) => (
                            <label
                                key={option.value}
                                className={cn(
                                    "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                                    selectedApplyMode === option.value ? "border-primary bg-primary/5" : "border-border"
                                )}
                            >
                                <RadioGroupItem value={option.value} className="mt-0.5" />
                                <span>
                                    <span className="font-medium">{option.label}</span>
                                    <span className="block text-xs text-muted-foreground">{option.help}</span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>
                </div>

                <div className="grid gap-2">
                    <Button type="button" onClick={handleApplyVariant} disabled={!selectedApplyMode || isBusy}>
                        Keep Result
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleRegenerate()} disabled={isBusy}>
                        {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Regenerate
                    </Button>
                    <Button type="button" variant="outline" onClick={handleBackToEdit} disabled={isBusy}>
                        Back to Edit
                    </Button>
                </div>
            </>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-7xl max-h-[94vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        AI Enhance Listing Photo
                    </DialogTitle>
                    <DialogDescription>
                        {stage === "review"
                            ? "Review the edited result with a before/after comparison."
                            : "Choose a mode, edit the source photo, and generate a listing-ready variant."}
                    </DialogDescription>
                </DialogHeader>

                {!canRun ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Save the property first and use a hosted image to enable AI enhancement.
                    </div>
                ) : null}

                {canRun && image ? (
                    <div className="space-y-4">
                        {error ? (
                            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                {error}
                            </div>
                        ) : null}

                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                            <div className="space-y-4">
                                <div className={cn(stage === "review" ? "hidden" : "")}>
                                    {mode === "precision_remove" ? (
                                        <div className="space-y-2">
                                            <Label>Precision Remove Editor</Label>
                                            <PropertyImageMaskEditor
                                                ref={precisionEditorRef}
                                                imageUrl={image.url}
                                                tool={precisionTool}
                                                brushSize={precisionBrushSize}
                                                eraseMode={precisionEraseMode}
                                                selectableRegions={precisionSelectableRegions}
                                                clickSelectEnabled={precisionClickSelectEnabled}
                                                disabled={isBusy}
                                                onStateChange={setPrecisionEditorState}
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>Source Photo</Label>
                                                <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                                                    {image.cloudflareImageId ? (
                                                        <CloudflareImage
                                                            imageId={image.cloudflareImageId}
                                                            alt={`Source image ${imageIndex + 1}`}
                                                            variant="public"
                                                            width={1200}
                                                            height={675}
                                                            className="h-full w-full object-contain"
                                                        />
                                                    ) : (
                                                        <img
                                                            src={image.url}
                                                            alt={`Source image ${imageIndex + 1}`}
                                                            className="h-full w-full object-contain"
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            {effectiveAnalysis ? (
                                                <div className="space-y-4 rounded-md border p-4">
                                                    <div className="space-y-1">
                                                        <Label className="text-sm font-medium">Scene Summary</Label>
                                                        <p className="text-sm text-muted-foreground">{effectiveAnalysis.sceneSummary}</p>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium">Suggested Fixes</Label>
                                                        {effectiveAnalysis.suggestedFixes.length === 0 ? (
                                                            <p className="text-sm text-muted-foreground">
                                                                No fixes were suggested. You can still generate with polish mode or use the override instructions.
                                                            </p>
                                                        ) : (
                                                            <div className="flex flex-wrap gap-2">
                                                                {effectiveAnalysis.suggestedFixes.map((fix) => {
                                                                    const active = selectedFixIds.includes(fix.id);
                                                                    if (editingFixId === fix.id) {
                                                                        return (
                                                                            <div key={fix.id} className="flex items-center gap-1">
                                                                                <Input
                                                                                    autoFocus
                                                                                    value={editingFixLabel}
                                                                                    onChange={(e) => setEditingFixLabel(e.target.value)}
                                                                                    onKeyDown={(e) => e.key === "Enter" && saveEditingFix()}
                                                                                    onBlur={saveEditingFix}
                                                                                    className="h-7 px-2 py-1 text-xs w-40"
                                                                                />
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return (
                                                                        <div key={fix.id} className="group relative flex items-center">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleFix(fix.id)}
                                                                                className={cn(
                                                                                    "rounded-full border px-3 py-1 text-xs transition-colors pr-7",
                                                                                    active
                                                                                        ? "border-primary bg-primary text-primary-foreground"
                                                                                        : "border-border bg-background text-foreground hover:bg-muted"
                                                                                )}
                                                                            >
                                                                                {fix.label}
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => startEditingFix(fix.id, fix.label)}
                                                                                className={cn(
                                                                                    "absolute right-1 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
                                                                                    active ? "text-primary-foreground hover:bg-primary/20" : "text-muted-foreground hover:bg-muted-foreground/20"
                                                                                )}
                                                                            >
                                                                                <Edit2 className="h-3 w-3" />
                                                                            </button>
                                                                        </div>
                                                                    );
                                                                })}
                                                                {isAddingFix ? (
                                                                    <div className="flex items-center gap-1">
                                                                        <Input
                                                                            autoFocus
                                                                            value={newFixLabel}
                                                                            onChange={(e) => setNewFixLabel(e.target.value)}
                                                                            onKeyDown={(e) => e.key === "Enter" && saveNewFix()}
                                                                            onBlur={saveNewFix}
                                                                            placeholder="Type fix..."
                                                                            className="h-7 px-2 py-1 text-xs w-32"
                                                                        />
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setIsAddingFix(true)}
                                                                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                                                                    >
                                                                        <Plus className="h-3 w-3" />
                                                                        <span>Add Fix</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {effectiveAnalysis.detectedElements.length > 0 ? (
                                                        <div className="space-y-2">
                                                            <Label className="text-sm font-medium">Detected Elements</Label>
                                                            <div className="flex flex-wrap gap-2">
                                                                {effectiveAnalysis.detectedElements.slice(0, 12).map((item) => {
                                                                    const markedForRemoval = removedDetectedElementIds.includes(item.id);
                                                                    return (
                                                                        <button
                                                                            key={item.id}
                                                                            type="button"
                                                                            onClick={() => toggleDetectedElementRemoval(item.id)}
                                                                            className={cn(
                                                                                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                                                                                markedForRemoval
                                                                                    ? "border-destructive bg-destructive text-destructive-foreground"
                                                                                    : "border-border bg-background text-foreground hover:bg-muted"
                                                                            )}
                                                                        >
                                                                            <span>{item.label}</span>
                                                                            <span className={cn(
                                                                                "text-[10px]",
                                                                                markedForRemoval ? "text-destructive-foreground/90" : "text-muted-foreground"
                                                                            )}>
                                                                                {markedForRemoval ? "Will remove" : `Remove (${item.severity})`}
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">
                                                                Click a detected element to mark or unmark it for removal in the generated image prompt.
                                                            </p>
                                                        </div>
                                                    ) : null}

                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium">Live Final Prompt</Label>
                                                        <Textarea value={liveFinalPrompt} readOnly className="min-h-[140px] text-xs" />
                                                        <p className="text-xs text-muted-foreground">
                                                            This prompt updates whenever you change fixes, removals, aggression, prompt reuse, or override instructions.
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                </div>

                                {generated ? (
                                    <div className={cn(stage === "review" ? "" : "hidden")}>
                                        <PropertyImageCompareViewer
                                            beforeSrc={image.url}
                                            afterSrc={generated.generatedImageUrl}
                                            alt={`Property image ${imageIndex + 1}`}
                                        />
                                    </div>
                                ) : null}
                            </div>

                            <div className="space-y-4 rounded-md border p-4">
                                {stage === "edit" ? (
                                    <>
                                        <div className="space-y-1">
                                            <Badge variant="outline">Edit</Badge>
                                            <p className="text-sm text-muted-foreground">
                                                {mode === "precision_remove"
                                                    ? "Select an area to remove with a precise mask."
                                                    : "Analyze and polish this listing photo while preserving truthfulness."}
                                            </p>
                                        </div>

                                        {renderModeSwitcher()}
                                        {mode === "precision_remove" ? renderPrecisionControls() : renderPolishControls()}
                                    </>
                                ) : renderReviewRail()}
                            </div>
                        </div>
                    </div>
                ) : null}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
