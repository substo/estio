"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { getPropertyAiUsageSummary, type AiUsageSummary } from "@/app/(main)/admin/_actions/ai-usage";
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
import { formatAiUsageCost, PropertyAiUsageBadge } from "./property-ai-usage-badge";

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
    imageCount?: number;
    usageCurrency?: string;
    onNavigateImage?: (nextIndex: number) => void;
    roomPromptProfiles?: PropertyImagePromptProfile[];
    precisionRemoveEnabled?: boolean;
    onApplyVariant: (payload: GeneratedVariantPayload) => void;
    canRevertActiveSource?: boolean;
    onRevertActiveSource?: () => void;
}

type EnhancementWorkflowMode = "semi_auto" | "full_auto";

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
    imageCount = 1,
    usageCurrency = "USD",
    onNavigateImage,
    roomPromptProfiles = [],
    precisionRemoveEnabled = false,
    onApplyVariant,
    canRevertActiveSource = false,
    onRevertActiveSource,
}: PropertyImageEnhanceDialogProps) {
    const precisionEditorRef = useRef<PrecisionMaskEditorHandle | null>(null);
    const analysisModelTouchedRef = useRef(false);
    const generationModelTouchedRef = useRef(false);
    const roomTypePredictionRequestRef = useRef("");
    const fullAutoRunKeyRef = useRef("");
    const skipNextSourceResetRef = useRef(false);
    const {
        analysisModels,
        generationModels,
        defaults: modelDefaults,
        loading: modelCatalogLoading,
        getModelLabel,
    } = usePropertyImageEnhancementModelCatalog();
    const [mode, setMode] = useState<EnhancementMode>("polish");
    const [workflowMode, setWorkflowMode] = useState<EnhancementWorkflowMode>("semi_auto");
    const [showUsage, setShowUsage] = useState(false);
    const [usageRefreshKey, setUsageRefreshKey] = useState(0);
    const [usageSummary, setUsageSummary] = useState<AiUsageSummary | null>(null);
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
    const [showAnalysisSettings, setShowAnalysisSettings] = useState(false);
    const [showInstructionEditor, setShowInstructionEditor] = useState(false);
    const [showAnalysisModelPicker, setShowAnalysisModelPicker] = useState(false);
    const [showGenerationSettings, setShowGenerationSettings] = useState(false);
    const [showLivePrompt, setShowLivePrompt] = useState(false);
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
    const [sourceImageAspectRatio, setSourceImageAspectRatio] = useState(16 / 9);
    const [hasKeptResult, setHasKeptResult] = useState(false);
    const [adjustmentInstructions, setAdjustmentInstructions] = useState("");
    const [editingFixId, setEditingFixId] = useState<string | null>(null);
    const [editingFixLabel, setEditingFixLabel] = useState("");
    const [isAddingFix, setIsAddingFix] = useState(false);
    const [newFixLabel, setNewFixLabel] = useState("");

    const canRun = useMemo(() => {
        if (!propertyId) return false;
        if (!image) return false;
        return Boolean(image.cloudflareImageId || image.url);
    }, [propertyId, image]);
    const sourceIdentity = useMemo(() => (
        String(image?.cloudflareImageId || image?.url || "").trim()
    ), [image?.cloudflareImageId, image?.url]);
    const canGoPrevious = imageIndex > 0;
    const canGoNext = imageIndex < Math.max(0, imageCount - 1);
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
    const usageCurrencyCode = String(usageCurrency || "USD").trim().toUpperCase();
    const compactUsageCost = formatAiUsageCost(usageSummary?.totalEstimatedCostUsd || 0, usageCurrencyCode);
    const sourceImageIsLandscape = sourceImageAspectRatio > 1;
    const sourceImageFrameStyle = sourceImageIsLandscape
        ? { aspectRatio: sourceImageAspectRatio }
        : { aspectRatio: sourceImageAspectRatio, width: `min(100%, calc(50dvh * ${sourceImageAspectRatio}))` };
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
            setShowAnalysisSettings(false);
            setShowInstructionEditor(false);
            setShowAnalysisModelPicker(false);
            setShowGenerationSettings(false);
            setShowLivePrompt(false);
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
            setSourceImageAspectRatio(16 / 9);
            setHasKeptResult(false);
            setAdjustmentInstructions("");
            setEditingFixId(null);
            setEditingFixLabel("");
            setIsAddingFix(false);
            setNewFixLabel("");
            fullAutoRunKeyRef.current = "";
        }
    }, [open]);

    useEffect(() => {
        if (!open || !propertyId) {
            setUsageSummary(null);
            return;
        }

        let cancelled = false;
        getPropertyAiUsageSummary(propertyId)
            .then((summary) => {
                if (!cancelled) setUsageSummary(summary);
            })
            .catch(() => {
                if (!cancelled) setUsageSummary(null);
            });

        return () => {
            cancelled = true;
        };
    }, [open, propertyId, usageRefreshKey]);

    useEffect(() => {
        if (!open) return;
        if (skipNextSourceResetRef.current) {
            skipNextSourceResetRef.current = false;
            return;
        }
        setAnalysis(null);
        setSelectedFixIds([]);
        setRemovedDetectedElementIds([]);
        setRoomTypeSelectValue(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
        setCustomRoomTypeLabel("");
        setReuseSavedRoomPrompt(false);
        setIsPredictingRoomType(false);
        setRoomTypePrediction(null);
        setRoomTypeCandidates([]);
        setRoomTypePredictionModel(null);
        roomTypePredictionRequestRef.current = "";
        fullAutoRunKeyRef.current = "";
        setUserInstructions("");
        setUsedAnalysisModel(null);
        setShowAnalysisSettings(false);
        setShowInstructionEditor(false);
        setShowAnalysisModelPicker(false);
        setShowGenerationSettings(false);
        setShowLivePrompt(false);
        setPrecisionSelectableRegions([]);
        setPrecisionClickSelectEnabled(false);
        setPrecisionEditorState(EMPTY_PRECISION_EDITOR_STATE);
        setLastPrecisionRequest(null);
        setSelectedApplyMode(null);
        setError(null);
        setGenerated(null);
        setSourceImageAspectRatio(16 / 9);
        setHasKeptResult(false);
        setAdjustmentInstructions("");
    }, [open, sourceIdentity, propertyId]);

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

    useEffect(() => {
        if (!open || workflowMode !== "full_auto") return;
        if (mode !== "polish" || !canRun || !propertyId || !image) return;
        if (modelCatalogLoading || !selectedAnalysisModel || !selectedGenerationModel) return;
        if (isBusy || generated) return;

        const runKey = `${propertyId}:${sourceIdentity}:${selectedAnalysisModel}:${selectedGenerationModel}`;
        if (!sourceIdentity || fullAutoRunKeyRef.current === runKey) return;
        fullAutoRunKeyRef.current = runKey;
        void handleEnhancePhoto();
    }, [
        open,
        workflowMode,
        mode,
        canRun,
        propertyId,
        image,
        modelCatalogLoading,
        selectedAnalysisModel,
        selectedGenerationModel,
        isBusy,
        generated,
        sourceIdentity,
    ]);

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

    async function handlePredictRoomTypeForCurrentImage() {
        if (!canRun || !image || !propertyId) return;
        if (mode !== "polish") return;
        if (roomTypePrediction) return;
        if (!selectedAnalysisModel.trim()) return;

        const requestKey = `${propertyId}:${sourceIdentity}`;
        if (!requestKey || roomTypePredictionRequestRef.current === requestKey) return;
        roomTypePredictionRequestRef.current = requestKey;

        setIsPredictingRoomType(true);
        setRoomTypePrediction(null);
        setRoomTypeCandidates([]);
        setRoomTypePredictionModel(null);

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

            setRoomTypePrediction(suggested);
            setRoomTypeCandidates(candidates);
            setRoomTypePredictionModel(payload.model || null);
            setUsageRefreshKey((prev) => prev + 1);

            if (isConfident) {
                const nextSelectValue = toRoomTypeSelectValue(suggested.key);
                setRoomTypeSelectValue(nextSelectValue);
                setCustomRoomTypeLabel(nextSelectValue === PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY ? suggested.label : "");
            } else {
                setRoomTypeSelectValue(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
                setCustomRoomTypeLabel("");
            }
        } catch (err) {
            roomTypePredictionRequestRef.current = "";
            console.error("[PropertyImageEnhanceDialog] room type prediction error:", err);
            const message = err instanceof Error ? err.message : "Failed to predict room type.";
            setError(message);
            toast.error(message);
        } finally {
            setIsPredictingRoomType(false);
        }
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

    async function handleAnalyze(): Promise<ImageEnhancementAnalysis | null> {
        if (!canRun || !image || !propertyId) return null;
        if (!selectedAnalysisModel.trim()) {
            const message = "Choose an analysis model before running photo analysis.";
            setError(message);
            toast.error(message);
            return null;
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
            setUsageRefreshKey((prev) => prev + 1);
            return payload.analysis;
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] analyze error:", err);
            const message = err instanceof Error ? err.message : "Failed to analyze image.";
            setError(message);
            toast.error(message);
            return null;
        } finally {
            setIsAnalyzing(false);
        }
    }

    async function handleGenerate(analysisOverride?: ImageEnhancementAnalysis | null, instructionsOverride?: string): Promise<ImageEnhancementGeneratedResult | null> {
        const analysisForGeneration = analysisOverride || effectiveAnalysis;
        if (!canRun || !image || !propertyId || !analysisForGeneration) return null;
        if (!selectedGenerationModel.trim()) {
            const message = "Choose a generation model before creating the enhanced image.";
            setError(message);
            toast.error(message);
            return null;
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
                    analysis: analysisForGeneration,
                    selectedFixIds,
                    removedDetectedElementIds,
                    aggression,
                    generationModel: selectedGenerationModel,
                    priorPrompt: effectivePriorPrompt,
                    userInstructions: instructionsOverride ?? userInstructions,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to generate enhanced image."));
            }

            const payload = json as GenerateApiResponse;
            const nextGenerated = {
                mode: "polish" as const,
                generatedImageId: payload.generatedImageId,
                generatedImageUrl: payload.generatedImageUrl,
                actionLog: payload.actionLog,
                model: payload.model,
                finalPrompt: payload.finalPrompt,
                reusablePrompt: payload.reusablePrompt,
            };
            setSelectedApplyMode(null);
            setGenerated(nextGenerated);
            setHasKeptResult(false);
            setUsageRefreshKey((prev) => prev + 1);
            return nextGenerated;
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] generate error:", err);
            const message = err instanceof Error ? err.message : "Failed to generate enhanced image.";
            setError(message);
            toast.error(message);
            return null;
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
            setHasKeptResult(false);
            setUsageRefreshKey((prev) => prev + 1);
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

    async function handleEnhancePhoto() {
        if (mode !== "polish") return;
        if (!canRun || !image || !propertyId) return;

        await handlePredictRoomTypeForCurrentImage();
        const analysisForGeneration = effectiveAnalysis || await handleAnalyze();
        if (!analysisForGeneration) return;
        await handleGenerate(analysisForGeneration);
    }

    async function handleApplyAdjustment() {
        const normalized = adjustmentInstructions.trim();
        if (!normalized || !effectiveAnalysis) return;

        const nextInstructions = [userInstructions.trim(), normalized]
            .filter(Boolean)
            .join("\n\n");
        setUserInstructions(nextInstructions);
        setAdjustmentInstructions("");
        await handleGenerate(effectiveAnalysis, nextInstructions);
    }

    function handleNavigateImage(nextIndex: number) {
        if (!onNavigateImage || isBusy) return;
        const bounded = Math.min(Math.max(0, nextIndex), Math.max(0, imageCount - 1));
        if (bounded === imageIndex) return;
        onNavigateImage(bounded);
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

        skipNextSourceResetRef.current = true;
        onApplyVariant({
            url: generated.generatedImageUrl,
            cloudflareImageId: generated.generatedImageId,
            applyMode: selectedApplyMode,
            promptProfileUpsert,
        });
        toast.success("Enhanced image added. Click Save Property to persist.");
        setHasKeptResult(true);
        setUsageRefreshKey((prev) => prev + 1);
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

    function handleUndoAppliedIteration() {
        if (!onRevertActiveSource) return;
        onRevertActiveSource();
        setError(null);
        toast.success("Reverted to the previous iteration source image.");
    }

    function renderModeSwitcher() {
        if (!precisionRemoveEnabled) return null;

        return (
            <div className="space-y-2">
                <Label className="text-sm font-medium">Mode</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

    function renderWorkflowSwitcher(variant: "default" | "compact" = "default") {
        const compact = variant === "compact";
        return (
            <div
                className={cn(
                    "grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1",
                    compact ? "h-9 w-[118px] shrink-0" : ""
                )}
            >
                {[
                    { value: "semi_auto", label: compact ? "Semi" : "Semi Auto" },
                    { value: "full_auto", label: compact ? "Auto" : "Full Auto" },
                ].map((option) => {
                    const active = workflowMode === option.value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setWorkflowMode(option.value as EnhancementWorkflowMode)}
                            disabled={isBusy}
                            className={cn(
                                "rounded px-2 text-xs font-medium transition-colors",
                                compact ? "py-1" : "py-1.5",
                                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            )}
                            title={option.value === "full_auto" ? "Full Auto" : "Semi Auto"}
                        >
                            {option.label}
                        </button>
                    );
                })}
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
        const selectedFixes = effectiveAnalysis?.suggestedFixes.filter((fix) => selectedFixIds.includes(fix.id)) || [];
        const removedElements = effectiveAnalysis?.detectedElements.filter((item) => removedDetectedElementIds.includes(item.id)) || [];

        return (
            <div className="grid gap-3 lg:grid-cols-3">
                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Badge variant="outline">1. Classify</Badge>
                            <p className="mt-2 text-sm font-medium">{selectedRoomType.label || "Unclassified room"}</p>
                        </div>
                        {roomTypePrediction ? (
                            <Badge variant="secondary">{Math.round(Number(roomTypePrediction.confidence || 0) * 100)}%</Badge>
                        ) : null}
                    </div>

                    {renderRoomTypeSelector()}

                    <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                        <span className="text-xs font-medium">Reuse saved room prompt</span>
                        <Switch
                            checked={reuseSavedRoomPrompt}
                            onCheckedChange={setReuseSavedRoomPrompt}
                            disabled={!hasSelectedRoomPrompt}
                        />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void handlePredictRoomTypeForCurrentImage()}
                            disabled={isBusy || !selectedAnalysisModel || Boolean(roomTypePrediction)}
                        >
                            {isPredictingRoomType ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Classify
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowInstructionEditor((prev) => !prev)}
                        >
                            AI request
                        </Button>
                    </div>

                    {showInstructionEditor ? (
                        <div className="space-y-2">
                            <Textarea
                                value={userInstructions}
                                onChange={(event) => setUserInstructions(event.target.value)}
                                placeholder="Add a specific request for this photo."
                                className="min-h-[96px] text-sm"
                            />
                            <p className="text-xs text-muted-foreground">These notes are included in analysis and generation.</p>
                        </div>
                    ) : (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                            {userInstructions.trim() || (hasSelectedRoomPrompt ? "Saved prompt memory is available for this room type." : "No extra AI request added.")}
                        </p>
                    )}
                </div>

                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Badge variant="outline">2. Analyze</Badge>
                            <p className="mt-2 text-sm font-medium">
                                {effectiveAnalysis ? `${effectiveAnalysis.suggestedFixes.length} feature chips` : "Find editable features"}
                            </p>
                        </div>
                        {analysis ? <Badge variant="secondary">Done</Badge> : null}
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowAnalysisModelPicker((prev) => !prev)}
                        className="w-full rounded-md border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                    >
                        Model: {getModelLabel(usedAnalysisModel || selectedAnalysisModel) || "Select analysis model"}
                    </button>

                    {showAnalysisModelPicker || showAnalysisSettings ? (
                        <div className="space-y-2">
                            <AiModelSelect
                                value={selectedAnalysisModel}
                                models={analysisModels}
                                onValueChange={handleAnalysisModelChange}
                                disabled={isBusy || modelCatalogLoading}
                                placeholder={modelCatalogLoading ? "Loading models..." : "Select analysis model"}
                            />
                            {analysisModels.length === 0 && !modelCatalogLoading ? (
                                <p className="text-xs text-amber-700">No compatible analysis models are available.</p>
                            ) : null}
                        </div>
                    ) : null}

                    <Button
                        type="button"
                        onClick={handleAnalyze}
                        disabled={isBusy || modelCatalogLoading || analysisModels.length === 0 || !selectedAnalysisModel}
                        className="w-full"
                    >
                        {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {analysis ? "Re-analyze" : "Analyze"}
                    </Button>

                    {effectiveAnalysis ? (
                        <div className="space-y-2">
                            <p className="line-clamp-2 text-xs text-muted-foreground">{effectiveAnalysis.sceneSummary}</p>
                            <div className="flex flex-wrap gap-2">
                                {effectiveAnalysis.suggestedFixes.map((fix) => {
                                    const active = selectedFixIds.includes(fix.id);
                                    if (editingFixId === fix.id) {
                                        return (
                                            <Input
                                                key={fix.id}
                                                autoFocus
                                                value={editingFixLabel}
                                                onChange={(event) => setEditingFixLabel(event.target.value)}
                                                onKeyDown={(event) => event.key === "Enter" && saveEditingFix()}
                                                onBlur={saveEditingFix}
                                                className="h-8 w-44 text-xs"
                                            />
                                        );
                                    }
                                    return (
                                        <button
                                            key={fix.id}
                                            type="button"
                                            onClick={() => toggleFix(fix.id)}
                                            onDoubleClick={() => startEditingFix(fix.id, fix.label)}
                                            className={cn(
                                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
                                            )}
                                            title="Click to select. Double-click to edit the feature instruction."
                                        >
                                            {fix.label}
                                        </button>
                                    );
                                })}
                                {isAddingFix ? (
                                    <Input
                                        autoFocus
                                        value={newFixLabel}
                                        onChange={(event) => setNewFixLabel(event.target.value)}
                                        onKeyDown={(event) => event.key === "Enter" && saveNewFix()}
                                        onBlur={saveNewFix}
                                        placeholder="New feature"
                                        className="h-8 w-36 text-xs"
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingFix(true)}
                                        className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        + Feature
                                    </button>
                                )}
                            </div>

                            {effectiveAnalysis.detectedElements.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {effectiveAnalysis.detectedElements.slice(0, 8).map((item) => {
                                        const active = removedDetectedElementIds.includes(item.id);
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => toggleDetectedElementRemoval(item.id)}
                                                className={cn(
                                                    "rounded-full border px-3 py-1 text-xs transition-colors",
                                                    active ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background hover:bg-muted"
                                                )}
                                            >
                                                {active ? "Remove " : ""}{item.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">Analyze once to turn the prompt into selectable feature chips.</p>
                    )}
                </div>

                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Badge variant="outline">3. Generate</Badge>
                            <p className="mt-2 text-sm font-medium">
                                {selectedFixes.length + removedElements.length > 0
                                    ? `${selectedFixes.length + removedElements.length} selected changes`
                                    : "Ready after analysis"}
                            </p>
                        </div>
                        {effectiveAnalysis ? <Badge variant="secondary">Ready</Badge> : null}
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowGenerationSettings((prev) => !prev)}
                        className="w-full rounded-md border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                    >
                        Model: {getModelLabel(selectedGenerationModel) || "Select generation model"}
                    </button>

                    {showGenerationSettings ? (
                        <div className="space-y-3">
                            <AiModelSelect
                                value={selectedGenerationModel}
                                models={generationModels}
                                onValueChange={handleGenerationModelChange}
                                disabled={isBusy || modelCatalogLoading}
                                placeholder={modelCatalogLoading ? "Loading models..." : "Select generation model"}
                            />
                            <RadioGroup
                                value={aggression}
                                onValueChange={(value) => setAggression(value as EnhancementAggression)}
                                className="grid grid-cols-3 gap-2"
                            >
                                {[
                                    { value: "conservative", label: "Light" },
                                    { value: "balanced", label: "Balanced" },
                                    { value: "aggressive", label: "Strong" },
                                ].map((option) => (
                                    <label
                                        key={option.value}
                                        className={cn(
                                            "flex items-center justify-center rounded-md border px-2 py-2 text-xs font-medium",
                                            aggression === option.value ? "border-primary bg-primary/5" : "border-border"
                                        )}
                                    >
                                        <RadioGroupItem value={option.value} className="sr-only" />
                                        {option.label}
                                    </label>
                                ))}
                            </RadioGroup>
                            {generationModels.length === 0 && !modelCatalogLoading ? (
                                <p className="text-xs text-amber-700">No compatible generation models are available.</p>
                            ) : null}
                        </div>
                    ) : null}

                    <Button
                        type="button"
                        onClick={() => void (effectiveAnalysis ? handleGenerate() : handleEnhancePhoto())}
                        disabled={isBusy || modelCatalogLoading || analysisModels.length === 0 || generationModels.length === 0 || !selectedAnalysisModel || !selectedGenerationModel}
                        className="w-full"
                    >
                        {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        {effectiveAnalysis ? "Generate Image" : "Analyze + Generate"}
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowLivePrompt((prev) => !prev)}
                        disabled={!effectiveAnalysis}
                        className="w-full"
                    >
                        {showLivePrompt ? "Hide Prompt" : "View Prompt"}
                    </Button>

                    {showLivePrompt && effectiveAnalysis ? (
                        <Textarea value={liveFinalPrompt} readOnly className="min-h-[120px] text-xs" />
                    ) : (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                            {effectiveAnalysis
                                ? liveFinalPrompt
                                : "The final prompt will be assembled from the selected feature chips, removed objects, room memory, and user request."}
                        </p>
                    )}

                    {workflowMode === "full_auto" ? (
                        <p className="text-xs text-amber-700">Auto runs classification, analysis, and generation for this photo.</p>
                    ) : null}
                </div>
            </div>
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

                {canRevertActiveSource ? (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleUndoAppliedIteration}
                        disabled={isBusy}
                    >
                        Undo Last Applied Iteration
                    </Button>
                ) : null}

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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

    function renderSourcePhotoPreview() {
        if (!image) return null;

        return (
            <div className="space-y-2">
                <div
                    className={cn(
                        "relative overflow-hidden rounded-md border bg-muted",
                        sourceImageIsLandscape ? "w-full" : "mx-auto max-h-[50dvh] max-w-full"
                    )}
                    style={sourceImageFrameStyle}
                >
                    {image.cloudflareImageId ? (
                        <CloudflareImage
                            imageId={image.cloudflareImageId}
                            alt={`Source image ${imageIndex + 1}`}
                            variant="public"
                            width={1600}
                            height={900}
                            className="absolute inset-0 h-full w-full object-contain"
                            onLoadingComplete={(loadedImage) => {
                                if (loadedImage.naturalWidth > 0 && loadedImage.naturalHeight > 0) {
                                    setSourceImageAspectRatio(loadedImage.naturalWidth / loadedImage.naturalHeight);
                                }
                            }}
                        />
                    ) : (
                        <img
                            src={image.url}
                            alt={`Source image ${imageIndex + 1}`}
                            className="absolute inset-0 h-full w-full object-contain"
                            onLoad={(event) => {
                                const loadedImage = event.currentTarget;
                                if (loadedImage.naturalWidth > 0 && loadedImage.naturalHeight > 0) {
                                    setSourceImageAspectRatio(loadedImage.naturalWidth / loadedImage.naturalHeight);
                                }
                            }}
                        />
                    )}
                </div>
            </div>
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
                        <div>
                            <Label className="text-sm font-medium">Adjust This Result</Label>
                            <p className="text-xs text-muted-foreground">
                                Add a short change request and regenerate without restarting the workflow.
                            </p>
                        </div>
                        <Textarea
                            value={adjustmentInstructions}
                            onChange={(event) => setAdjustmentInstructions(event.target.value)}
                            placeholder="Example: make the pool water clearer, but keep the terrace exactly the same."
                            className="min-h-[84px] text-sm"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleApplyAdjustment()}
                            disabled={isBusy || !adjustmentInstructions.trim()}
                            className="w-full"
                        >
                            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Apply Adjustment
                        </Button>
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
                    {hasKeptResult ? (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                            Result kept in the gallery. Save the property to persist it.
                        </div>
                    ) : null}
                    <Button type="button" onClick={handleApplyVariant} disabled={!selectedApplyMode || isBusy || hasKeptResult}>
                        {hasKeptResult ? "Result Kept" : "Keep Result"}
                    </Button>
                    {hasKeptResult && canGoNext ? (
                        <Button type="button" variant="secondary" onClick={() => handleNavigateImage(imageIndex + 1)} disabled={isBusy}>
                            Next Photo
                            <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                    ) : null}
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
            <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[94vh] sm:w-[96vw] sm:max-w-7xl sm:rounded-lg sm:p-6">
                <div className="flex h-full min-h-0 flex-col sm:block">
                <DialogHeader className="shrink-0 border-b px-3 py-2 pr-12 sm:px-4 sm:pr-12">
                    <DialogTitle className="sr-only">AI Listing Photo</DialogTitle>
                    <DialogDescription className="sr-only">
                        Enhance this listing photo and review AI usage for the property.
                    </DialogDescription>
                    <div className="flex h-10 items-center justify-between gap-2">
                        <div className="inline-flex shrink-0 overflow-hidden rounded-md border bg-background">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleNavigateImage(imageIndex - 1)}
                                disabled={!canGoPrevious || isBusy}
                                className="h-9 w-10 rounded-none"
                                title="Previous photo"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleNavigateImage(imageIndex + 1)}
                                disabled={!canGoNext || isBusy}
                                className="h-9 w-10 rounded-none border-l"
                                title="Next photo"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                        {renderWorkflowSwitcher("compact")}
                        <button
                            type="button"
                            onClick={() => setShowUsage((prev) => !prev)}
                            className={cn(
                                "ml-auto inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold transition-colors",
                                showUsage ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted"
                            )}
                            aria-expanded={showUsage}
                            aria-label="Toggle property AI usage"
                        >
                            {compactUsageCost}
                        </button>
                    </div>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:overflow-visible sm:px-0 sm:py-0">
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

                        {showUsage && propertyId ? (
                            <PropertyAiUsageBadge
                                propertyId={propertyId}
                                refreshKey={usageRefreshKey}
                                defaultExpanded
                                hideWhenEmpty={false}
                                title="Property AI Usage"
                                className="shadow-sm"
                                currency={usageCurrencyCode}
                                showSummaryHeader={false}
                            />
                        ) : null}

                        {stage === "edit" && mode !== "precision_remove" ? renderSourcePhotoPreview() : null}

                        {generated ? (
                            <PropertyImageCompareViewer
                                beforeSrc={image.url}
                                afterSrc={generated.generatedImageUrl}
                                alt={`Property image ${imageIndex + 1}`}
                            />
                        ) : null}

                        {stage === "edit" && mode === "polish" ? (
                            <div className="space-y-3">
                                {renderModeSwitcher()}
                                {renderPolishControls()}
                            </div>
                        ) : (
                            <div className={cn("grid gap-4", stage === "edit" ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "")}>
                                <div className={cn("space-y-4", stage === "review" ? "hidden" : "")}>
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
                                                className="max-h-[65dvh] sm:max-h-none"
                                            />
                                        </div>
                                    ) : null}
                                </div>

                                <div className="space-y-4 rounded-md border p-3 sm:p-4 xl:sticky xl:top-0 xl:max-h-[calc(94vh-9rem)] xl:overflow-y-auto">
                                    {stage === "edit" ? (
                                        <>
                                            <div className="space-y-1">
                                                <Badge variant="outline">Edit</Badge>
                                                <p className="text-sm text-muted-foreground">
                                                    Select an area to remove with a precise mask.
                                                </p>
                                            </div>

                                            {renderModeSwitcher()}
                                            {renderPrecisionControls()}
                                        </>
                                    ) : renderReviewRail()}
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}

                </div>

                <DialogFooter className="shrink-0 border-t bg-background px-4 py-3 sm:border-0 sm:px-0 sm:py-0">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
                        Close
                    </Button>
                </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
