"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import type {
    EnhancementAggression,
    EnhancementModelTier,
    ImageEnhancementAnalysis,
} from "@/lib/ai/property-image-enhancement-types";

interface PropertyImageLike {
    url: string;
    cloudflareImageId?: string;
    kind: string;
    sortOrder: number;
}

interface GeneratedVariantPayload {
    url: string;
    cloudflareImageId: string;
    setAsPrimary: boolean;
}

interface PropertyImageEnhanceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
    propertyId?: string;
    image: PropertyImageLike | null;
    imageIndex: number;
    priorPrompt?: string;
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
    model: string;
}

function getModelTier(proEnabled: boolean): EnhancementModelTier {
    return proEnabled ? "nano_banana_pro" : "nano_banana_2";
}

export function PropertyImageEnhanceDialog({
    open,
    onOpenChange,
    locationId,
    propertyId,
    image,
    imageIndex,
    priorPrompt,
    onApplyVariant,
}: PropertyImageEnhanceDialogProps) {
    const [analysis, setAnalysis] = useState<ImageEnhancementAnalysis | null>(null);
    const [selectedFixIds, setSelectedFixIds] = useState<string[]>([]);
    const [aggression, setAggression] = useState<EnhancementAggression>("balanced");
    const [proEnabled, setProEnabled] = useState(false);
    const [setAsPrimary, setSetAsPrimary] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [analysisModel, setAnalysisModel] = useState<string | null>(null);
    const [generated, setGenerated] = useState<GenerateApiResponse | null>(null);

    const canRun = useMemo(() => {
        if (!propertyId) return false;
        if (!image) return false;
        return Boolean(image.cloudflareImageId || image.url);
    }, [propertyId, image]);

    useEffect(() => {
        if (!open) {
            setAnalysis(null);
            setSelectedFixIds([]);
            setAggression("balanced");
            setProEnabled(false);
            setSetAsPrimary(false);
            setIsAnalyzing(false);
            setIsGenerating(false);
            setError(null);
            setAnalysisModel(null);
            setGenerated(null);
        }
    }, [open]);

    const toggleFix = (fixId: string) => {
        setSelectedFixIds((prev) => (
            prev.includes(fixId)
                ? prev.filter((id) => id !== fixId)
                : [...prev, fixId]
        ));
    };

    async function handleAnalyze() {
        if (!canRun || !image || !propertyId) return;

        setError(null);
        setGenerated(null);
        setIsAnalyzing(true);

        try {
            const modelTier = getModelTier(proEnabled);
            const response = await fetch("/api/images/enhance/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId,
                    propertyId,
                    cloudflareImageId: image.cloudflareImageId,
                    sourceUrl: image.url,
                    modelTier,
                    priorPrompt,
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
            setAnalysisModel(payload.model);
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

        setError(null);
        setIsGenerating(true);

        try {
            const modelTier = getModelTier(proEnabled);
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
                    aggression,
                    modelTier,
                    priorPrompt,
                }),
            });

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(String(json?.error || "Failed to generate enhanced image."));
            }

            setGenerated(json as GenerateApiResponse);
        } catch (err) {
            console.error("[PropertyImageEnhanceDialog] generate error:", err);
            const message = err instanceof Error ? err.message : "Failed to generate enhanced image.";
            setError(message);
            toast.error(message);
        } finally {
            setIsGenerating(false);
        }
    }

    function handleApplyVariant() {
        if (!generated) return;
        onApplyVariant({
            url: generated.generatedImageUrl,
            cloudflareImageId: generated.generatedImageId,
            setAsPrimary,
        });
        toast.success("Enhanced image added. Click Save Property to persist.");
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        AI Enhance Listing Photo
                    </DialogTitle>
                    <DialogDescription>
                        Step 1 analyzes issues as selectable chips. Step 2 generates a polished variant.
                    </DialogDescription>
                </DialogHeader>

                {!canRun && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Save the property first and use a hosted image to enable AI enhancement.
                    </div>
                )}

                {canRun && image && (
                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Source Photo</Label>
                                <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                                    {image.cloudflareImageId ? (
                                        <CloudflareImage
                                            imageId={image.cloudflareImageId}
                                            alt={`Source image ${imageIndex + 1}`}
                                            variant="public"
                                            width={960}
                                            height={540}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <img
                                            src={image.url}
                                            alt={`Source image ${imageIndex + 1}`}
                                            className="h-full w-full object-cover"
                                        />
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4 rounded-md border p-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label className="text-sm font-medium">Nano Banana Pro</Label>
                                        <p className="text-xs text-muted-foreground">
                                            Use higher-quality model for analysis and generation.
                                        </p>
                                    </div>
                                    <Switch checked={proEnabled} onCheckedChange={setProEnabled} />
                                </div>

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

                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        onClick={handleAnalyze}
                                        disabled={isAnalyzing || isGenerating}
                                    >
                                        {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        {analysis ? "Re-analyze Photo" : "Analyze Photo"}
                                    </Button>

                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleGenerate}
                                        disabled={!analysis || isAnalyzing || isGenerating}
                                    >
                                        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Generate Enhanced Image
                                    </Button>
                                </div>

                                {analysisModel ? (
                                    <p className="text-xs text-muted-foreground">Step 1 model: {analysisModel}</p>
                                ) : null}
                            </div>
                        </div>

                        {error ? (
                            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                {error}
                            </div>
                        ) : null}

                        {analysis ? (
                            <div className="space-y-4 rounded-md border p-4">
                                <div className="space-y-1">
                                    <Label className="text-sm font-medium">Scene Summary</Label>
                                    <p className="text-sm text-muted-foreground">{analysis.sceneSummary}</p>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Suggested Fixes (toggle chips)</Label>
                                    {analysis.suggestedFixes.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No fixes were suggested. You can still generate with polish mode.</p>
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
                                            {analysis.detectedElements.slice(0, 12).map((item) => (
                                                <Badge key={item.id} variant="outline" className="gap-1">
                                                    {item.label}
                                                    <span className="text-[10px] text-muted-foreground">({item.severity})</span>
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Prompt Polish Preview</Label>
                                    <Textarea value={analysis.promptPolish} readOnly className="min-h-[90px] text-xs" />
                                </div>
                            </div>
                        ) : null}

                        {generated ? (
                            <div className="space-y-4 rounded-md border p-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label>Generated Variant</Label>
                                        <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                                            <img
                                                src={generated.generatedImageUrl}
                                                alt="Generated enhanced listing image"
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="space-y-1">
                                            <Label>Action Log</Label>
                                            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                                                {generated.actionLog.length > 0 ? (
                                                    generated.actionLog.map((line, idx) => (
                                                        <li key={`${idx}-${line}`}>{line}</li>
                                                    ))
                                                ) : (
                                                    <li>Generated with selected enhancement settings.</li>
                                                )}
                                            </ul>
                                        </div>
                                        <p className="text-xs text-muted-foreground">Generation model: {generated.model}</p>
                                        <div className="flex items-center justify-between rounded-md border p-2">
                                            <div>
                                                <Label className="text-sm font-medium">Set as primary on save</Label>
                                                <p className="text-xs text-muted-foreground">
                                                    Place this variant first in the media order.
                                                </p>
                                            </div>
                                            <Switch checked={setAsPrimary} onCheckedChange={setSetAsPrimary} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button
                        type="button"
                        onClick={handleApplyVariant}
                        disabled={!generated}
                    >
                        Add Variant To Property
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
