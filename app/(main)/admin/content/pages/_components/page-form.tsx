"use client";

import { useState, useActionState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { upsertPage } from "@/app/(main)/admin/content/actions";
import { generateContentFromUrl } from "@/app/(main)/admin/content/ai-actions";
import { useFormStatus } from "react-dom";
import { Loader2, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { getAvailableAiModelsAction } from "@/app/(main)/admin/conversations/actions";
import { BlockEditor } from "./block-editor";

import { PublicBlockRenderer } from "@/app/(public-site)/_components/public-block-renderer";
import { SiteThemeWrapper } from "@/components/site-theme-wrapper";
import { MediaGalleryDialog } from "@/components/media/MediaGalleryDialog";
import { Eye, Edit3 } from "lucide-react";

function SubmitButton() {
    const { pending } = useFormStatus();
    return <Button disabled={pending}>{pending ? "Saving..." : "Save Page"}</Button>;
}

const initialState = {
    message: "",
};

export function PageForm({ initialData, siteConfig }: { initialData?: any; siteConfig?: any }) {
    const [title, setTitle] = useState(initialData?.title || "");
    const [slug, setSlug] = useState(initialData?.slug || "");
    const [previewMode, setPreviewMode] = useState(false);

    // Initialize blocks from JSON or legacy content
    const [blocks, setBlocks] = useState<any[]>(
        initialData?.blocks && Array.isArray(initialData.blocks)
            ? initialData.blocks
            : initialData?.content
                ? [{ type: "text", htmlContent: initialData.content }]
                : []
    );

    const [headerStyle, setHeaderStyle] = useState<string>(initialData?.headerStyle || "");
    const [heroImageUrl, setHeroImageUrl] = useState<string>(initialData?.heroImage || "");
    const [importUrl, setImportUrl] = useState("");
    const [isImporting, setIsImporting] = useState(false);
    const [brandVoiceOverride, setBrandVoiceOverride] = useState("");
    const [extractionModel, setExtractionModel] = useState("gemini-1.5-flash");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    useEffect(() => {
        let mounted = true;
        getAvailableAiModelsAction().then(models => {
            if (mounted && models && models.length > 0) setAvailableModels(models);
        }).catch(err => console.error(err));
        return () => { mounted = false; };
    }, []);

    // @ts-ignore
    const [state, formAction] = useActionState(upsertPage, initialState);

    const handleImport = async () => {
        if (!importUrl) {
            toast.error("Please enter a URL to import.");
            return;
        }

        setIsImporting(true);
        try {
            const result = await generateContentFromUrl(importUrl, undefined, brandVoiceOverride, extractionModel);

            if (result.success) {
                if (result.title) setTitle(result.title);
                if (result.slug) setSlug(result.slug);
                if (result.blocks) {
                    setBlocks(result.blocks);
                } else if (result.content) {
                    // Fallback for legacy text return
                    setBlocks([{ type: "text", htmlContent: result.content }]);
                }
                toast.success("Content imported & structured successfully!");
            } else {
                toast.error(result.error || "Failed to import content.");
            }
        } catch (error) {
            console.error(error);
            toast.error("An unexpected error occurred.");
        } finally {
            setIsImporting(false);
        }
    };

    if (previewMode) {
        return (
            <div className="max-w-4xl space-y-4">
                <div className="flex justify-end bg-slate-100 p-2 rounded-lg">
                    <div className="flex gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPreviewMode(false)}
                        >
                            <Edit3 className="w-4 h-4 mr-2" /> Edit
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            className="bg-white shadow-sm cursor-default"
                        >
                            <Eye className="w-4 h-4 mr-2" /> Live Preview
                        </Button>
                    </div>
                </div>

                <div className="border rounded-xl overflow-hidden bg-slate-50 min-h-[500px] shadow-inner">
                    <div className="bg-white border-b px-4 py-2 text-xs text-muted-foreground flex justify-between">
                        <span>Previewing: {title}</span>
                        <span>{siteConfig?.domain || "Your Domain"}</span>
                    </div>
                    <div className="bg-white">
                        <SiteThemeWrapper siteConfig={siteConfig}>
                            <PublicBlockRenderer blocks={blocks} siteConfig={siteConfig} />
                        </SiteThemeWrapper>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-4xl">
            {/* AI Import Section */}
            <div className="p-4 border rounded-lg bg-slate-50 space-y-4">
                <div className="flex items-center gap-2 text-indigo-600">
                    <Sparkles className="w-5 h-5" />
                    <h3 className="font-medium">AI Page Importer (Gemini 3 Powered)</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                    Enter a URL. Our AI will analyze the structure (Hero, Forms, etc.) and rebuild it using our components.
                </p>

                <div className="flex gap-2">
                    <Input
                        placeholder="https://example.com/source-page"
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        className="bg-white"
                    />
                    <Button onClick={handleImport} disabled={isImporting} variant="default" className="bg-indigo-600 hover:bg-indigo-700">
                        {isImporting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                <span className="hidden sm:inline">Analyzing Structure...</span>
                                <span className="inline sm:hidden">...</span>
                            </>
                        ) : (
                            "Import & Rebuild"
                        )}
                    </Button>
                </div>

                {/* Advanced Options Toggle */}
                <div className="pt-2">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center text-sm text-muted-foreground hover:text-foreground"
                    >
                        {showAdvanced ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                        Advanced Options
                    </button>

                    {showAdvanced && (
                        <div className="mt-3 space-y-2 pl-2 border-l-2 border-slate-200 ml-1">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label className="text-xs uppercase text-muted-foreground">Brand Voice Override (Optional)</Label>
                                    <Input
                                        placeholder="Specific tone for this page..."
                                        value={brandVoiceOverride}
                                        onChange={(e) => setBrandVoiceOverride(e.target.value)}
                                        className="bg-white h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs uppercase text-muted-foreground">Extraction Model</Label>
                                    <select
                                        className="flex h-8 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        value={extractionModel}
                                        onChange={(e) => setExtractionModel(e.target.value)}
                                    >
                                        {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                            <option key={model.value} value={model.value}>
                                                {model.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <form action={formAction} className="space-y-6">
                <input type="hidden" name="id" value={initialData?.id || ""} />

                {/* Hidden input to submit blocks as JSON string */}
                <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
                {/* Keep legacy content field synced with first text block for fallback */}
                <input type="hidden" name="content" value={blocks.find(b => b.type === "text")?.htmlContent || ""} />

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Page Title</Label>
                        <Input
                            name="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                            placeholder="e.g. About Us"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>URL Slug</Label>
                        <Input
                            name="slug"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            required
                            placeholder="e.g. about-us"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="headerStyle">Header Style Override</Label>
                    <select
                        id="headerStyle"
                        name="headerStyle"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={headerStyle}
                        onChange={(e) => setHeaderStyle(e.target.value)}
                    >
                        <option value="">Default (Use Global Setting)</option>
                        <option value="transparent">Transparent (Overlay)</option>
                        <option value="solid">Solid (Background Context)</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                        Controls how the header appears on this specific page.
                    </p>
                </div>

                {headerStyle === 'transparent' && (
                    <div className="space-y-2 p-4 border border-dashed rounded-md bg-slate-50">
                        <Label>Hero Background Image</Label>
                        <input type="hidden" name="heroImage" value={heroImageUrl} />
                        <div className="flex items-center gap-4">
                            {heroImageUrl && (
                                <div className="w-24 h-16 rounded overflow-hidden bg-slate-200 flex-shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={heroImageUrl} alt="Hero Preview" className="w-full h-full object-cover" />
                                </div>
                            )}
                            <MediaGalleryDialog
                                onSelect={(url) => setHeroImageUrl(url)}
                                siteConfig={siteConfig}
                                trigger={<Button type="button" variant="outline">Browse Images</Button>}
                            />
                            {heroImageUrl && (
                                <Button type="button" variant="ghost" size="sm" onClick={() => setHeroImageUrl("")}>Clear</Button>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Required when using Transparent header style.
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4 p-4 border rounded-md bg-slate-50">
                    <div className="col-span-2">
                        <h4 className="font-medium text-sm mb-2">SEO Settings</h4>
                    </div>
                    <div className="space-y-2">
                        <Label>Meta Title (SEO)</Label>
                        <Input
                            name="metaTitle"
                            defaultValue={initialData?.metaTitle || ""}
                            placeholder="Leave blank to use Page Title"
                        />
                    </div>
                    <div className="space-y-2 col-span-2">
                        <Label>Meta Description (SEO)</Label>
                        <Input
                            name="metaDescription"
                            defaultValue={initialData?.metaDescription || ""}
                            placeholder="Short description for search engines"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Page Content Blocks</Label>
                        {/* Add Block Dropdown could go here */}
                    </div>

                    <BlockEditor
                        blocks={blocks}
                        onChange={setBlocks}
                        onPreview={() => setPreviewMode(true)}
                        siteConfig={siteConfig}
                    />
                </div>

                <div className="flex items-center space-x-2">
                    <Switch name="published" defaultChecked={initialData?.published} id="published" />
                    <Label htmlFor="published">Publish to live site</Label>
                </div>

                {state?.message && (
                    <div className="p-3 rounded bg-red-100 border border-red-200 text-red-700 text-sm">
                        {state.message}
                    </div>
                )}

                <SubmitButton />
            </form>
        </div>
    );
}
