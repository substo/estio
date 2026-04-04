"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import type {
    EnhancementAggression,
    EnhancementMode,
    ImageEnhancementAnalysis,
    ImageEnhancementGeneratedResult,
} from "@/lib/ai/property-image-enhancement-types";
import { buildGenerationPrompt } from "@/lib/ai/property-image-enhancement-prompt";
import {
    PROPERTY_IMAGE_AI_APPLY_MODES,
    type PropertyImageAiApplyMode,
} from "@/lib/properties/property-media-ai";
import {
    PropertyImageCompareViewer,
} from "./property-image-compare-viewer";
import {
    PropertyImageMaskEditor,
    type PrecisionMaskEditorHandle,
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
    reusablePrompt: string;
}

interface PropertyImageEnhanceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
    propertyId?: string;
    image: PropertyImageLike | null;
    imageIndex: number;
    priorPrompt?: string;
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
    maskCoverage: number;
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

export function PropertyImageEnhanceDialog({
    open,
    onOpenChange,
    locationId,
    propertyId,
    image,
    imageIndex,
    priorPrompt,
    precisionRemoveEnabled = false,
    onApplyVariant,
}: PropertyImageEnhanceDialogProps) {
    const precisionEditorRef = useRef<PrecisionMaskEditorHandle | null>(null);
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
    const [reusePriorPrompt, setReusePriorPrompt] = useState(Boolean(String(priorPrompt || "").trim()));
    const [userInstructions, setUserInstructions] = useState("");
    const [selectedAnalysisModel, setSelectedAnalysisModel] = useState("");
    const [selectedGenerationModel, setSelectedGenerationModel] = useState("");
    const [usedAnalysisModel, setUsedAnalysisModel] = useState<string | null>(null);
    const [showAnalysisSettings, setShowAnalysisSettings] = useState(true);
    const [precisionTool, setPrecisionTool] = useState<PrecisionMaskTool>("brush");
    const [precisionBrushSize, setPrecisionBrushSize] = useState(36);
    const [precisionEraseMode, setPrecisionEraseMode] = useState(false);
    const [precisionGuidance, setPrecisionGuidance] = useState("");
    const [precisionEditorState, setPrecisionEditorState] = useState<PrecisionMaskEditorState>(EMPTY_PRECISION_EDITOR_STATE);
    const [lastPrecisionSnapshot, setLastPrecisionSnapshot] = useState<PrecisionMaskSnapshot | null>(null);
    const [selectedApplyMode, setSelectedApplyMode] = useState<PropertyImageAiApplyMode | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generated, setGenerated] = useState<ImageEnhancementGeneratedResult | null>(null);

    const canRun = useMemo(() => {
        if (!propertyId) return false;
        if (!image) return false;
        return Boolean(image.cloudflareImageId || image.url);
    }, [propertyId, image]);
    const hasPriorPrompt = Boolean(String(priorPrompt || "").trim());
    const effectivePriorPrompt = reusePriorPrompt ? priorPrompt : undefined;
    const stage = generated ? "review" : "edit";
    const isBusy = isAnalyzing || isGenerating || isRemoving;
    const liveFinalPrompt = useMemo(() => {
        if (!analysis) return "";
        return buildGenerationPrompt({
            analysis,
            selectedFixIds,
            removedDetectedElementIds,
            aggression,
            priorPrompt: effectivePriorPrompt,
            userInstructions,
        });
    }, [analysis, selectedFixIds, removedDetectedElementIds, aggression, effectivePriorPrompt, userInstructions]);

    useEffect(() => {
        if (!open) {
            setMode("polish");
            setAnalysis(null);
            setSelectedFixIds([]);
            setRemovedDetectedElementIds([]);
            setAggression("balanced");
            setReusePriorPrompt(hasPriorPrompt);
            setUserInstructions("");
            setSelectedAnalysisModel("");
            setSelectedGenerationModel("");
            setUsedAnalysisModel(null);
            setShowAnalysisSettings(true);
            setPrecisionTool("brush");
            setPrecisionBrushSize(36);
            setPrecisionEraseMode(false);
            setPrecisionGuidance("");
            setPrecisionEditorState(EMPTY_PRECISION_EDITOR_STATE);
            setLastPrecisionSnapshot(null);
            setSelectedApplyMode(null);
            setIsAnalyzing(false);
            setIsGenerating(false);
            setIsRemoving(false);
            setError(null);
            setGenerated(null);
        }
    }, [open, hasPriorPrompt]);

    useEffect(() => {
        if (!open) return;
        setSelectedAnalysisModel((current) => current || modelDefaults.analysis || analysisModels[0]?.value || "");
    }, [open, modelDefaults.analysis, analysisModels]);

    useEffect(() => {
        if (!open) return;
        setSelectedGenerationModel((current) => current || modelDefaults.generation || generationModels[0]?.value || "");
    }, [open, modelDefaults.generation, generationModels]);

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

    function handleModeChange(nextMode: EnhancementMode) {
        if (stage === "review") return;
        setMode(nextMode);
        setError(null);
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
        if (!canRun || !image || !propertyId || !analysis) return;
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
                    analysis,
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

    async function handlePrecisionRemove(snapshotOverride?: PrecisionMaskSnapshot | null) {
        if (!canRun || !image || !propertyId) return;

        const snapshot = snapshotOverride || await precisionEditorRef.current?.exportMask();
        if (!snapshot) {
            const message = "Draw a mask before removing content.";
            setError(message);
            toast.error(message);
            return;
        }

        setError(null);
        setIsRemoving(true);

        try {
            const response = await fetch("/api/images/enhance/precision-remove", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId,
                    propertyId,
                    cloudflareImageId: image.cloudflareImageId,
                    sourceUrl: image.url,
                    maskPngBase64: snapshot.maskPngBase64,
                    editorWidth: snapshot.editorWidth,
                    editorHeight: snapshot.editorHeight,
                    guidance: precisionGuidance.trim() || undefined,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to remove selected content."));
            }

            const payload = json as PrecisionRemoveApiResponse;
            setLastPrecisionSnapshot(snapshot);
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
            await handlePrecisionRemove(lastPrecisionSnapshot);
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
        onApplyVariant({
            url: generated.generatedImageUrl,
            cloudflareImageId: generated.generatedImageId,
            applyMode: selectedApplyMode,
            reusablePrompt: generated.reusablePrompt || "",
        });
        toast.success("Enhanced image added. Click Save Property to persist.");
        onOpenChange(false);
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

    function renderPolishControls() {
        return (
            <>
                {hasPriorPrompt ? (
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label className="text-sm font-medium">Reuse Last Approved Prompt</Label>
                            <p className="text-xs text-muted-foreground">
                                Helpful for another angle of the same room so edits stay visually consistent.
                            </p>
                        </div>
                        <Switch checked={reusePriorPrompt} onCheckedChange={setReusePriorPrompt} />
                    </div>
                ) : null}

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
                                    onValueChange={setSelectedAnalysisModel}
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
                        {analysis ? <Badge variant="secondary">Ready</Badge> : null}
                    </div>

                    {!analysis ? (
                        <p className="text-xs text-muted-foreground">
                            Run analysis first so the next step has fix chips and a polished prompt draft to work from.
                        </p>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Generation Model</Label>
                                <AiModelSelect
                                    value={selectedGenerationModel}
                                    models={generationModels}
                                    onValueChange={setSelectedGenerationModel}
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
                    onClick={() => void handlePrecisionRemove()}
                    disabled={!precisionEditorState.isReady || !precisionEditorState.hasMask || isBusy}
                >
                    {isRemoving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Remove Selected Area
                </Button>

                <p className="text-xs text-muted-foreground">Provider: Imagen 3 via shared Vertex AI.</p>
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

                {generated.mode === "polish" && generated.finalPrompt ? (
                    <div className="space-y-2">
                        <Label>Final Prompt Used</Label>
                        <Textarea value={generated.finalPrompt} readOnly className="min-h-[120px] text-xs" />
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

                                            {analysis ? (
                                                <div className="space-y-4 rounded-md border p-4">
                                                    <div className="space-y-1">
                                                        <Label className="text-sm font-medium">Scene Summary</Label>
                                                        <p className="text-sm text-muted-foreground">{analysis.sceneSummary}</p>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium">Suggested Fixes</Label>
                                                        {analysis.suggestedFixes.length === 0 ? (
                                                            <p className="text-sm text-muted-foreground">
                                                                No fixes were suggested. You can still generate with polish mode or use the override instructions.
                                                            </p>
                                                        ) : (
                                                            <div className="flex flex-wrap gap-2">
                                                                {analysis.suggestedFixes.map((fix) => {
                                                                    const active = selectedFixIds.includes(fix.id);
                                                                    return (
                                                                        <button
                                                                            key={fix.id}
                                                                            type="button"
                                                                            onClick={() => toggleFix(fix.id)}
                                                                            className={cn(
                                                                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                                                                active
                                                                                    ? "border-primary bg-primary text-primary-foreground"
                                                                                    : "border-border bg-background text-foreground hover:bg-muted"
                                                                            )}
                                                                        >
                                                                            {fix.label}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {analysis.detectedElements.length > 0 ? (
                                                        <div className="space-y-2">
                                                            <Label className="text-sm font-medium">Detected Elements</Label>
                                                            <div className="flex flex-wrap gap-2">
                                                                {analysis.detectedElements.slice(0, 12).map((item) => {
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
