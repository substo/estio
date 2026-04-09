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
import { FileDown, GripVertical, Languages, Plus, Printer, Save, Sparkles, Star, Trash2 } from "lucide-react";
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
    const sensors = useSensors(useSensor(PointerSensor));

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
                }));
                setDrafts((current) => current.map((draft) => draft.id === generated.id ? generated : draft));
                toast.success("Brochure copy generated");
            } catch (error: any) {
                toast.error(error?.message || "Failed to generate brochure copy");
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
            <DialogContent className="max-w-[95vw] w-[1200px] p-0 gap-0">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>Property Print Designer</DialogTitle>
                    <DialogDescription>
                        Create reusable brochure drafts for {propertyTitle}.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid min-h-[78vh] grid-cols-[260px_1fr]">
                    <div className="border-r bg-muted/20 p-4">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium">Drafts</div>
                                <div className="text-xs text-muted-foreground">{drafts.length} saved</div>
                            </div>
                            <Button type="button" size="sm" variant="outline" onClick={handleCreateDraft} disabled={isPending}>
                                <Plus className="mr-1 h-4 w-4" />
                                New
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {drafts.map((draft) => (
                                <button
                                    key={draft.id}
                                    type="button"
                                    className={`w-full rounded-lg border p-3 text-left transition-colors ${draft.id === selectedDraftId ? "border-primary bg-background" : "bg-background/60 hover:bg-background"}`}
                                    onClick={() => setSelectedDraftId(draft.id)}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="truncate text-sm font-medium">{draft.name}</div>
                                        {draft.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                                    </div>
                                    <div className="mt-2 text-xs text-muted-foreground">
                                        {getPropertyPrintTemplate(draft.templateId).label}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {draft.paperSize} {draft.orientation}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {draft.languages.map((language) => (
                                            <Badge key={language} variant="outline" className="text-[10px]">
                                                {getReplyLanguageLabel(language) || language}
                                            </Badge>
                                        ))}
                                    </div>
                                </button>
                            ))}
                            {drafts.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                    Create a print draft to start designing brochures.
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-col">
                        {selectedDraft ? (
                            <>
                                <div className="border-b px-6 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button type="button" onClick={handleSaveDraft} disabled={isPending}>
                                            <Save className="mr-2 h-4 w-4" />
                                            Save Draft
                                        </Button>
                                        <Button type="button" variant="secondary" onClick={handleGenerate} disabled={isPending}>
                                            <Sparkles className="mr-2 h-4 w-4" />
                                            Generate Copy
                                        </Button>
                                        <Button type="button" variant="outline" onClick={handleMakeDefault} disabled={isPending || selectedDraft.isDefault}>
                                            <Star className="mr-2 h-4 w-4" />
                                            Make Default
                                        </Button>
                                        <Button type="button" variant="outline" asChild disabled={!previewHref}>
                                            <a href={previewHref || "#"} target="_blank" rel="noopener noreferrer">
                                                <Printer className="mr-2 h-4 w-4" />
                                                Preview / Print
                                            </a>
                                        </Button>
                                        <Button type="button" variant="outline" asChild disabled={!pdfHref}>
                                            <a href={pdfHref || "#"} target="_blank" rel="noopener noreferrer">
                                                <FileDown className="mr-2 h-4 w-4" />
                                                PDF
                                            </a>
                                        </Button>
                                        <Button type="button" variant="ghost" onClick={handleDelete} disabled={isPending}>
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete
                                        </Button>
                                    </div>
                                </div>

                                <ScrollArea className="min-h-0 flex-1">
                                    <div className="p-6">
                                        <Tabs defaultValue="setup" className="space-y-6">
                                            <TabsList>
                                                <TabsTrigger value="setup">Setup</TabsTrigger>
                                                <TabsTrigger value="content">Content</TabsTrigger>
                                                <TabsTrigger value="media">Media & Layout</TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="setup" className="space-y-6">
                                                <div className="grid gap-6 md:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label>Draft Name</Label>
                                                        <Input
                                                            value={selectedDraft.name}
                                                            onChange={(event) => updateCurrentDraft((draft) => ({ ...draft, name: event.target.value }))}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Template</Label>
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
                                                    <div className="space-y-2">
                                                        <Label>Paper Size</Label>
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
                                                    <div className="space-y-2">
                                                        <Label>Orientation</Label>
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
                                                    <div className="space-y-3 md:col-span-2">
                                                        <div className="flex items-center gap-2">
                                                            <Languages className="h-4 w-4 text-muted-foreground" />
                                                            <Label>Languages</Label>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {REPLY_LANGUAGE_OPTIONS.map((option) => {
                                                                const active = selectedDraft.languages.includes(option.value);
                                                                return (
                                                                    <button
                                                                        key={option.value}
                                                                        type="button"
                                                                        className={`rounded-full border px-3 py-1 text-sm ${active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
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
                                                    <div className="space-y-2 md:col-span-2">
                                                        <Label>AI Tone Instructions</Label>
                                                        <Textarea
                                                            rows={4}
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
                                                    <div className="space-y-3 md:col-span-2">
                                                        <Label>Visible Sections</Label>
                                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                                                                <label key={key} className="flex items-center gap-2 rounded-md border p-3 text-sm">
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
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Accent Color</Label>
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
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="content" className="space-y-6">
                                                <div className="grid gap-6">
                                                    <div className="grid gap-6 md:grid-cols-2">
                                                        <div className="space-y-2">
                                                            <Label>Brochure Title</Label>
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
                                                        <div className="space-y-2">
                                                            <Label>Brochure Subtitle</Label>
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
                                                    <div className="space-y-2">
                                                        <Label>Feature Bullets</Label>
                                                        <Textarea
                                                            rows={4}
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
                                                    <div className="grid gap-6 md:grid-cols-2">
                                                        <div className="space-y-2">
                                                            <Label>Footer Note</Label>
                                                            <Textarea
                                                                rows={3}
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
                                                        <div className="space-y-2">
                                                            <Label>Contact CTA</Label>
                                                            <Textarea
                                                                rows={3}
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
                                                        <Label>Language Blocks</Label>
                                                        {selectedDraft.languages.map((language) => {
                                                            const languageBlock = generatedContent.languages.find((item) => item.language === language) || {
                                                                language,
                                                                label: getReplyLanguageLabel(language) || language,
                                                                title: "",
                                                                subtitle: "",
                                                                body: "",
                                                            };
                                                            return (
                                                                <div key={language} className="rounded-lg border p-4 space-y-4">
                                                                    <div className="text-sm font-medium">{languageBlock.label}</div>
                                                                    <div className="grid gap-4 md:grid-cols-2">
                                                                        <div className="space-y-2">
                                                                            <Label>Title</Label>
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
                                                                        <div className="space-y-2">
                                                                            <Label>Subtitle</Label>
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
                                                                    <div className="space-y-2">
                                                                        <Label>Body</Label>
                                                                        <Textarea
                                                                            rows={7}
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
                                            </TabsContent>

                                            <TabsContent value="media" className="space-y-6">
                                                <div className="space-y-2">
                                                    <Label>Selected Images</Label>
                                                    <div className="text-sm text-muted-foreground">
                                                        This template supports up to {template.imageSlots} images. Drag to reorder the selected set.
                                                    </div>
                                                </div>
                                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                                    <SortableContext items={selectedDraft.selectedMediaIds} strategy={rectSortingStrategy}>
                                                        <div className="space-y-3">
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

                                                <div className="space-y-3">
                                                    <Label>Available Property Photos</Label>
                                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                                        {imageMedia.map((image) => {
                                                            const active = selectedDraft.selectedMediaIds.includes(image.id);
                                                            return (
                                                                <button
                                                                    key={image.id}
                                                                    type="button"
                                                                    className={`overflow-hidden rounded-lg border text-left ${active ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/40"}`}
                                                                    onClick={() => handleImageSelection(image.id)}
                                                                >
                                                                    <div className="relative h-36 bg-muted">
                                                                        {image.cloudflareImageId ? (
                                                                            <CloudflareImage imageId={image.cloudflareImageId} alt="Property image" fill className="object-cover" />
                                                                        ) : (
                                                                            <img src={image.url || ""} alt="Property image" className="h-full w-full object-cover" />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center justify-between px-3 py-2 text-sm">
                                                                        <span>{active ? "Selected" : "Click to add"}</span>
                                                                        <Badge variant={active ? "secondary" : "outline"}>{image.id.slice(-4)}</Badge>
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
