"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileDown, GripVertical, Languages, Loader2, Plus, Printer, Save, Sparkles, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import { AiModelSelect } from "@/components/ai/ai-model-select";
import { useAiModelCatalog } from "@/components/ai/use-ai-model-catalog";
import {
    createPropertyPrintDraft,
    deletePropertyPrintDraft,
    generatePropertyPrintDraftCopy,
    savePropertyPrintDraft,
    setDefaultPropertyPrintDraft,
} from "@/app/(main)/admin/properties/print-actions";
import {
    DEFAULT_PROPERTY_PRINT_DESIGN_SETTINGS,
    DEFAULT_PROPERTY_PRINT_GENERATED_CONTENT,
    DEFAULT_PROPERTY_PRINT_PROMPT_SETTINGS,
    PROPERTY_PRINT_TEMPLATES,
    getPropertyPrintTemplate,
    normalizePropertyPrintDesignSettings,
    normalizePropertyPrintGeneratedContent,
    normalizePropertyPrintLanguages,
    normalizePropertyPrintPromptSettings,
    buildPrintLayoutPreviewDescriptor,
    type PropertyPrintPaperSize,
    type PropertyPrintOrientation,
} from "@/lib/properties/print-designer";
import { REPLY_LANGUAGE_OPTIONS, getReplyLanguageLabel } from "@/lib/ai/reply-language-options";

type PropertyImage = {
    id: string;
    url?: string | null;
    cloudflareImageId?: string | null;
    kind: string;
    sortOrder?: number | null;
};

type DraftLike = {
    id: string;
    name: string;
    templateId: string;
    paperSize: string;
    orientation: "portrait" | "landscape";
    languages: string[];
    selectedMediaIds: string[];
    isDefault: boolean;
    designSettings?: unknown;
    promptSettings?: unknown;
    generatedContent?: unknown;
    generationMetadata?: any;
};

function SortableSelectedImage({
    image,
    selected,
    onRemove,
}: {
    image: PropertyImage;
    selected: boolean;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: image.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-3 rounded-md border bg-background p-2"
        >
            <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                {...attributes}
                {...listeners}
                aria-label="Reorder image"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <div className="relative h-14 w-20 overflow-hidden rounded border bg-muted">
                {image.cloudflareImageId ? (
                    <CloudflareImage imageId={image.cloudflareImageId} alt="Selected property image" fill className="object-cover" />
                ) : (
                    <img src={image.url || ""} alt="Selected property image" className="h-full w-full object-cover" />
                )}
            </div>
            <div className="flex-1 text-sm text-muted-foreground">
                {selected ? "Selected for brochure" : "Available"}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRemove}>
                Remove
            </Button>
        </div>
    );
}

function PrintLayoutPreviewThumbnail({
    templateId,
    paperSize,
    orientation,
    designSettings,
    languages,
    selectedImageCount,
}: {
    templateId: string;
    paperSize: string;
    orientation: "portrait" | "landscape";
    designSettings: unknown;
    languages: string[];
    selectedImageCount: number;
}) {
    const settings = normalizePropertyPrintDesignSettings(designSettings);
    const descriptor = buildPrintLayoutPreviewDescriptor(
        templateId,
        paperSize as PropertyPrintPaperSize,
        orientation as PropertyPrintOrientation,
        settings,
        languages,
        selectedImageCount,
    );

    const aspectRatio = descriptor.widthMm / descriptor.heightMm;
    const maxW = 180;
    const maxH = 220;
    let w: number;
    let h: number;
    if (aspectRatio > 1) {
        w = maxW;
        h = maxW / aspectRatio;
    } else {
        h = maxH;
        w = maxH * aspectRatio;
    }

    const isLandscape = orientation === "landscape";
    const showHero = descriptor.hasHeroImage;
    const showLangs = descriptor.visibleSections.includes("languages");
    const showFacts = descriptor.visibleSections.includes("facts");
    const showFooter = descriptor.visibleSections.includes("footer");
    const showLogo = descriptor.visibleSections.includes("logo");

    return (
        <div className="flex flex-col items-center gap-2">
            <div
                className="relative overflow-hidden rounded border-2 border-border bg-white shadow-sm transition-all"
                style={{ width: `${w}px`, height: `${h}px` }}
            >
                {/* Logo area */}
                {showLogo ? (
                    <div className="absolute right-2 top-2 h-2 w-8 rounded-sm bg-slate-300" />
                ) : null}

                {/* Hero image placeholder */}
                {showHero ? (
                    <div
                        className={`absolute bg-slate-200 ${isLandscape ? "left-0 top-0 h-full w-[55%]" : "left-0 top-0 h-[45%] w-[55%]"}`}
                    >
                        <div className="flex h-full w-full items-center justify-center">
                            <div className="h-3 w-5 rounded-sm bg-slate-300" />
                        </div>
                    </div>
                ) : null}

                {/* Text column area */}
                <div
                    className={`absolute flex flex-col gap-1 ${isLandscape ? "right-2 top-3 w-[38%]" : "right-2 top-2 w-[38%]"}`}
                >
                    {/* Title */}
                    <div className="h-1.5 w-full rounded-sm bg-slate-400" />
                    <div className="h-1 w-3/4 rounded-sm bg-slate-300" />

                    {/* Facts */}
                    {showFacts ? (
                        <div className="mt-1 flex gap-0.5">
                            <div className="h-1 w-3 rounded-sm bg-slate-200" />
                            <div className="h-1 w-3 rounded-sm bg-slate-200" />
                            <div className="h-1 w-3 rounded-sm bg-slate-200" />
                        </div>
                    ) : null}

                    {/* Language blocks */}
                    {showLangs ? (
                        <>
                            {Array.from({ length: Math.min(descriptor.languageCount, 2) }).map((_, i) => (
                                <div key={i} className="mt-1 space-y-0.5">
                                    <div className="h-1 w-4 rounded-sm bg-primary/40" />
                                    <div className="h-0.5 w-full rounded-sm bg-slate-200" />
                                    <div className="h-0.5 w-5/6 rounded-sm bg-slate-200" />
                                </div>
                            ))}
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                {showFooter ? (
                    <div className="absolute bottom-1 left-2 right-2 h-1 rounded-sm bg-slate-200" />
                ) : null}

                {/* Supporting images */}
                {descriptor.imageSlots > 1 && showHero ? (
                    <div
                        className={`absolute flex gap-0.5 ${isLandscape ? "bottom-1 left-1 w-[52%]" : "bottom-6 left-1 right-1 w-auto"}`}
                    >
                        {Array.from({ length: Math.min(descriptor.imageSlots - 1, 3) }).map((_, i) => (
                            <div key={i} className="h-3 flex-1 rounded-sm bg-slate-200" />
                        ))}
                    </div>
                ) : null}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">
                    {paperSize} {orientation}
                </Badge>
                <span>{descriptor.templateLabel}</span>
            </div>
        </div>
    );
}

function normalizeDraft(draft: any): DraftLike {
    return {
        ...draft,
        orientation: draft?.orientation === "landscape" ? "landscape" : "portrait",
        languages: normalizePropertyPrintLanguages(draft.languages),
        selectedMediaIds: Array.isArray(draft.selectedMediaIds) ? draft.selectedMediaIds : [],
        designSettings: normalizePropertyPrintDesignSettings(draft.designSettings),
        promptSettings: normalizePropertyPrintPromptSettings(draft.promptSettings),
        generatedContent: normalizePropertyPrintGeneratedContent(draft.generatedContent),
    };
}

export function PropertyPrintDesignerDialog({
    propertyId,
    locationId,
    propertyTitle,
    media,
    initialDrafts,
}: {
    propertyId: string;
    locationId: string;
    propertyTitle: string;
    media: PropertyImage[];
    initialDrafts: DraftLike[];
}) {
    const [open, setOpen] = useState(false);
    const [drafts, setDrafts] = useState(() => initialDrafts.map(normalizeDraft));
    const [selectedDraftId, setSelectedDraftId] = useState<string | null>(initialDrafts.find((draft) => draft.isDefault)?.id || initialDrafts[0]?.id || null);
    const [isPending, startTransition] = useTransition();
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("setup");
    const sensors = useSensors(useSensor(PointerSensor));

    // Shared AI model catalog
    const { models: availableModels, resolveModelForKind, loading: modelCatalogLoading } = useAiModelCatalog();
    const [selectedModel, setSelectedModel] = useState<string>("");

    const selectedDraft = useMemo(() => drafts.find((draft) => draft.id === selectedDraftId) || null, [drafts, selectedDraftId]);
    const template = getPropertyPrintTemplate(selectedDraft?.templateId);
    const imageMedia = useMemo(
        () => [...media].filter((item) => item.kind === "IMAGE").sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
        [media]
    );

    const selectedImages = useMemo(() => {
        if (!selectedDraft) return [];
        return selectedDraft.selectedMediaIds
            .map((id) => imageMedia.find((image) => image.id === id))
            .filter(Boolean) as PropertyImage[];
    }, [imageMedia, selectedDraft]);

    // Resolve model when catalog loads or draft changes
    const resolvedModel = useMemo(() => {
        if (!selectedDraft) return "";
        const draftModelOverride = normalizePropertyPrintPromptSettings(selectedDraft.promptSettings).modelOverride;
        if (draftModelOverride && availableModels.some((m) => m.value === draftModelOverride)) return draftModelOverride;
        return resolveModelForKind("design");
    }, [selectedDraft, availableModels, resolveModelForKind]);

    // Sync selected model when resolved model changes
    useMemo(() => {
        if (resolvedModel && !selectedModel) setSelectedModel(resolvedModel);
    }, [resolvedModel]);

    const handleModelChange = (value: string) => {
        setSelectedModel(value);
        if (selectedDraft) {
            updateCurrentDraft((draft) => ({
                ...draft,
                promptSettings: {
                    ...normalizePropertyPrintPromptSettings(draft.promptSettings),
                    modelOverride: value,
                },
            }));
        }
    };

    const updateCurrentDraft = (updater: (draft: DraftLike) => DraftLike) => {
        if (!selectedDraftId) return;
        setDrafts((current) => current.map((draft) => draft.id === selectedDraftId ? updater(draft) : draft));
    };

    const handleCreateDraft = () => {
        startTransition(async () => {
            try {
                const created = normalizeDraft(await createPropertyPrintDraft({ propertyId, locationId }));
                setDrafts((current) => [created, ...current]);
                setSelectedDraftId(created.id);
                toast.success("Print draft created");
            } catch (error: any) {
                toast.error(error?.message || "Failed to create print draft");
            }
        });
    };

    const handleSaveDraft = () => {
        if (!selectedDraft) return;
        startTransition(async () => {
            try {
                const saved = normalizeDraft(await savePropertyPrintDraft({
                    draftId: selectedDraft.id,
                    propertyId,
                    locationId,
                    name: selectedDraft.name,
                    templateId: selectedDraft.templateId,
                    paperSize: selectedDraft.paperSize,
                    orientation: selectedDraft.orientation,
                    languages: selectedDraft.languages,
                    selectedMediaIds: selectedDraft.selectedMediaIds,
                    isDefault: selectedDraft.isDefault,
                    designSettings: selectedDraft.designSettings,
                    promptSettings: selectedDraft.promptSettings,
                    generatedContent: selectedDraft.generatedContent,
                    generationMetadata: selectedDraft.generationMetadata,
                }));
                setDrafts((current) => current.map((draft) => draft.id === saved.id ? saved : draft));
                toast.success("Print draft saved");
            } catch (error: any) {
                toast.error(error?.message || "Failed to save print draft");
            }
        });
    };

    const handleGenerate = () => {
        if (!selectedDraft) return;
        setGenerateError(null);
        setIsGenerating(true);
        setActiveTab("content");

        startTransition(async () => {
            try {
                await savePropertyPrintDraft({
                    draftId: selectedDraft.id,
                    propertyId,
                    locationId,
                    name: selectedDraft.name,
                    templateId: selectedDraft.templateId,
                    paperSize: selectedDraft.paperSize,
                    orientation: selectedDraft.orientation,
                    languages: selectedDraft.languages,
                    selectedMediaIds: selectedDraft.selectedMediaIds,
                    isDefault: selectedDraft.isDefault,
                    designSettings: selectedDraft.designSettings,
                    promptSettings: selectedDraft.promptSettings,
                    generatedContent: selectedDraft.generatedContent,
                    generationMetadata: selectedDraft.generationMetadata,
                });

                const generated = normalizeDraft(await generatePropertyPrintDraftCopy({
                    draftId: selectedDraft.id,
                    propertyId,
                    locationId,
                    modelOverride: selectedModel || undefined,
                }));
                setDrafts((current) => current.map((draft) => draft.id === generated.id ? generated : draft));
                setIsGenerating(false);
                toast.success("Brochure copy generated");
            } catch (error: any) {
                const message = error?.message || "Failed to generate brochure copy";
                setGenerateError(message);
                setIsGenerating(false);
                toast.error(message);
            }
        });
    };

    const handleDelete = () => {
        if (!selectedDraft) return;
        startTransition(async () => {
            try {
                await deletePropertyPrintDraft({ draftId: selectedDraft.id, propertyId, locationId });
                setDrafts((current) => {
                    const next = current.filter((draft) => draft.id !== selectedDraft.id);
                    setSelectedDraftId(next[0]?.id || null);
                    return next;
                });
                toast.success("Print draft deleted");
            } catch (error: any) {
                toast.error(error?.message || "Failed to delete print draft");
            }
        });
    };

    const handleMakeDefault = () => {
        if (!selectedDraft) return;
        startTransition(async () => {
            try {
                await setDefaultPropertyPrintDraft({ draftId: selectedDraft.id, propertyId, locationId });
                setDrafts((current) => current.map((draft) => ({ ...draft, isDefault: draft.id === selectedDraft.id })));
                toast.success("Default print draft updated");
            } catch (error: any) {
                toast.error(error?.message || "Failed to set default draft");
            }
        });
    };

    const handleLanguageToggle = (code: string) => {
        if (!selectedDraft) return;
        updateCurrentDraft((draft) => {
            const current = new Set(draft.languages);
            if (current.has(code)) current.delete(code);
            else if (current.size < 2) current.add(code);
            return { ...draft, languages: Array.from(current) };
        });
    };

    const handleImageSelection = (imageId: string) => {
        if (!selectedDraft) return;
        updateCurrentDraft((draft) => {
            const exists = draft.selectedMediaIds.includes(imageId);
            const next = exists
                ? draft.selectedMediaIds.filter((id) => id !== imageId)
                : [...draft.selectedMediaIds, imageId].slice(0, template.imageSlots);
            return { ...draft, selectedMediaIds: next };
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !selectedDraft) return;

        const oldIndex = selectedDraft.selectedMediaIds.findIndex((id) => id === active.id);
        const newIndex = selectedDraft.selectedMediaIds.findIndex((id) => id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;

        updateCurrentDraft((draft) => ({
            ...draft,
            selectedMediaIds: arrayMove(draft.selectedMediaIds, oldIndex, newIndex),
        }));
    };

    const previewHref = selectedDraft ? `/admin/properties/${propertyId}/print/${selectedDraft.id}` : null;
    const pdfHref = selectedDraft ? `/admin/properties/${propertyId}/print/${selectedDraft.id}/pdf` : null;
    const generatedContent = normalizePropertyPrintGeneratedContent(selectedDraft?.generatedContent || DEFAULT_PROPERTY_PRINT_GENERATED_CONTENT);
    const promptSettings = normalizePropertyPrintPromptSettings(selectedDraft?.promptSettings || DEFAULT_PROPERTY_PRINT_PROMPT_SETTINGS);
    const designSettings = normalizePropertyPrintDesignSettings(selectedDraft?.designSettings || DEFAULT_PROPERTY_PRINT_DESIGN_SETTINGS);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">
                    <Printer className="mr-2 h-4 w-4" />
                    Print Designer
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[95vw] w-[1200px] h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden p-0 gap-0 flex flex-col">
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle>Property Print Designer</DialogTitle>
                    <DialogDescription>
                        Create reusable brochure drafts for {propertyTitle}.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 overflow-hidden">
                    {/* Draft Rail — independently scrollable */}
                    <div className="flex flex-col w-[240px] shrink-0 border-r bg-muted/20 overflow-hidden">
                        <div className="shrink-0 border-b px-4 py-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-medium">Drafts</div>
                                    <div className="text-xs text-muted-foreground">{drafts.length} saved</div>
                                </div>
                                <Button type="button" size="sm" variant="outline" onClick={handleCreateDraft} disabled={isPending}>
                                    <Plus className="mr-1 h-3 w-3" />
                                    New
                                </Button>
                            </div>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="space-y-1.5 p-3">
                                {drafts.map((draft) => (
                                    <button
                                        key={draft.id}
                                        type="button"
                                        className={`w-full rounded-lg border p-2.5 text-left transition-colors ${draft.id === selectedDraftId ? "border-primary ring-2 ring-primary/20 bg-background" : "bg-background/60 hover:bg-background"}`}
                                        onClick={() => setSelectedDraftId(draft.id)}
                                    >
                                        <div className="flex items-center justify-between gap-1.5">
                                            <div className="truncate text-sm font-medium">{draft.name}</div>
                                            {draft.isDefault ? (
                                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                                    <Star className="mr-0.5 h-2.5 w-2.5 fill-current" />
                                                    Default
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-1.5">
                                            <Badge variant="outline" className="text-[10px]">
                                                {draft.paperSize} {draft.orientation === "landscape" ? "L" : "P"}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground truncate">
                                                {getPropertyPrintTemplate(draft.templateId).label}
                                            </span>
                                        </div>
                                        {draft.languages.length > 0 ? (
                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                {draft.languages.map((language) => (
                                                    <Badge key={language} variant="outline" className="text-[10px]">
                                                        {getReplyLanguageLabel(language) || language}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : null}
                                    </button>
                                ))}
                                {drafts.length === 0 ? (
                                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                        Create a print draft to start designing brochures.
                                    </div>
                                ) : null}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Main editor pane */}
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        {selectedDraft ? (
                            <>
                                {/* Sticky action bar */}
                                <div className="shrink-0 border-b px-5 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-2">
                                            <Button type="button" size="sm" onClick={handleSaveDraft} disabled={isPending}>
                                                <Save className="mr-1.5 h-3.5 w-3.5" />
                                                Save Draft
                                            </Button>
                                            <Button type="button" size="sm" variant="secondary" onClick={handleGenerate} disabled={isPending || isGenerating}>
                                                {isGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                                                Generate Copy
                                            </Button>
                                        </div>
                                        <div className="flex-1" />
                                        <div className="flex items-center gap-1.5">
                                            <Button type="button" size="sm" variant="outline" asChild disabled={!previewHref}>
                                                <a href={previewHref || "#"} target="_blank" rel="noopener noreferrer">
                                                    <Printer className="mr-1.5 h-3.5 w-3.5" />
                                                    Preview
                                                </a>
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" asChild disabled={!pdfHref}>
                                                <a href={pdfHref || "#"} target="_blank" rel="noopener noreferrer">
                                                    <FileDown className="mr-1.5 h-3.5 w-3.5" />
                                                    PDF
                                                </a>
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" onClick={handleMakeDefault} disabled={isPending || selectedDraft.isDefault}>
                                                <Star className="mr-1.5 h-3.5 w-3.5" />
                                                Default
                                            </Button>
                                            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete} disabled={isPending}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Scrollable tab content */}
                                <ScrollArea className="min-h-0 flex-1">
                                    <div className="p-5">
                                        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
                                            <TabsList>
                                                <TabsTrigger value="setup">Setup</TabsTrigger>
                                                <TabsTrigger value="content">
                                                    Content
                                                    {isGenerating ? <Loader2 className="ml-1.5 h-3 w-3 animate-spin" /> : null}
                                                </TabsTrigger>
                                                <TabsTrigger value="media">Media &amp; Layout</TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="setup" className="space-y-4">
                                                {/* Document card */}
                                                <div className="rounded-lg border p-4 space-y-3">
                                                    <div className="text-sm font-medium text-foreground">Document</div>
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Draft Name</Label>
                                                            <Input
                                                                value={selectedDraft.name}
                                                                onChange={(event) => updateCurrentDraft((draft) => ({ ...draft, name: event.target.value }))}
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Template</Label>
                                                            <Select
                                                                value={selectedDraft.templateId}
                                                                onValueChange={(value) => updateCurrentDraft((draft) => {
                                                                    const nextTemplate = getPropertyPrintTemplate(value);
                                                                    return {
                                                                        ...draft,
                                                                        templateId: value,
                                                                        paperSize: nextTemplate.defaultPaperSize,
                                                                        orientation: nextTemplate.defaultOrientation,
                                                                        selectedMediaIds: draft.selectedMediaIds.slice(0, nextTemplate.imageSlots),
                                                                    };
                                                                })}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {PROPERTY_PRINT_TEMPLATES.map((item) => (
                                                                        <SelectItem key={item.id} value={item.id}>
                                                                            {item.label}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Layout card with inline preview */}
                                                <div className="rounded-lg border p-4 space-y-3">
                                                    <div className="text-sm font-medium text-foreground">Layout</div>
                                                    <div className="flex gap-5">
                                                        <div className="flex-1 grid gap-3 md:grid-cols-2">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Paper Size</Label>
                                                                <Select
                                                                    value={selectedDraft.paperSize}
                                                                    onValueChange={(value) => updateCurrentDraft((draft) => ({ ...draft, paperSize: value }))}
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {template.paperSizes.map((size) => (
                                                                            <SelectItem key={size} value={size}>{size}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Orientation</Label>
                                                                <Select
                                                                    value={selectedDraft.orientation}
                                                                    onValueChange={(value: "portrait" | "landscape") => updateCurrentDraft((draft) => ({ ...draft, orientation: value }))}
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="portrait">Portrait</SelectItem>
                                                                        <SelectItem value="landscape">Landscape</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
                                                        {/* Inline preview thumbnail */}
                                                        <div className="shrink-0">
                                                            <PrintLayoutPreviewThumbnail
                                                                templateId={selectedDraft.templateId}
                                                                paperSize={selectedDraft.paperSize}
                                                                orientation={selectedDraft.orientation}
                                                                designSettings={selectedDraft.designSettings}
                                                                languages={selectedDraft.languages}
                                                                selectedImageCount={selectedImages.length}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Languages card */}
                                                <div className="rounded-lg border p-4 space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <div className="text-sm font-medium text-foreground">Languages</div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {REPLY_LANGUAGE_OPTIONS.map((option) => {
                                                            const active = selectedDraft.languages.includes(option.value);
                                                            return (
                                                                <button
                                                                    key={option.value}
                                                                    type="button"
                                                                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                                                                    onClick={() => handleLanguageToggle(option.value)}
                                                                >
                                                                    {option.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        Choose up to two languages for this brochure.
                                                    </div>
                                                </div>

                                                {/* AI Copy card */}
                                                <div className="rounded-lg border p-4 space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <div className="text-sm font-medium text-foreground">AI Copy</div>
                                                    </div>
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">AI Model</Label>
                                                            <AiModelSelect
                                                                value={selectedModel}
                                                                models={availableModels}
                                                                onValueChange={handleModelChange}
                                                                disabled={isPending || modelCatalogLoading}
                                                                placeholder={modelCatalogLoading ? "Loading models..." : "Select model"}
                                                            />
                                                            <p className="text-xs text-muted-foreground">
                                                                Model used for brochure copy generation.
                                                            </p>
                                                        </div>
                                                        <div className="space-y-1.5 md:col-span-2">
                                                            <Label className="text-xs">Tone Instructions</Label>
                                                            <Textarea
                                                                rows={3}
                                                                value={promptSettings.toneInstructions || ""}
                                                                onChange={(event) => updateCurrentDraft((draft) => ({
                                                                    ...draft,
                                                                    promptSettings: {
                                                                        ...normalizePropertyPrintPromptSettings(draft.promptSettings),
                                                                        toneInstructions: event.target.value,
                                                                    },
                                                                }))}
                                                                placeholder="Optional prompt guidance, e.g. highlight family lifestyle, emphasize sea views, keep wording concise."
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Visibility card */}
                                                <div className="rounded-lg border p-4 space-y-3">
                                                    <div className="text-sm font-medium text-foreground">Visibility</div>
                                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                                        {[
                                                            ["showLogo", "Logo"],
                                                            ["showContact", "Contact"],
                                                            ["showQr", "QR"],
                                                            ["showPrice", "Price"],
                                                            ["showFacts", "Facts"],
                                                            ["showFeatures", "Features"],
                                                            ["showLanguages", "Language Text"],
                                                            ["showFooter", "Footer"],
                                                        ].map(([key, label]) => (
                                                            <label key={key} className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                                                                <Checkbox
                                                                    checked={Boolean((designSettings as any)[key])}
                                                                    onCheckedChange={(checked) => updateCurrentDraft((draft) => ({
                                                                        ...draft,
                                                                        designSettings: {
                                                                            ...normalizePropertyPrintDesignSettings(draft.designSettings),
                                                                            [key]: Boolean(checked),
                                                                        },
                                                                    }))}
                                                                />
                                                                <span>{label}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Accent Color</Label>
                                                        <Input
                                                            value={designSettings.accentColor || ""}
                                                            onChange={(event) => updateCurrentDraft((draft) => ({
                                                                ...draft,
                                                                designSettings: {
                                                                    ...normalizePropertyPrintDesignSettings(draft.designSettings),
                                                                    accentColor: event.target.value,
                                                                },
                                                            }))}
                                                            placeholder="#9d0917"
                                                            className="max-w-[200px]"
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="content" className="space-y-5">
                                                {/* Generation error banner */}
                                                {generateError ? (
                                                    <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                                                        <div className="font-medium">Generation failed</div>
                                                        <div className="mt-1 text-xs">{generateError}</div>
                                                    </div>
                                                ) : null}

                                                {/* Loading state during generation */}
                                                {isGenerating ? (
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                            <div>
                                                                <div className="text-sm font-medium">Generating brochure copy…</div>
                                                                <div className="text-xs text-muted-foreground">
                                                                    {selectedModel ? `Using ${selectedModel}` : "AI is writing your brochure content"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {/* Shimmer placeholders */}
                                                        <div className="space-y-3">
                                                            <div className="h-10 w-3/4 animate-pulse rounded-md bg-muted" />
                                                            <div className="h-10 w-1/2 animate-pulse rounded-md bg-muted" />
                                                            <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
                                                            <div className="h-36 w-full animate-pulse rounded-md bg-muted" />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="grid gap-5">
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Brochure Title</Label>
                                                                <Input
                                                                    value={generatedContent.title}
                                                                    onChange={(event) => updateCurrentDraft((draft) => ({
                                                                        ...draft,
                                                                        generatedContent: {
                                                                            ...normalizePropertyPrintGeneratedContent(draft.generatedContent),
                                                                            title: event.target.value,
                                                                        },
                                                                    }))}
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Brochure Subtitle</Label>
                                                                <Input
                                                                    value={generatedContent.subtitle}
                                                                    onChange={(event) => updateCurrentDraft((draft) => ({
                                                                        ...draft,
                                                                        generatedContent: {
                                                                            ...normalizePropertyPrintGeneratedContent(draft.generatedContent),
                                                                            subtitle: event.target.value,
                                                                        },
                                                                    }))}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Feature Bullets</Label>
                                                            <Textarea
                                                                rows={3}
                                                                value={generatedContent.featureBullets.join("\n")}
                                                                onChange={(event) => updateCurrentDraft((draft) => ({
                                                                    ...draft,
                                                                    generatedContent: {
                                                                        ...normalizePropertyPrintGeneratedContent(draft.generatedContent),
                                                                        featureBullets: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean),
                                                                    },
                                                                }))}
                                                            />
                                                        </div>
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Footer Note</Label>
                                                                <Textarea
                                                                    rows={2}
                                                                    value={generatedContent.footerNote}
                                                                    onChange={(event) => updateCurrentDraft((draft) => ({
                                                                        ...draft,
                                                                        generatedContent: {
                                                                            ...normalizePropertyPrintGeneratedContent(draft.generatedContent),
                                                                            footerNote: event.target.value,
                                                                        },
                                                                    }))}
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Contact CTA</Label>
                                                                <Textarea
                                                                    rows={2}
                                                                    value={generatedContent.contactCta}
                                                                    onChange={(event) => updateCurrentDraft((draft) => ({
                                                                        ...draft,
                                                                        generatedContent: {
                                                                            ...normalizePropertyPrintGeneratedContent(draft.generatedContent),
                                                                            contactCta: event.target.value,
                                                                        },
                                                                    }))}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="space-y-4">
                                                            <Label className="text-xs">Language Blocks</Label>
                                                            {selectedDraft.languages.map((language) => {
                                                                const languageBlock = generatedContent.languages.find((item) => item.language === language) || {
                                                                    language,
                                                                    label: getReplyLanguageLabel(language) || language,
                                                                    title: "",
                                                                    subtitle: "",
                                                                    body: "",
                                                                };
                                                                return (
                                                                    <div key={language} className="rounded-lg border p-4 space-y-3">
                                                                        <div className="text-sm font-medium">{languageBlock.label}</div>
                                                                        <div className="grid gap-3 md:grid-cols-2">
                                                                            <div className="space-y-1.5">
                                                                                <Label className="text-xs">Title</Label>
                                                                                <Input
                                                                                    value={languageBlock.title}
                                                                                    onChange={(event) => updateCurrentDraft((draft) => {
                                                                                        const current = normalizePropertyPrintGeneratedContent(draft.generatedContent);
                                                                                        const others = current.languages.filter((item) => item.language !== language);
                                                                                        return {
                                                                                            ...draft,
                                                                                            generatedContent: {
                                                                                                ...current,
                                                                                                languages: [...others, { ...languageBlock, title: event.target.value }],
                                                                                            },
                                                                                        };
                                                                                    })}
                                                                                />
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <Label className="text-xs">Subtitle</Label>
                                                                                <Input
                                                                                    value={languageBlock.subtitle}
                                                                                    onChange={(event) => updateCurrentDraft((draft) => {
                                                                                        const current = normalizePropertyPrintGeneratedContent(draft.generatedContent);
                                                                                        const others = current.languages.filter((item) => item.language !== language);
                                                                                        return {
                                                                                            ...draft,
                                                                                            generatedContent: {
                                                                                                ...current,
                                                                                                languages: [...others, { ...languageBlock, subtitle: event.target.value }],
                                                                                            },
                                                                                        };
                                                                                    })}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        <div className="space-y-1.5">
                                                                            <Label className="text-xs">Body</Label>
                                                                            <Textarea
                                                                                rows={5}
                                                                                value={languageBlock.body}
                                                                                onChange={(event) => updateCurrentDraft((draft) => {
                                                                                    const current = normalizePropertyPrintGeneratedContent(draft.generatedContent);
                                                                                    const others = current.languages.filter((item) => item.language !== language);
                                                                                    return {
                                                                                        ...draft,
                                                                                        generatedContent: {
                                                                                            ...current,
                                                                                            languages: [...others, { ...languageBlock, body: event.target.value }],
                                                                                        },
                                                                                    };
                                                                                })}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </TabsContent>

                                            <TabsContent value="media" className="space-y-5">
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs">Selected Images</Label>
                                                    <div className="text-sm text-muted-foreground">
                                                        This template supports up to {template.imageSlots} images. Drag to reorder the selected set.
                                                    </div>
                                                </div>
                                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                                    <SortableContext items={selectedDraft.selectedMediaIds} strategy={rectSortingStrategy}>
                                                        <div className="space-y-2">
                                                            {selectedImages.map((image) => (
                                                                <SortableSelectedImage
                                                                    key={image.id}
                                                                    image={image}
                                                                    selected
                                                                    onRemove={() => handleImageSelection(image.id)}
                                                                />
                                                            ))}
                                                            {selectedImages.length === 0 ? (
                                                                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                                                    Select brochure images below.
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </SortableContext>
                                                </DndContext>

                                                <div className="space-y-2">
                                                    <Label className="text-xs">Available Property Photos</Label>
                                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                        {imageMedia.map((image) => {
                                                            const active = selectedDraft.selectedMediaIds.includes(image.id);
                                                            return (
                                                                <button
                                                                    key={image.id}
                                                                    type="button"
                                                                    className={`overflow-hidden rounded-lg border text-left transition-colors ${active ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/40"}`}
                                                                    onClick={() => handleImageSelection(image.id)}
                                                                >
                                                                    <div className="relative h-32 bg-muted">
                                                                        {image.cloudflareImageId ? (
                                                                            <CloudflareImage imageId={image.cloudflareImageId} alt="Property image" fill className="object-cover" />
                                                                        ) : (
                                                                            <img src={image.url || ""} alt="Property image" className="h-full w-full object-cover" />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center justify-between px-3 py-1.5 text-sm">
                                                                        <span>{active ? "Selected" : "Click to add"}</span>
                                                                        <Badge variant={active ? "secondary" : "outline"} className="text-[10px]">{image.id.slice(-4)}</Badge>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </TabsContent>
                                        </Tabs>
                                    </div>
                                </ScrollArea>
                            </>
                        ) : (
                            <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                                Create or select a draft to start the print designer.
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
