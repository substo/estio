"use client";

import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HtmlInput } from "./html-input"; // New Import
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, Edit3, Trash2, GripVertical, ChevronDown, ChevronUp, Plus, X, Sparkles, Send, Loader2, Code, FileJson, AlertTriangle, Check, Image as ImageIcon } from "lucide-react";
import { refineBlockContent, regeneratePageDesign, generateSectionFromPrompt } from "@/app/(main)/admin/content/ai-actions";
import { getAvailableAiModelsAction } from "@/app/(main)/admin/conversations/actions";
import { toast } from "sonner";
import { GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { CloudflareImageUploader } from "@/components/media/CloudflareImageUploader";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { MediaGalleryDialog } from "@/components/media/MediaGalleryDialog";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface Block {
    type: "hero" | "text" | "form" | "features" | "feature-section" | "testimonials" | "pricing" | "accordion" | "stats" | "gallery" | "cta" | "featured-properties" | "trusted-partners" | "categories";
    [key: string]: any;
}

interface BlockEditorProps {
    blocks: Block[];
    onChange: (blocks: Block[]) => void;
    onPreview: () => void;
    siteConfig: any;
}

const BlockStyleControls = ({ styles, onChange, siteConfig, blockType }: { styles: any, onChange: (styles: any) => void, siteConfig?: any, blockType?: string }) => {
    const primaryColor = siteConfig?.theme?.primaryColor;
    const secondaryColor = siteConfig?.theme?.secondaryColor;

    const ColorSwatch = ({ color, onClick }: { color: string, onClick: () => void }) => (
        <div
            className="w-6 h-6 rounded-full border border-slate-200 cursor-pointer shadow-sm hover:scale-110 transition-transform"
            style={{ backgroundColor: color }}
            onClick={onClick}
            title="Use Site Color"
        />
    );
    return (
        <div className="space-y-3 pt-4 mt-4 border-t border-slate-100">
            <div className="flex items-center gap-2">
                <Edit3 className="w-3 h-3 text-slate-400" />
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Appearance (Manual Overrides)</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                        <Label className="text-xs text-slate-600">Background Color</Label>
                        {primaryColor && <div className="flex gap-1">
                            <ColorSwatch color={primaryColor} onClick={() => onChange({ ...styles, backgroundColor: primaryColor })} />
                            {secondaryColor && <ColorSwatch color={secondaryColor} onClick={() => onChange({ ...styles, backgroundColor: secondaryColor })} />}
                        </div>}
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="relative w-8 h-8 rounded-md overflow-hidden border shadow-sm">
                            <input
                                type="color"
                                className="absolute inset-[-4px] w-[200%] h-[200%] cursor-pointer p-0 m-0 border-none"
                                value={styles?.backgroundColor || "#ffffff"}
                                onChange={(e) => onChange({ ...styles, backgroundColor: e.target.value })}
                            />
                        </div>
                        <Input
                            className="h-8 text-xs font-mono"
                            placeholder="hex (e.g. #ffffff)"
                            value={styles?.backgroundColor || ""}
                            onChange={(e) => onChange({ ...styles, backgroundColor: e.target.value })}
                        />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs text-slate-600">Text Color</Label>
                    <div className="flex gap-2 items-center">
                        <div className="relative w-8 h-8 rounded-md overflow-hidden border shadow-sm">
                            <input
                                type="color"
                                className="absolute inset-[-4px] w-[200%] h-[200%] cursor-pointer p-0 m-0 border-none"
                                value={styles?.textColor || "#000000"}
                                onChange={(e) => onChange({ ...styles, textColor: e.target.value })}
                            />
                        </div>
                        <Input
                            className="h-8 text-xs font-mono"
                            placeholder="hex (e.g. #000000)"
                            value={styles?.textColor || ""}
                            onChange={(e) => onChange({ ...styles, textColor: e.target.value })}
                        />
                    </div>
                </div>
                {/* Button Colors */}
                <div className="space-y-1.5">
                    <Label className="text-xs text-slate-600">Button Color</Label>
                    <div className="flex gap-2 items-center">
                        <div className="relative w-8 h-8 rounded-md overflow-hidden border shadow-sm">
                            <input
                                type="color"
                                className="absolute inset-[-4px] w-[200%] h-[200%] cursor-pointer p-0 m-0 border-none"
                                value={styles?.buttonColor || "#4f46e5"}
                                onChange={(e) => onChange({ ...styles, buttonColor: e.target.value })}
                            />
                        </div>
                        <Input
                            className="h-8 text-xs font-mono"
                            placeholder="hex"
                            value={styles?.buttonColor || ""}
                            onChange={(e) => onChange({ ...styles, buttonColor: e.target.value })}
                        />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs text-slate-600">Button Text Color</Label>
                    <div className="flex gap-2 items-center">
                        <div className="relative w-8 h-8 rounded-md overflow-hidden border shadow-sm">
                            <input
                                type="color"
                                className="absolute inset-[-4px] w-[200%] h-[200%] cursor-pointer p-0 m-0 border-none"
                                value={styles?.buttonTextColor || "#ffffff"}
                                onChange={(e) => onChange({ ...styles, buttonTextColor: e.target.value })}
                            />
                        </div>
                        <Input
                            className="h-8 text-xs font-mono"
                            placeholder="hex"
                            value={styles?.buttonTextColor || ""}
                            onChange={(e) => onChange({ ...styles, buttonTextColor: e.target.value })}
                        />
                    </div>
                </div>

                {/* Form-Specific Styles */}
                {blockType === "form" && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-3 mt-1 col-span-1 md:col-span-2">
                        <Label className="text-xs text-slate-600">Container Background</Label>
                        <div className="flex gap-2 items-center">
                            <div className="relative w-8 h-8 rounded-md overflow-hidden border shadow-sm">
                                <input
                                    type="color"
                                    className="absolute inset-[-4px] w-[200%] h-[200%] cursor-pointer p-0 m-0 border-none"
                                    value={styles?.cardBackgroundColor || "#ffffff"}
                                    onChange={(e) => onChange({ ...styles, cardBackgroundColor: e.target.value })}
                                />
                            </div>
                            <Input
                                className="h-8 text-xs font-mono"
                                placeholder="hex"
                                value={styles?.cardBackgroundColor || ""}
                                onChange={(e) => onChange({ ...styles, cardBackgroundColor: e.target.value })}
                            />
                        </div>
                    </div>
                )}
            </div>
            {styles && Object.keys(styles).length > 0 && (
                <div className="flex justify-end">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => onChange({})}
                    >
                        Reset Styles
                    </Button>
                </div>
            )}
        </div>
    );
};

const ImageField = ({
    value,
    onChange,
    label,
    siteConfig
}: {
    value: string,
    onChange: (val: string) => void,
    label?: string,
    siteConfig: any
}) => {
    return (
        <div className="space-y-2">
            {label && <Label>{label}</Label>}
            <div className="flex gap-2">
                <div className="flex-1">
                    <Input
                        value={value || ""}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="https://..."
                    />
                </div>
                {siteConfig?.locationId && (
                    <div className="flex gap-1">
                        <MediaGalleryDialog
                            onSelect={onChange}
                            siteConfig={siteConfig}
                            trigger={
                                <Button variant="outline" size="icon" title="Select from Gallery">
                                    <ImageIcon className="w-4 h-4" />
                                </Button>
                            }
                        />
                        <CloudflareImageUploader
                            locationId={siteConfig.locationId}
                            onUploaded={(id) => {
                                const url = getImageDeliveryUrl(id, 'public');
                                if (!url) {
                                    toast.error("Configuration Error: Missing Cloudflare Account Hash. Please check your environment variables.");
                                    console.error("Missing NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH");
                                }
                                onChange(url);
                            }}
                            buttonLabel="Upload"
                            className="shrink-0"
                        />
                    </div>
                )}
            </div>
            {value && (
                <div className="relative w-full h-32 bg-slate-100 rounded-md overflow-hidden border mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={value} alt="Preview" className="w-full h-full object-cover" />
                </div>
            )}
        </div>
    );
};

export function BlockEditor({ blocks, onChange, onPreview, siteConfig }: BlockEditorProps) {
    const [refiningState, setRefiningState] = useState<{ [key: number]: boolean }>({});
    const [instructions, setInstructions] = useState<{ [key: number]: string }>({});
    const [isRegeneratingDesign, setIsRegeneratingDesign] = useState(false);
    const [isRedesignConfirmOpen, setIsRedesignConfirmOpen] = useState(false);
    const [designModel, setDesignModel] = useState("gemini-1.5-pro");
    const [promptOverride, setPromptOverride] = useState("");

    // AI Section Generation State
    const [isAiSectionDialogOpen, setIsAiSectionDialogOpen] = useState(false);
    const [aiSectionPrompt, setAiSectionPrompt] = useState("");
    const [aiSectionImage, setAiSectionImage] = useState("");
    const [aiSectionModel, setAiSectionModel] = useState("gemini-2.5-flash");
    const [isGeneratingSection, setIsGeneratingSection] = useState(false);
    const [isPastingImage, setIsPastingImage] = useState(false);

    const [availableModels, setAvailableModels] = useState<any[]>([]);

    useEffect(() => {
        let mounted = true;
        getAvailableAiModelsAction().then(models => {
            if (mounted && models && models.length > 0) setAvailableModels(models);
        }).catch(err => console.error(err));
        return () => { mounted = false; };
    }, []);

    // Direct Image Upload Helper (Replicating CloudflareImageUploader logic for programmatic use)
    const handleDirectImageUpload = async (file: File) => {
        if (!siteConfig?.locationId) {
            toast.error("Site Config missing locationId");
            return null;
        }

        setIsPastingImage(true);
        const toastId = toast.loading("Uploading image from clipboard...");

        try {
            // 1. Get Direct Upload URL
            const response = await fetch("/api/images/direct-upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    locationId: siteConfig.locationId,
                    metadata: { filename: file.name }
                }),
            });

            if (!response.ok) throw new Error("Failed to get upload URL");
            const { uploadURL, imageId } = await response.json();

            // 2. Upload file to Cloudflare
            const formData = new FormData();
            formData.append("file", file);

            const uploadResponse = await fetch(uploadURL, {
                method: "POST",
                body: formData,
            });

            if (!uploadResponse.ok) throw new Error("Failed to upload to Cloudflare");

            // 3. Get Delivery URL
            const deliveryUrl = getImageDeliveryUrl(imageId, 'public');

            toast.success("Image uploaded!", { id: toastId });
            return deliveryUrl;

        } catch (error) {
            console.error(error);
            toast.error("Failed to upload pasted image", { id: toastId });
            return null;
        } finally {
            setIsPastingImage(false);
        }
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
                e.preventDefault(); // Prevent pasting the binary string into textarea
                const file = items[i].getAsFile();
                if (file) {
                    const url = await handleDirectImageUpload(file);
                    if (url) setAiSectionImage(url);
                }
                return; // Stop after first image
            }
        }
    };

    // Raw Content Preview State
    const [viewMode, setViewMode] = useState<"visual" | "raw">("visual");
    const [rawJson, setRawJson] = useState("");
    const [jsonError, setJsonError] = useState<string | null>(null);

    const handleViewModeChange = (mode: "visual" | "raw") => {
        if (mode === "raw") {
            setRawJson(JSON.stringify(blocks, null, 2));
            setJsonError(null);
        } else {
            // Attempt to parse before switching back if coming from raw
            // But we have a dedicated "Apply" button for raw mode, so maybe just switching back safely is enough?
            // Let's enforce applying or discarding changes before switching back to visual if dirty?
            // For simplicity, we'll just switch back. If they edited raw without applying, changes are lost.
            // Or better: auto-apply if valid?
            // Let's stick to explicit Apply in Raw mode for safety.
        }
        setViewMode(mode);
    };

    const handleApplyRawJson = () => {
        try {
            const parsed = JSON.parse(rawJson);
            if (!Array.isArray(parsed)) {
                throw new Error("Root must be an array of blocks.");
            }
            onChange(parsed);
            setJsonError(null);
            toast.success("Raw changes applied successfully!");
        } catch (e: any) {
            console.error("JSON Parse Error:", e);
            setJsonError(e.message || "Invalid JSON");
            toast.error("Invalid JSON. Please fix errors before applying.");
        }
    };

    const performRedesign = async () => {
        if (!siteConfig?.locationId) {
            toast.error("Site configuration missing.");
            return;
        }

        setIsRegeneratingDesign(true);
        setIsRedesignConfirmOpen(false); // Close dialog immediately or keep open? Better to close and show loading state on button or toast.

        try {
            // OPTIONAL: You could pass a brandVoiceOverride here if you had an input for it in the header
            const result = await regeneratePageDesign(blocks, siteConfig.locationId, undefined, designModel, promptOverride);

            if (result.success && result.blocks) {
                onChange(result.blocks);
                toast.success("Page design regenerated successfully!");
            } else {
                toast.error(result.error || "Failed to regenerate design.");
            }
        } catch (error) {
            console.error(error);
            toast.error("An unexpected error occurred.");
        } finally {
            setIsRegeneratingDesign(false);
        }
    };

    const handleGenerateSection = async () => {
        if (!aiSectionPrompt) {
            toast.error("Please enter a description for the section.");
            return;
        }
        if (!siteConfig?.locationId) {
            toast.error("Site configuration missing.");
            return;
        }

        setIsGeneratingSection(true);
        try {
            const result = await generateSectionFromPrompt(
                siteConfig.locationId,
                aiSectionPrompt,
                aiSectionImage,
                undefined, // brandVoiceOverride
                aiSectionModel // modelOverride
            );

            if (result.success && result.blocks && result.blocks.length > 0) {
                // Append new blocks
                const newBlocks = [...blocks, ...result.blocks];
                onChange(newBlocks);
                toast.success("New section generated and added!");
                setIsAiSectionDialogOpen(false);
                setAiSectionPrompt("");
                setAiSectionImage("");
            } else {
                toast.error(result.error || "Failed to generate section.");
            }
        } catch (error) {
            console.error(error);
            toast.error("An error occurred while generating the section.");
        } finally {
            setIsGeneratingSection(false);
        }
    };

    const updateBlock = (index: number, newData: Partial<Block>) => {
        const newBlocks = [...blocks];
        newBlocks[index] = { ...newBlocks[index], ...newData };
        onChange(newBlocks);
    };

    const removeBlock = (index: number) => {
        const newBlocks = blocks.filter((_, i) => i !== index);
        onChange(newBlocks);
    };

    const moveBlock = (index: number, direction: -1 | 1) => {
        if (index + direction < 0 || index + direction >= blocks.length) return;
        const newBlocks = [...blocks];
        const temp = newBlocks[index];
        newBlocks[index] = newBlocks[index + direction];
        newBlocks[index + direction] = temp;
        onChange(newBlocks);
    };

    const handleRefine = async (index: number) => {
        const instruction = instructions[index];
        if (!instruction) return;

        setRefiningState(prev => ({ ...prev, [index]: true }));

        try {
            if (!siteConfig?.locationId) {
                toast.error("Site configuration missing.");
                return;
            }

            const result = await refineBlockContent(blocks[index], instruction, siteConfig.locationId);

            if (result.success && result.block) {
                updateBlock(index, result.block);
                toast.success("Block refined by AI!");
                setInstructions(prev => ({ ...prev, [index]: "" })); // Clear input
            } else {
                toast.error(result.error || "Failed to refine block.");
            }
        } catch (error) {
            console.error(error);
            toast.error("An error occurred.");
        } finally {
            setRefiningState(prev => ({ ...prev, [index]: false }));
        }
    };

    // Helper to generic array item updates
    const updateArrayItem = (blockIndex: number, arrayField: string, itemIndex: number, field: string, value: any) => {
        const block = blocks[blockIndex];
        const newArray = [...(block[arrayField] || [])];
        if (!newArray[itemIndex]) newArray[itemIndex] = {};
        newArray[itemIndex] = { ...newArray[itemIndex], [field]: value };
        updateBlock(blockIndex, { [arrayField]: newArray });
    };

    const addArrayItem = (blockIndex: number, arrayField: string, initialItem: any = {}) => {
        const block = blocks[blockIndex];
        const newArray = [...(block[arrayField] || []), initialItem];
        updateBlock(blockIndex, { [arrayField]: newArray });
    };

    const removeArrayItem = (blockIndex: number, arrayField: string, itemIndex: number) => {
        const block = blocks[blockIndex];
        const newArray = [...(block[arrayField] || [])].filter((_, i) => i !== itemIndex);
        updateBlock(blockIndex, { [arrayField]: newArray });
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center bg-slate-100 p-2 rounded-lg">
                <div className="flex items-center gap-2">
                    <Dialog open={isRedesignConfirmOpen} onOpenChange={setIsRedesignConfirmOpen}>
                        <DialogTrigger asChild>
                            <Button
                                variant="default"
                                size="sm"
                                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-sm"
                                disabled={isRegeneratingDesign || blocks.length === 0}
                            >
                                {isRegeneratingDesign ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Sparkles className="w-3.5 h-3.5" />
                                )}
                                {isRegeneratingDesign ? "Redesigning..." : "AI Redesign"}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Regenerate Page Design?</DialogTitle>
                                <DialogDescription>
                                    This will use the <strong>Stage 2: Design Engine</strong> to reimagine the look and feel of your content.
                                    <br /><br />
                                    Your text content will be preserved, but layouts, colors, and styles will be updated.
                                </DialogDescription>
                                <div className="space-y-1 mt-4">
                                    <Label className="text-xs uppercase text-muted-foreground">Design Model</Label>
                                    <select
                                        className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        value={designModel}
                                        onChange={(e) => setDesignModel(e.target.value)}
                                    >
                                        {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                            <option key={model.value} value={model.value}>
                                                {model.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1 mt-3">
                                    <Label className="text-xs uppercase text-muted-foreground">Custom Instructions (Optional)</Label>
                                    <Textarea
                                        placeholder="e.g. Make it dark mode, use more emojis, focus on luxury..."
                                        className="h-20 resize-none text-sm bg-white"
                                        value={promptOverride}
                                        onChange={(e) => setPromptOverride(e.target.value)}
                                    />
                                </div>
                            </DialogHeader>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsRedesignConfirmOpen(false)}>Cancel</Button>
                                <Button onClick={performRedesign} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Confirm Redesign
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
                <div className="flex gap-1">
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        className="bg-white shadow-sm cursor-default"
                    >
                        <Edit3 className="w-4 h-4 mr-2" /> Edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={onPreview}
                    >
                        <Eye className="w-4 h-4 mr-2" /> Live Preview
                    </Button>
                    <div className="bg-slate-200 w-px h-6 mx-1 self-center" />
                    <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => handleViewModeChange("visual")}
                            className={`h-7 px-3 text-xs ${viewMode === "visual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                        >
                            <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Visual
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => handleViewModeChange("raw")}
                            className={`h-7 px-3 text-xs ${viewMode === "raw" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                        >
                            <Code className="w-3.5 h-3.5 mr-1.5" /> Raw
                        </Button>
                    </div>
                </div>
            </div>

            {viewMode === "raw" ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between bg-amber-50 p-3 rounded-lg border border-amber-200">
                        <div className="flex items-center gap-2 text-amber-800 text-sm">
                            <AlertTriangle className="w-4 h-4" />
                            <span><strong>Warning:</strong> Editing raw JSON content is for advanced users. Syntax errors may break the page.</span>
                        </div>
                        <Button
                            size="sm"
                            onClick={handleApplyRawJson}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            Apply Changes
                        </Button>
                    </div>
                    <div className="relative">
                        <Textarea
                            className="font-mono text-xs min-h-[600px] leading-relaxed bg-slate-900 text-slate-50 border-slate-800 focus-visible:ring-slate-700"
                            value={rawJson}
                            onChange={(e) => {
                                setRawJson(e.target.value);
                                try {
                                    JSON.parse(e.target.value);
                                    setJsonError(null);
                                } catch (err: any) {
                                    setJsonError(err.message);
                                }
                            }}
                            spellCheck={false}
                        />
                        {jsonError && (
                            <div className="absolute bottom-4 right-4 max-w-md bg-red-100 border border-red-200 text-red-700 p-3 rounded text-xs shadow-lg font-mono">
                                <span className="font-bold block mb-1">JSON Error:</span>
                                {jsonError}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-8">
                    {blocks.map((block, index) => (
                        <div key={index} className="grid grid-cols-1 gap-4 items-start">
                            <Card className="relative group border-l-4 border-l-indigo-500 overflow-hidden">
                                <CardHeader className="flex flex-row items-center justify-between py-2 bg-slate-50 border-b">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs uppercase bg-slate-200 px-2 py-1 rounded font-bold text-slate-700">
                                            {block.type}
                                        </span>
                                        <span className="text-sm font-medium text-slate-600">
                                            Section {index + 1}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="ghost" size="icon" className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">
                                                    <Sparkles className="w-4 h-4" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-80 p-0" align="end">
                                                <div className="bg-indigo-50/50 p-4 rounded-xl">
                                                    <div className="flex items-center gap-2 mb-3 text-indigo-700">
                                                        <Sparkles className="w-4 h-4" />
                                                        <span className="text-sm font-semibold">AI Assistant</span>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <p className="text-xs text-indigo-600/80">
                                                            Ask me to modify this {block.type} block.
                                                        </p>
                                                        <Textarea
                                                            placeholder='e.g. "Make the headline punchier" or "Switch to dark theme"'
                                                            className="bg-white text-sm resize-none h-24 focus-visible:ring-indigo-500"
                                                            value={instructions[index] || ""}
                                                            onChange={(e) => setInstructions(prev => ({ ...prev, [index]: e.target.value }))}
                                                        />
                                                        <Button
                                                            size="sm"
                                                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                                                            disabled={refiningState[index] || !instructions[index]}
                                                            onClick={() => handleRefine(index)}
                                                        >
                                                            {refiningState[index] ? (
                                                                <>
                                                                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                                                                    Refining...
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Send className="w-3 h-3 mr-2" />
                                                                    Generate Changes
                                                                </>
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                        <Button variant="ghost" size="icon" onClick={() => moveBlock(index, -1)} disabled={index === 0}>
                                            <ChevronUp className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}>
                                            <ChevronDown className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => removeBlock(index)} className="text-red-500 hover:text-red-700">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </CardHeader>

                                <CardContent className="p-4 space-y-4">
                                    {/* BLOCK CONTENT EDITORS (Keep existing logic exactly as is) */}
                                    {/* 1. Hero */}
                                    {block.type === "hero" && (
                                        <>
                                            <div className="space-y-2">
                                                <Label>Headline</Label>
                                                <HtmlInput
                                                    value={block.headline || ""}
                                                    onChange={(val) => updateBlock(index, { headline: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Subheadline</Label>
                                                <HtmlInput
                                                    value={block.subheadline || ""}
                                                    onChange={(val) => updateBlock(index, { subheadline: val })}
                                                    siteConfig={siteConfig}
                                                    multiline
                                                    className="h-20"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-2">
                                                    <Label>CTA Text</Label>
                                                    <Input
                                                        value={block.ctaText || ""}
                                                        onChange={(e) => updateBlock(index, { ctaText: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>CTA Link</Label>
                                                    <Input
                                                        value={block.ctaLink || ""}
                                                        onChange={(e) => updateBlock(index, { ctaLink: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2 pb-2 border-b">
                                                <Label>Layout</Label>
                                                <Select value={block.layout || "full-width"} onValueChange={(val) => updateBlock(index, { layout: val })}>
                                                    <SelectTrigger><SelectValue placeholder="Layout" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="full-width">Full Width (Centered)</SelectItem>
                                                        <SelectItem value="split-left">Split Left (Text Left, Image Right)</SelectItem>
                                                        <SelectItem value="split-right">Split Right (Text Right, Image Left)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2">
                                                <ImageField
                                                    label="Hero Image"
                                                    value={block.image || ""}
                                                    onChange={(val) => updateBlock(index, { image: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <ImageField
                                                    label="Background Image (for Full Width)"
                                                    value={block.backgroundImage || ""}
                                                    onChange={(val) => updateBlock(index, { backgroundImage: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                                                <div className="space-y-2">
                                                    <Label>Badge / Eyebrow</Label>
                                                    <Input
                                                        value={block.badge || ""}
                                                        onChange={(e) => updateBlock(index, { badge: e.target.value })}
                                                        placeholder="e.g. NEW ARRIVAL"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Alignment (Full Width Only)</Label>
                                                    <Select value={block.alignment || "left"} onValueChange={(val) => updateBlock(index, { alignment: val })}>
                                                        <SelectTrigger><SelectValue placeholder="Alignment" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="left">Left</SelectItem>
                                                            <SelectItem value="center">Center</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="space-y-2 pb-2 border-b">
                                                <Label>Theme Preset</Label>
                                                <Select value={block.theme || "light"} onValueChange={(val) => updateBlock(index, { theme: val })}>
                                                    <SelectTrigger><SelectValue placeholder="Theme" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="light">Light (Default)</SelectItem>
                                                        <SelectItem value="dark">Dark (Dark Mode)</SelectItem>
                                                        <SelectItem value="brand-solid">Brand Solid (Primary Color)</SelectItem>
                                                        <SelectItem value="blue-gradient">Blue Gradient</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Image Overlay Card Text (Optional)</Label>
                                                <HtmlInput
                                                    value={block.overlayCard || ""}
                                                    onChange={(val) => updateBlock(index, { overlayCard: val })}
                                                    siteConfig={siteConfig}
                                                    multiline
                                                    className="h-20"
                                                />
                                            </div>

                                            <div className="space-y-3 pt-4 border-t">
                                                <Label>Hero Stats</Label>
                                                {(block.stats || []).map((stat: any, i: number) => (
                                                    <div key={i} className="flex gap-2 items-center border p-2 rounded bg-slate-50">
                                                        <Input
                                                            placeholder="Value (e.g. 50M+)"
                                                            value={stat.value || ""}
                                                            onChange={(e) => updateArrayItem(index, 'stats', i, 'value', e.target.value)}
                                                        />
                                                        <Input
                                                            placeholder="Label (e.g. Sales Volume)"
                                                            value={stat.label || ""}
                                                            onChange={(e) => updateArrayItem(index, 'stats', i, 'label', e.target.value)}
                                                        />
                                                        <Button type="button" variant="ghost" size="icon" onClick={() => removeArrayItem(index, 'stats', i)}><X className="w-4 h-4 text-red-400" /></Button>
                                                    </div>
                                                ))}
                                                <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(index, 'stats')}><Plus className="w-4 h-4 mr-2" /> Add Stat</Button>
                                            </div>
                                        </>
                                    )}

                                    {/* SYSTEM BLOCKS */}
                                    {/* Categories Block */}
                                    {block.type === "categories" && (
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>Section Title</Label>
                                                <HtmlInput
                                                    value={block.title || "What are you looking for?"}
                                                    onChange={(val) => updateBlock(index, { title: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>

                                            <div className="space-y-3 pt-2">
                                                <div className="flex justify-between items-center">
                                                    <Label>Category Tiles</Label>
                                                    {(!block.items || block.items.length === 0) && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                                            onClick={() => updateBlock(index, {
                                                                items: [
                                                                    { title: "New Build Villas", filter: { type: "villa", condition: "New Build", status: "sale" } },
                                                                    { title: "Resale Villas", filter: { type: "villa", condition: "Resale", status: "sale" } },
                                                                    { title: "Resale Apartments", filter: { type: "apartment", condition: "Resale", status: "sale" } },
                                                                    { title: "New Build Apartments", filter: { type: "apartment", condition: "New Build", status: "sale" } },
                                                                    { title: "Commercial", filter: { type: "commercial", status: "sale" } },
                                                                    { title: "Land", filter: { type: "land", status: "sale" } },
                                                                    { title: "Rentals", filter: { status: "rent" } }
                                                                ]
                                                            })}
                                                        >
                                                            <Sparkles className="w-3 h-3 mr-1.5" />
                                                            Load Defaults
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className="grid gap-4">
                                                    {(block.items || []).map((item: any, i: number) => (
                                                        <Card key={i} className="p-3 border border-slate-200 bg-slate-50/50">
                                                            <div className="space-y-3">
                                                                <div className="flex justify-between items-start">
                                                                    <div className="flex-1 mr-4">
                                                                        <Label className="text-xs text-muted-foreground mb-1 block">Title</Label>
                                                                        <Input
                                                                            value={item.title || ""}
                                                                            onChange={(e) => updateArrayItem(index, 'items', i, 'title', e.target.value)}
                                                                            placeholder="e.g. New Build Villas"
                                                                            className="bg-white"
                                                                        />
                                                                    </div>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => removeArrayItem(index, 'items', i)}
                                                                        className="text-red-400 hover:text-red-600 hover:bg-red-50 -mt-1 -mr-1"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </Button>
                                                                </div>

                                                                <div className="grid grid-cols-2 gap-3">
                                                                    <div>
                                                                        <Label className="text-xs text-muted-foreground mb-1 block">Property Type</Label>
                                                                        <Select
                                                                            value={item.filter?.type || "any"}
                                                                            onValueChange={(val) => {
                                                                                const newFilter = { ...(item.filter || {}), type: val === "any" ? undefined : val };
                                                                                updateArrayItem(index, 'items', i, 'filter', newFilter);
                                                                            }}
                                                                        >
                                                                            <SelectTrigger className="bg-white h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="any">Any Type</SelectItem>
                                                                                <SelectItem value="villa">Villa</SelectItem>
                                                                                <SelectItem value="apartment">Apartment</SelectItem>
                                                                                <SelectItem value="townhouse">Townhouse</SelectItem>
                                                                                <SelectItem value="bungalow">Bungalow</SelectItem>
                                                                                <SelectItem value="land">Land</SelectItem>
                                                                                <SelectItem value="commercial">Commercial</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div>
                                                                        <Label className="text-xs text-muted-foreground mb-1 block">Condition</Label>
                                                                        <Select
                                                                            value={item.filter?.condition || "any"}
                                                                            onValueChange={(val) => {
                                                                                const newFilter = { ...(item.filter || {}), condition: val === "any" ? undefined : val };
                                                                                updateArrayItem(index, 'items', i, 'filter', newFilter);
                                                                            }}
                                                                        >
                                                                            <SelectTrigger className="bg-white h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="any">Any Condition</SelectItem>
                                                                                <SelectItem value="New Build">New Build</SelectItem>
                                                                                <SelectItem value="Resale">Resale</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                </div>

                                                                <div>
                                                                    <Label className="text-xs text-muted-foreground mb-1 block">Image</Label>
                                                                    <ImageField
                                                                        value={item.image || ""}
                                                                        onChange={(val) => {
                                                                            if (!val) {
                                                                                toast.error("Failed to generate image URL. Check console for details.");
                                                                            }
                                                                            updateArrayItem(index, 'items', i, 'image', val);
                                                                        }}
                                                                        siteConfig={siteConfig}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </Card>
                                                    ))}
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => addArrayItem(index, 'items', { title: "New Category", filter: {} })}
                                                    className="w-full mt-2"
                                                >
                                                    <Plus className="w-4 h-4 mr-2" /> Add Category Tile
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {(block.type === "featured-properties" || block.type === "trusted-partners") && (
                                        <div className="p-4 bg-slate-100 rounded border border-slate-200 text-center space-y-2">
                                            <div className="flex justify-center">
                                                <Sparkles className="w-6 h-6 text-indigo-500" />
                                            </div>
                                            <h4 className="font-semibold text-slate-800">System Component</h4>
                                            <p className="text-sm text-slate-600">
                                                This section is automatically managed by the system.
                                                <br />
                                                You can reorder it or remove it to hide it from the home page.
                                            </p>
                                        </div>
                                    )}

                                    {/* 2. Features */}
                                    {block.type === "features" && (
                                        <>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Layout</Label>
                                                    <Select value={block.layout || "grid"} onValueChange={(val) => updateBlock(index, { layout: val })}>
                                                        <SelectTrigger><SelectValue placeholder="Layout" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="grid">Grid (Icon + Text)</SelectItem>
                                                            <SelectItem value="cards">Cards (Boxed)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Columns</Label>
                                                    <Select value={String(block.columns || "3")} onValueChange={(val) => updateBlock(index, { columns: parseInt(val) })}>
                                                        <SelectTrigger><SelectValue placeholder="Columns" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="2">2 Columns</SelectItem>
                                                            <SelectItem value="3">3 Columns</SelectItem>
                                                            <SelectItem value="4">4 Columns</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Badge</Label>
                                                <Input
                                                    value={block.badge || ""}
                                                    onChange={(e) => updateBlock(index, { badge: e.target.value })}
                                                    placeholder="e.g. FEATURES"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Section Title</Label>
                                                <HtmlInput
                                                    value={block.title || ""}
                                                    onChange={(val) => updateBlock(index, { title: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Subtext / Description</Label>
                                                <HtmlInput
                                                    value={block.subtext || ""}
                                                    onChange={(val) => updateBlock(index, { subtext: val })}
                                                    siteConfig={siteConfig}
                                                    multiline
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <Label>Feature Items</Label>
                                                    <Button size="sm" variant="outline" onClick={() => addArrayItem(index, 'items', { title: "New Feature", description: "Desc", icon: "Star" })}>
                                                        <Plus className="w-3 h-3 mr-1" /> Add
                                                    </Button>
                                                </div>
                                                {block.items?.map((item: any, i: number) => (
                                                    <div key={i} className="flex gap-2 items-start border p-2 rounded bg-slate-50">
                                                        <div className="space-y-2 w-24 shrink-0">
                                                            <Label className="text-[10px] text-muted-foreground">Icon (Lucide)</Label>
                                                            <Input
                                                                placeholder="Icon"
                                                                value={item.icon || ""}
                                                                onChange={(e) => updateArrayItem(index, 'items', i, 'icon', e.target.value)}
                                                                className="h-8 text-xs"
                                                            />
                                                        </div>
                                                        <div className="space-y-2 flex-1">
                                                            <Label className="text-[10px] text-muted-foreground">Content</Label>
                                                            <HtmlInput
                                                                placeholder="Title"
                                                                value={item.title || ""}
                                                                onChange={(val) => updateArrayItem(index, 'items', i, 'title', val)}
                                                                className="h-8"
                                                                siteConfig={siteConfig}
                                                            />
                                                            <HtmlInput
                                                                placeholder="Description"
                                                                value={item.description || ""}
                                                                onChange={(val) => updateArrayItem(index, 'items', i, 'description', val)}
                                                                className="h-16 text-xs"
                                                                multiline
                                                                siteConfig={siteConfig}
                                                            />
                                                        </div>
                                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400" onClick={() => removeArrayItem(index, 'items', i)}>
                                                            <X className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}

                                    {/* 3. Text Block */}
                                    {block.type === "text" && (
                                        <RichTextEditor
                                            value={block.htmlContent || ""}
                                            onChange={(val) => updateBlock(index, { htmlContent: val })}
                                        />
                                    )}

                                    {/* 4. CTA Block */}
                                    {block.type === "cta" && (
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>Title</Label>
                                                <HtmlInput
                                                    value={block.title || ""}
                                                    onChange={(val) => updateBlock(index, { title: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Subtext</Label>
                                                <HtmlInput
                                                    value={block.subtext || ""}
                                                    onChange={(val) => updateBlock(index, { subtext: val })}
                                                    siteConfig={siteConfig}
                                                    multiline
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Badge</Label>
                                                <Input
                                                    value={block.badge || ""}
                                                    onChange={(e) => updateBlock(index, { badge: e.target.value })}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Button Text</Label>
                                                    <Input
                                                        value={block.buttonText || ""}
                                                        onChange={(e) => updateBlock(index, { buttonText: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Button Link</Label>
                                                    <Input
                                                        value={block.link || ""}
                                                        onChange={(e) => updateBlock(index, { link: e.target.value })}
                                                        placeholder="#contact"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Secondary Button Text</Label>
                                                    <Input
                                                        value={block.secondaryCtaText || ""}
                                                        onChange={(e) => updateBlock(index, { secondaryCtaText: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Secondary Button Link</Label>
                                                    <Input
                                                        value={block.secondaryCtaLink || ""}
                                                        onChange={(e) => updateBlock(index, { secondaryCtaLink: e.target.value })}
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Theme Preset</Label>
                                                <Select value={block.theme || "light"} onValueChange={(val) => updateBlock(index, { theme: val })}>
                                                    <SelectTrigger><SelectValue placeholder="Theme" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="light">Light</SelectItem>
                                                        <SelectItem value="dark">Dark</SelectItem>
                                                        <SelectItem value="brand-solid">Brand Solid</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2">
                                                <ImageField
                                                    label="Background Image"
                                                    value={block.backgroundImage || block.image || ""}
                                                    onChange={(val) => updateBlock(index, { backgroundImage: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Generic fallback for other types to at least show JSON or basic fields could go here, 
                                        but for now we rely on the specific editors or AI to fill them. 
                                    */}

                                    {/* 1. Hero Editor */}
                                    {/* The original hero editor was replaced by the new one above. */}

                                    {/* 2. Features Grid */}
                                    {/* The original features editor was replaced by the new one above. */}

                                    {/* 3. Testimonials */}
                                    {block.type === "testimonials" && (
                                        <div className="space-y-3">
                                            <Input placeholder="Section Title" value={block.title || ""} onChange={(e) => updateBlock(index, { title: e.target.value })} />
                                            {(block.items || []).map((item: any, i: number) => (
                                                <div key={i} className="flex gap-2 items-start border p-2 rounded bg-white">
                                                    <div className="space-y-2 flex-1">
                                                        <Textarea placeholder="Quote" value={item.quote || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'quote', e.target.value)} />
                                                        <div className="grid grid-cols-3 gap-2">
                                                            <Input placeholder="Author" value={item.author || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'author', e.target.value)} />
                                                            <Input placeholder="Role" value={item.role || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'role', e.target.value)} />
                                                            <Input placeholder="Role" value={item.role || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'role', e.target.value)} />
                                                            <div className="col-span-3">
                                                                <ImageField
                                                                    label="Avatar URL"
                                                                    value={item.avatarUrl || ""}
                                                                    onChange={(val) => updateArrayItem(index, 'items', i, 'avatarUrl', val)}
                                                                    siteConfig={siteConfig}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button variant="ghost" size="sm" onClick={() => removeArrayItem(index, 'items', i)}><X className="w-4 h-4" /></Button>
                                                </div>
                                            ))}
                                            <Button variant="outline" size="sm" onClick={() => addArrayItem(index, 'items')}><Plus className="w-4 h-4 mr-2" /> Add Testimonial</Button>
                                        </div>
                                    )}

                                    {/* 4. Pricing */}
                                    {block.type === "pricing" && (
                                        <div className="space-y-3">
                                            <Input placeholder="Section Title" value={block.title || ""} onChange={(e) => updateBlock(index, { title: e.target.value })} />
                                            {(block.plans || []).map((plan: any, i: number) => (
                                                <div key={i} className="flex gap-2 items-start border p-2 rounded bg-white">
                                                    <div className="space-y-2 flex-1">
                                                        <div className="flex gap-2">
                                                            <Input placeholder="Plan Name" value={plan.name || ""} onChange={(e) => updateArrayItem(index, 'plans', i, 'name', e.target.value)} />
                                                            <Input placeholder="Price" value={plan.price || ""} onChange={(e) => updateArrayItem(index, 'plans', i, 'price', e.target.value)} />
                                                            <Input placeholder="Frequency" value={plan.frequency || ""} onChange={(e) => updateArrayItem(index, 'plans', i, 'frequency', e.target.value)} />
                                                        </div>
                                                        <Input placeholder="Features (comma separated)" value={Array.isArray(plan.features) ? plan.features.join(", ") : (plan.features || "")} onChange={(e) => updateArrayItem(index, 'plans', i, 'features', e.target.value.split(",").map((s: string) => s.trim()))} />
                                                    </div>
                                                    <Button variant="ghost" size="sm" onClick={() => removeArrayItem(index, 'plans', i)}><X className="w-4 h-4" /></Button>
                                                </div>
                                            ))}
                                            <Button variant="outline" size="sm" onClick={() => addArrayItem(index, 'plans')}><Plus className="w-4 h-4 mr-2" /> Add Plan</Button>
                                        </div>
                                    )}

                                    {/* 5. Accordion */}
                                    {block.type === "accordion" && (
                                        <div className="space-y-3">
                                            <Input placeholder="Section Title" value={block.title || ""} onChange={(e) => updateBlock(index, { title: e.target.value })} />
                                            {(block.items || []).map((item: any, i: number) => (
                                                <div key={i} className="flex gap-2 items-start border p-2 rounded bg-white">
                                                    <div className="space-y-2 flex-1">
                                                        <Input placeholder="Question" value={item.trigger || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'trigger', e.target.value)} />
                                                        <Textarea placeholder="Answer" value={item.content || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'content', e.target.value)} />
                                                    </div>
                                                    <Button variant="ghost" size="sm" onClick={() => removeArrayItem(index, 'items', i)}><X className="w-4 h-4" /></Button>
                                                </div>
                                            ))}
                                            <Button variant="outline" size="sm" onClick={() => addArrayItem(index, 'items')}><Plus className="w-4 h-4 mr-2" /> Add Question</Button>
                                        </div>
                                    )}

                                    {/* 6. Stats */}
                                    {block.type === "stats" && (
                                        <div className="space-y-3">
                                            <Label>Statistics</Label>
                                            {(block.items || []).map((item: any, i: number) => (
                                                <div key={i} className="flex gap-2 items-center border p-2 rounded bg-white">
                                                    <Input placeholder="Value (e.g. 500+)" value={item.value || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'value', e.target.value)} />
                                                    <Input placeholder="Label (e.g. Clients)" value={item.label || ""} onChange={(e) => updateArrayItem(index, 'items', i, 'label', e.target.value)} />
                                                    <Button variant="ghost" size="sm" onClick={() => removeArrayItem(index, 'items', i)}><X className="w-4 h-4" /></Button>
                                                </div>
                                            ))}
                                            <Button variant="outline" size="sm" onClick={() => addArrayItem(index, 'items')}><Plus className="w-4 h-4 mr-2" /> Add Stat</Button>
                                        </div>
                                    )}

                                    {/* 7. Gallery */}
                                    {block.type === "gallery" && (
                                        <div className="space-y-3">
                                            <Input placeholder="Gallery Title" value={block.title || ""} onChange={(e) => updateBlock(index, { title: e.target.value })} />
                                            <Select value={block.style || "grid"} onValueChange={(val) => updateBlock(index, { style: val })}>
                                                <SelectTrigger><SelectValue placeholder="Style" /></SelectTrigger>
                                                <SelectContent><SelectItem value="grid">Grid</SelectItem><SelectItem value="carousel">Carousel</SelectItem></SelectContent>
                                            </Select>
                                            <Label>Images</Label>
                                            {(block.images || []).map((url: string, i: number) => (
                                                <div key={i} className="mb-4 pt-4 border-t first:border-0 first:pt-0">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <Label className="text-xs text-slate-500">Image {i + 1}</Label>
                                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500" onClick={() => {
                                                            const newImages = [...(block.images || [])];
                                                            newImages.splice(i, 1);
                                                            updateBlock(index, { images: newImages });
                                                        }}><X className="w-4 h-4" /></Button>
                                                    </div>
                                                    <ImageField
                                                        value={url}
                                                        onChange={(val) => {
                                                            const newImages = [...(block.images || [])];
                                                            newImages[i] = val;
                                                            updateBlock(index, { images: newImages });
                                                        }}
                                                        siteConfig={siteConfig}
                                                    />
                                                </div>
                                            ))}
                                            <Button variant="outline" size="sm" onClick={() => updateBlock(index, { images: [...(block.images || []), ""] })}><Plus className="w-4 h-4 mr-2" /> Add Image URL</Button>
                                        </div>
                                    )}

                                    {/* 8. Form Block */}
                                    {block.type === "form" && (
                                        <div className="grid gap-3 p-2 bg-slate-50/50 rounded">
                                            <Input placeholder="Form Title" value={block.title || ""} onChange={(e) => updateBlock(index, { title: e.target.value })} />
                                            <Input placeholder="Sub text" value={block.subtext || ""} onChange={(e) => updateBlock(index, { subtext: e.target.value })} />
                                            <Select value={block.formType || "contact"} onValueChange={(val) => updateBlock(index, { formType: val })}>
                                                <SelectTrigger><SelectValue placeholder="Form Type" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="contact">Contact Form</SelectItem>
                                                    <SelectItem value="newsletter">Newsletter</SelectItem>
                                                    <SelectItem value="booking">Booking</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {/* 9. CTA */}
                                    {block.type === "cta" && (
                                        <div className="grid gap-3 p-2 bg-slate-50/50 rounded">
                                            <HtmlInput placeholder="Title" value={block.title || ""} onChange={(val) => updateBlock(index, { title: val })} siteConfig={siteConfig} />
                                            <HtmlInput placeholder="Sub text" value={block.subtext || ""} onChange={(val) => updateBlock(index, { subtext: val })} siteConfig={siteConfig} />
                                            <div className="grid grid-cols-2 gap-2">
                                                <Input placeholder="Button Text" value={block.buttonText || ""} onChange={(e) => updateBlock(index, { buttonText: e.target.value })} />
                                                <Input placeholder="Link" value={block.link || ""} onChange={(e) => updateBlock(index, { link: e.target.value })} />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 mt-2">
                                                <Input placeholder="Sec. Button Text" value={block.secondaryCtaText || ""} onChange={(e) => updateBlock(index, { secondaryCtaText: e.target.value })} />
                                                <Input placeholder="Sec. Link" value={block.secondaryCtaLink || ""} onChange={(e) => updateBlock(index, { secondaryCtaLink: e.target.value })} />
                                            </div>
                                        </div>
                                    )}

                                    {/* 10. Rich Text (redundant block type check already above but keep structure) */}
                                    {block.type === "text" && (
                                        // Already rendered above
                                        null
                                    )}

                                    {/* 11. Feature Section (Enhanced) */}
                                    {block.type === "feature-section" && (
                                        <div className="space-y-4">
                                            <div className="p-3 bg-slate-50 border rounded-md grid md:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Layout</Label>
                                                    <Select value={block.layout || "split-left"} onValueChange={(val) => updateBlock(index, { layout: val })}>
                                                        <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="split-left">Text Left, Image Right</SelectItem>
                                                            <SelectItem value="split-right">Image Left, Text Right</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Supertitle / Badge</Label>
                                                    <Input
                                                        value={block.supertitle || block.badge || ""}
                                                        onChange={(e) => updateBlock(index, { supertitle: e.target.value })}
                                                        placeholder="e.g. WHO WE ARE"
                                                        className="bg-white"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Headline</Label>
                                                <HtmlInput
                                                    value={block.title || ""}
                                                    onChange={(val) => updateBlock(index, { title: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Description</Label>
                                                <HtmlInput
                                                    value={block.description || ""}
                                                    onChange={(val) => updateBlock(index, { description: val })}
                                                    multiline
                                                    className="h-32"
                                                    siteConfig={siteConfig}
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <ImageField
                                                    label="Main Feature Image"
                                                    value={block.image || ""}
                                                    onChange={(val) => updateBlock(index, { image: val })}
                                                    siteConfig={siteConfig}
                                                />
                                            </div>

                                            {/* Badges Array */}
                                            <div className="space-y-2 pt-2 border-t">
                                                <div className="flex justify-between items-center">
                                                    <Label>Info Badges (e.g. Licenses)</Label>
                                                    <Button size="sm" variant="ghost" onClick={() => addArrayItem(index, 'badges', { title: "New Badge", subtitle: "Subtitle" })}>
                                                        <Plus className="w-3 h-3 mr-1" /> Add
                                                    </Button>
                                                </div>
                                                {(block.badges || []).map((badge: any, i: number) => (
                                                    <div key={i} className="flex gap-2 items-center bg-slate-50 p-2 rounded">
                                                        <Input
                                                            placeholder="Value/Title"
                                                            value={badge.title || ""}
                                                            onChange={(e) => updateArrayItem(index, 'badges', i, 'title', e.target.value)}
                                                            className="flex-1 bg-white"
                                                        />
                                                        <Input
                                                            placeholder="Label/Subtitle"
                                                            value={badge.subtitle || ""}
                                                            onChange={(e) => updateArrayItem(index, 'badges', i, 'subtitle', e.target.value)}
                                                            className="flex-1 bg-white text-xs"
                                                        />
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={() => removeArrayItem(index, 'badges', i)}>
                                                            <X className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Features List */}
                                            <div className="space-y-2 pt-2 border-t">
                                                <div className="flex justify-between items-center">
                                                    <Label>Checklist Items</Label>
                                                    <Button size="sm" variant="ghost" onClick={() => {
                                                        const newFeatures = [...(block.features || []), "New Feature"];
                                                        updateBlock(index, { features: newFeatures });
                                                    }}>
                                                        <Plus className="w-3 h-3 mr-1" /> Add
                                                    </Button>
                                                </div>
                                                {(block.features || []).map((item: string, i: number) => (
                                                    <div key={i} className="flex gap-2 items-center">
                                                        <Check className="w-4 h-4 text-green-500" />
                                                        <Input
                                                            value={item || ""}
                                                            onChange={(e) => {
                                                                const newFeatures = [...(block.features || [])];
                                                                newFeatures[i] = e.target.value;
                                                                updateBlock(index, { features: newFeatures });
                                                            }}
                                                        />
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={() => {
                                                            const newFeatures = [...(block.features || [])];
                                                            newFeatures.splice(i, 1);
                                                            updateBlock(index, { features: newFeatures });
                                                        }}>
                                                            <X className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* CTA */}
                                            <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                                                <div className="space-y-2">
                                                    <Label>CTA Text</Label>
                                                    <Input
                                                        value={block.ctaText || ""}
                                                        onChange={(e) => updateBlock(index, { ctaText: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>CTA Link</Label>
                                                    <Input
                                                        value={block.ctaLink || ""}
                                                        onChange={(e) => updateBlock(index, { ctaLink: e.target.value })}
                                                    />
                                                </div>
                                            </div>

                                            {/* Overlay Card */}
                                            <div className="space-y-3 pt-3 border-t bg-slate-50/50 p-2 rounded">
                                                <div className="flex items-center gap-2">
                                                    <Label>Overlay Card</Label>
                                                    <span className="text-xs text-muted-foreground">(Optional floating card)</span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Input
                                                        placeholder="Title"
                                                        value={block.overlay?.title || ""}
                                                        onChange={(e) => updateBlock(index, { overlay: { ...block.overlay, title: e.target.value } })}
                                                        className="bg-white"
                                                    />
                                                    <Select value={block.overlay?.style || "default"} onValueChange={(val) => updateBlock(index, { overlay: { ...block.overlay, style: val } })}>
                                                        <SelectTrigger className="bg-white h-9"><SelectValue placeholder="Style" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="default">White / Default</SelectItem>
                                                            <SelectItem value="primary">Primary Brand Color</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <Textarea
                                                    placeholder="Overlay Text"
                                                    value={block.overlay?.text || ""}
                                                    onChange={(e) => updateBlock(index, { overlay: { ...block.overlay, text: e.target.value } })}
                                                    className="h-16 bg-white"
                                                />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Select value={block.overlay?.position || "top-left"} onValueChange={(val) => updateBlock(index, { overlay: { ...block.overlay, position: val } })}>
                                                        <SelectTrigger className="bg-white h-9"><SelectValue placeholder="Position" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="top-left">Top Left</SelectItem>
                                                            <SelectItem value="center-right">Center Right</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        placeholder="Icon (e.g. Award)"
                                                        value={block.overlay?.icon || ""}
                                                        onChange={(e) => updateBlock(index, { overlay: { ...block.overlay, icon: e.target.value } })}
                                                        className="bg-white"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* --- MANUAL STYLE CONTROLS --- */}
                                    <BlockStyleControls
                                        blockType={block.type}
                                        styles={block.styles || {}}
                                        onChange={(newStyles) => updateBlock(index, { styles: newStyles })}
                                        siteConfig={siteConfig}
                                    />

                                </CardContent>
                            </Card>

                            {/* AI CO-PILOT COLUMN REMOVED */}
                        </div>
                    ))
                    }

                    {
                        blocks.length === 0 && (
                            <div className="text-center p-8 border-2 border-dashed rounded-lg text-muted-foreground">
                                No blocks added yet. Import from URL or add manually.
                            </div>
                        )
                    }
                    <div className="flex justify-center pt-4 pb-8">
                        <Button
                            variant="outline"
                            size="lg"
                            className="gap-2 border-dashed border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 text-indigo-700 w-full max-w-md"
                            onClick={() => setIsAiSectionDialogOpen(true)}
                        >
                            <Sparkles className="w-5 h-5" />
                            Add Section with AI
                        </Button>
                    </div>
                </div>
            )
            }

            {/* AI Section Generation Dialog */}
            <Dialog open={isAiSectionDialogOpen} onOpenChange={setIsAiSectionDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600" />
                            Generate New Section with AI
                        </DialogTitle>
                        <DialogDescription>
                            Describe the section you want (e.g. "A 3-column feature list about our services") and our AI will build it for you.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>AI Model</Label>
                            <Select value={aiSectionModel} onValueChange={setAiSectionModel}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select Model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                        <SelectItem key={model.value} value={model.value}>
                                            {model.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Description (Prompt)</Label>
                            <Textarea
                                placeholder="Describe the section... e.g. 'A testimonial slider with a dark background'"
                                value={aiSectionPrompt}
                                onChange={(e) => setAiSectionPrompt(e.target.value)}
                                onPaste={handlePaste}
                                className="min-h-[100px]"
                            />
                            <p className="text-[10px] text-muted-foreground w-full text-right">
                                Tip: You can paste (Cmd+V) images directly here.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Reference Image (Optional)</Label>
                            <p className="text-[10px] text-muted-foreground mb-2">Upload a screenshot or design reference for the AI to analyze.</p>
                            <div onPaste={handlePaste} tabIndex={0} className="outline-none focus:ring-1 focus:ring-indigo-500 rounded p-1">
                                <ImageField
                                    value={aiSectionImage}
                                    onChange={setAiSectionImage}
                                    siteConfig={siteConfig}
                                />
                            </div>
                            {isPastingImage && <div className="text-xs text-indigo-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Uploading from clipboard...</div>}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAiSectionDialogOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleGenerateSection}
                            disabled={isGeneratingSection || !aiSectionPrompt}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {isGeneratingSection ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Generate Section
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
