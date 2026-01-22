"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { uploadToCrm, getUserLocation } from "./actions"; // Keep upload action for second step
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { CheckCircle2, Circle, Loader2, RefreshCw } from "lucide-react";
import { CloudflareImageUploader } from "@/components/media/CloudflareImageUploader";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { Switch } from "@/components/ui/switch";

type ImportStep = 'INIT' | 'SCRAPING' | 'AI_ANALYSIS' | 'MAP_RESOLUTION' | 'IMAGE_PROCESSING' | 'SAVING' | 'DONE';

interface ProgressStep {
    id: ImportStep;
    label: string;
}

const STEPS: ProgressStep[] = [
    { id: 'SCRAPING', label: 'Scraping/Input' },
    { id: 'AI_ANALYSIS', label: 'AI Analysis' },
    { id: 'MAP_RESOLUTION', label: 'Map Location' },
    { id: 'IMAGE_PROCESSING', label: 'Processing Images' },
    { id: 'SAVING', label: 'Saving Draft' },
];

export default function ImportPropertyPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [currentStep, setCurrentStep] = useState<ImportStep>('INIT');
    const [statusMessage, setStatusMessage] = useState("");
    const [previewData, setPreviewData] = useState<any>(null);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    useEffect(() => {
        let mounted = true;
        // Import dynamically to avoid circular deps if any, or just standard import
        import("@/app/(main)/admin/conversations/actions").then(mod => {
            mod.getAvailableAiModelsAction().then(models => {
                if (mounted && models && models.length > 0) setAvailableModels(models);
            });
        });
        return () => { mounted = false; };
    }, []);

    const [maxImages, setMaxImages] = useState(50);
    const [activeTab, setActiveTab] = useState("link");

    // Paste Mode State
    const [pasteText, setPasteText] = useState("");

    // Split Image State
    const [analysisImages, setAnalysisImages] = useState<string[]>([]);
    const [galleryImages, setGalleryImages] = useState<string[]>([]);

    const [userLocationId, setUserLocationId] = useState<string>("");
    const [cleanWhatsApp, setCleanWhatsApp] = useState(true);

    const [showCredsAlert, setShowCredsAlert] = useState(false);
    const [isRefineOpen, setIsRefineOpen] = useState(false);
    const [refineInstructions, setRefineInstructions] = useState("");
    const [interactionSelector, setInteractionSelector] = useState("");
    const [saveAsRule, setSaveAsRule] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // Fetch location for uploader
        getUserLocation().then(id => {
            if (id) setUserLocationId(id);
        });
    }, []);

    // Handlers for both uploaders
    async function onAnalysisImageUploaded(imageId: string) {
        setAnalysisImages(prev => [...prev, imageId]);
        toast.success("Analysis document uploaded!");
    }

    async function onGalleryImageUploaded(imageId: string) {
        setGalleryImages(prev => [...prev, imageId]);
        toast.success("Gallery photo uploaded!");
    }

    async function onRefine() {
        const notionUrlInput = document.getElementById("notionUrl") as HTMLInputElement;
        const url = notionUrlInput?.value;

        // If we are in Paste mode, URL is not required for refine necessarily, but Refine is mostly for URL mode re-runs.
        // For paste mode, users can just edit text and re-submit.
        // We will assume Refine is only for URL mode for now.
        if (activeTab === 'link' && !url) return toast.error("URL is missing");

        setIsRefineOpen(false);

        if (saveAsRule && refineInstructions && activeTab === 'link') {
            try {
                const { saveScrapeRule } = await import("@/app/actions/scrape-rules");

                const urlObj = new URL(url);
                const domain = urlObj.hostname;
                const pattern = `${urlObj.protocol}//${domain}/*`;

                const res = await saveScrapeRule(domain, pattern, refineInstructions, interactionSelector || undefined);
                if (res.success) {
                    toast.success("Rule saved for future imports!");
                } else {
                    toast.error("Failed to save rule: " + res.error);
                }
            } catch (e) {
                console.error(e);
                toast.error("Error saving rule");
            }
        }

        if (activeTab === 'link') {
            await startScrape(url, selectedModel, refineInstructions, maxImages);
        } else {
            // Re-run paste import
            await startPasteImport(pasteText, analysisImages, galleryImages, selectedModel, maxImages, refineInstructions);
        }
        setSaveAsRule(false);
    }


    async function startPasteImport(text: string, analysisImages: string[], galleryImages: string[], model: string, maxImg: number = 50, hints?: string) {
        setIsLoading(true);
        setPreviewData(null);
        setDraftId(null);
        setCurrentStep('INIT');
        setStatusMessage("Uploading and analyzing...");

        try {
            const response = await fetch("/api/import-stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text,
                    analysisImages,
                    galleryImages,
                    model,
                    maxImages: maxImg,
                    hints
                })
            });

            await handleStreamResponse(response);

        } catch (error: any) {
            console.error("Paste Import Failed:", error);
            toast.error("Import failed: " + error.message);
            setIsLoading(false);
        }
    }

    async function startScrape(notionUrl: string, model: string, hints?: string, maxImg: number = 50) {
        setIsLoading(true);
        setPreviewData(null);
        setDraftId(null);
        setCurrentStep('INIT');
        setStatusMessage(hints ? "Refining with your instructions..." : "Initializing...");

        try {
            let url = `/api/import-stream?notionUrl=${encodeURIComponent(notionUrl)}&model=${encodeURIComponent(model)}&maxImages=${maxImg}`;
            if (hints) url += `&hints=${encodeURIComponent(hints)}`;

            const response = await fetch(url);
            await handleStreamResponse(response);

        } catch (error: any) {
            console.error("Stream failed:", error);
            toast.error("Import failed: " + error.message);
            setIsLoading(false);
        }
    }

    async function handleStreamResponse(response: Response) {
        if (!response.ok) {
            if (response.status === 401) throw new Error("Unauthorized");
            throw new Error("Failed to start import stream");
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");

            // Process all complete lines
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);

                    if (event.type === 'status') {
                        setCurrentStep(event.step);
                        setStatusMessage(event.message);
                    } else if (event.type === 'result') {
                        setPreviewData(event.data);
                        setDraftId(event.propertyId);
                        setCurrentStep('DONE');
                        setStatusMessage("Import Complete!");
                    } else if (event.type === 'error') {
                        if (event.code === "MISSING_CREDENTIALS") {
                            setShowCredsAlert(true);
                        } else {
                            toast.error(event.message);
                        }
                        setIsLoading(false);
                        return; // Stop processing
                    }
                } catch (e) {
                    console.error("Error parsing stream line:", line, e);
                }
            }
        }
        setIsLoading(false);
    }

    async function onScrape(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const notionUrl = formData.get("notionUrl") as string;
        const model = formData.get("aiModel") as string || selectedModel;
        const maxImg = parseInt(formData.get("maxImages") as string || "50", 10);
        await startScrape(notionUrl, model, undefined, maxImg);
    }

    async function onPasteSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!pasteText && analysisImages.length === 0 && galleryImages.length === 0) return toast.error("Please provide text or images.");

        // Clean WhatsApp headers if enabled
        let finalText = pasteText;
        if (cleanWhatsApp) {
            // Regex to remove "[HH:MM, DD/MM/YYYY] Name: "
            finalText = finalText.replace(/^\[\d{2}:\d{2}, \d{2}\/\d{2}\/\d{4}\] .*?: /gm, '');
        }

        await startPasteImport(finalText, analysisImages, galleryImages, selectedModel, maxImages);
    }


    async function onUpload() {
        if (!draftId || !previewData) return;
        setIsLoading(true);
        setStatusMessage("Starting upload to CRM...");

        try {
            const result = await uploadToCrm(draftId, previewData.images);
            if (result.success) {
                setStatusMessage("Upload to CRM completed successfully!");
                toast.success("Import & Upload Complete!");
                setPreviewData(null);
                setDraftId(null);
                setCurrentStep('INIT');
                setPasteText("");
                setAnalysisImages([]); // Reset analysis
                setGalleryImages([]); // Reset gallery
            } else {
                setStatusMessage("Upload failed: " + result.error);
                toast.error("Upload failed");
            }
        } catch (error: any) {
            setStatusMessage("Error: " + error.message);
        } finally {
            setIsLoading(false);
        }
    }

    const getStepStatus = (stepId: ImportStep) => {
        if (currentStep === 'DONE') return 'done';

        const stepsOrder: ImportStep[] = ['INIT', 'SCRAPING', 'AI_ANALYSIS', 'MAP_RESOLUTION', 'IMAGE_PROCESSING', 'SAVING'];
        const currentIndex = stepsOrder.indexOf(currentStep);
        const stepIndex = stepsOrder.indexOf(stepId);

        if (stepIndex < currentIndex) return 'done';
        if (stepIndex === currentIndex) return 'doing';
        return 'todo';
    };

    const findSourceOf = (key: string, raw: any) => {
        if (!raw) return null;
        const sources = ['details', 'pricing', 'location', 'vision', 'specs', 'publish', 'category'];
        for (const source of sources) {
            if (raw[source] && raw[source][key] !== undefined) return `Found in ${source.toUpperCase()} analysis`;
        }
        return null;
    };

    return (
        <div className="container mx-auto py-8 px-4 max-w-4xl">
            <h1 className="text-3xl font-bold mb-8">Import Property</h1>

            <AlertDialog open={showCredsAlert} onOpenChange={setShowCredsAlert}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Missing Credentials</AlertDialogTitle>
                        <AlertDialogDescription>
                            To analyze the schema or import properties, you must first configure the old CRM credentials (URL, username, and password).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => router.push("/admin/settings/crm")}>
                            Go to Settings
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <div className="grid gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Step 1: Input Data</CardTitle>
                        <CardDescription>
                            Import from a URL or paste conversation/text directly.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-2 mb-4">
                                <TabsTrigger value="link">🌐 Web Link (Notion/Site)</TabsTrigger>
                                <TabsTrigger value="paste">📋 WhatsApp / Paste</TabsTrigger>
                            </TabsList>

                            <div className="space-y-4 mb-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="aiModel">AI Extraction Model</Label>
                                        <select
                                            id="aiModel"
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background disabled:opacity-50 md:text-sm"
                                            value={selectedModel}
                                            onChange={(e) => setSelectedModel(e.target.value)}
                                        >
                                            {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                                <option key={model.value} value={model.value}>
                                                    {model.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="maxImages">Max Images</Label>
                                        <Input
                                            type="number"
                                            min="1"
                                            max="100"
                                            value={maxImages}
                                            onChange={(e) => setMaxImages(parseInt(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>

                            <TabsContent value="link">
                                <form onSubmit={onScrape} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="notionUrl">Page URL</Label>
                                        <Input
                                            id="notionUrl"
                                            name="notionUrl"
                                            placeholder="https://pool-villas.com/property..."
                                            required
                                        />
                                    </div>
                                    <Button type="submit" disabled={isLoading} className="w-full">
                                        {isLoading ? "Scraping..." : "Scrape & Analyze"}
                                    </Button>
                                </form>
                            </TabsContent>

                            <TabsContent value="paste">
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <div className="flex flex-row items-center justify-between">
                                            <Label>Paste Conversation / Description</Label>
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="clean-whatsapp"
                                                    checked={cleanWhatsApp}
                                                    onCheckedChange={setCleanWhatsApp}
                                                />
                                                <Label htmlFor="clean-whatsapp" className="text-xs font-normal text-muted-foreground cursor-pointer">
                                                    Remove WhatsApp Metadata
                                                </Label>
                                            </div>
                                        </div>
                                        <Textarea
                                            placeholder="Paste WhatsApp messages, email content, or raw property text here..."
                                            className="min-h-[200px]"
                                            value={pasteText}
                                            onChange={(e) => setPasteText(e.target.value)}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        {/* 1. AI Analysis Images */}
                                        <div className="space-y-2 border p-4 rounded-md bg-yellow-50/50">
                                            <Label className="font-bold text-yellow-800">
                                                Step A: Upload AI Info Sources
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Screenshots of text, WhatsApp chats, or PDFs.
                                                <br /><strong>Analyzed by AI for data. NOT published.</strong>
                                            </p>

                                            <div className="flex flex-wrap gap-4 items-center">
                                                {userLocationId ? (
                                                    <CloudflareImageUploader
                                                        locationId={userLocationId}
                                                        buttonLabel="Add Source Doc"
                                                        onUploaded={onAnalysisImageUploaded}
                                                    />
                                                ) : (
                                                    <div className="text-sm text-yellow-600">Loading uploader...</div>
                                                )}
                                            </div>

                                            {analysisImages.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-2 p-2 bg-white rounded-md border min-h-[60px]">
                                                    {analysisImages.map((id, idx) => (
                                                        <div key={idx} className="relative group w-12 h-12">
                                                            <img
                                                                src={getImageDeliveryUrl(id, "avatar")}
                                                                className="w-full h-full object-cover rounded border"
                                                                alt="doc"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* 2. Gallery Images */}
                                        <div className="space-y-2 border p-4 rounded-md bg-blue-50/50">
                                            <Label className="font-bold text-blue-800">
                                                Step B: Upload Gallery Photos
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                High-quality photos of the property.
                                                <br /><strong>Published to website. NOT analyzed by AI.</strong>
                                            </p>

                                            <div className="flex flex-wrap gap-4 items-center">
                                                {userLocationId ? (
                                                    <CloudflareImageUploader
                                                        locationId={userLocationId}
                                                        buttonLabel="Add Property Photo"
                                                        onUploaded={onGalleryImageUploaded}
                                                    />
                                                ) : (
                                                    <div className="text-sm text-blue-600">Loading uploader...</div>
                                                )}
                                            </div>

                                            {galleryImages.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-2 p-2 bg-white rounded-md border min-h-[60px]">
                                                    {galleryImages.map((id, idx) => (
                                                        <div key={idx} className="relative group w-16 h-16">
                                                            <img
                                                                src={getImageDeliveryUrl(id, "avatar")}
                                                                className="w-full h-full object-cover rounded shadow-sm border"
                                                                alt="gallery"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <Button onClick={onPasteSubmit} disabled={isLoading} className="w-full">
                                        {isLoading ? "Analyzing..." : "Analyze Text & Images"}
                                    </Button>

                                    <div className="text-xs text-muted-foreground bg-blue-50 p-3 rounded border border-blue-100">
                                        <span className="font-bold">✨ Tip:</span> The AI will combine the text description with details found in the analysis images to creating the listing.
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>

                {/* Progress Stepper & Logs */}
                <Card>
                    <CardHeader>
                        <CardTitle>Import Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Stepper */}
                        <div className="flex justify-between items-center">
                            {STEPS.map((step, index) => {
                                const status = getStepStatus(step.id);
                                return (
                                    <div key={step.id} className="flex flex-col items-center gap-2 flex-1">
                                        <div className={`
                                            flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors
                                            ${status === 'done' ? 'bg-green-100 border-green-600 text-green-600' :
                                                status === 'doing' ? 'bg-blue-100 border-blue-600 text-blue-600 animate-pulse' :
                                                    'bg-muted border-muted-foreground/30 text-muted-foreground'}
                                        `}>
                                            {status === 'done' ? <CheckCircle2 className="w-5 h-5" /> :
                                                status === 'doing' ? <Loader2 className="w-5 h-5 animate-spin" /> :
                                                    <Circle className="w-5 h-5" />}
                                        </div>
                                        <span className={`text-xs font-medium text-center ${status === 'todo' ? 'text-muted-foreground' : 'text-foreground'}`}>
                                            {step.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Dynamic Status Message */}
                        <div className="bg-muted/50 p-4 rounded-md border text-center">
                            <p className="text-sm font-medium animate-pulse">
                                {statusMessage || "Ready to start..."}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {
                    previewData && (
                        <>
                            {/* Applied Rules Alert */}
                            {previewData.appliedRules && previewData.appliedRules.length > 0 && (
                                <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
                                    <h4 className="text-sm font-bold text-blue-800 mb-2 flex items-center gap-2">
                                        <span className="text-lg">🤖</span> Applied Persistent Scrape Rules
                                    </h4>
                                    <ul className="list-disc list-inside text-sm text-blue-700 space-y-1">
                                        {previewData.appliedRules.map((rule: string, idx: number) => (
                                            <li key={idx} className="font-medium">{rule}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <Tabs defaultValue="mapped" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="mapped">Mapped Fields (Database)</TabsTrigger>
                                    <TabsTrigger value="raw">Raw AI Output (Vision)</TabsTrigger>
                                </TabsList>

                                <TabsContent value="mapped">
                                    <Card className="border-green-500 border-2 shadow-lg">
                                        <CardHeader>
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <CardTitle>Data Mapping Review</CardTitle>
                                                    <CardDescription>
                                                        Found {Object.keys(previewData).length} data points. Review mappings below.
                                                    </CardDescription>
                                                </div>
                                                <div className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full">
                                                    Ready to Save
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                            <div className="rounded-md border overflow-hidden">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-muted/50">
                                                        <tr>
                                                            <th className="p-3 text-left font-bold text-muted-foreground w-1/3">Target Field (CRM)</th>
                                                            <th className="p-3 text-left font-bold text-muted-foreground w-1/3">Extracted Value</th>
                                                            <th className="p-3 text-left font-bold text-muted-foreground w-1/3">Source Context</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y relative bg-card">
                                                        {/* Standard Fields Dynamic Iteration */}
                                                        {Object.keys(previewData)
                                                            .filter(key => !['rawExtracted', 'images', 'features', 'mapUrl', 'latitude', 'longitude', 'shortMapLink'].includes(key))
                                                            .sort()
                                                            .map((key) => {
                                                                const val = previewData[key];
                                                                const rawSource = previewData.rawExtracted ? findSourceOf(key, previewData.rawExtracted) : null;

                                                                return (
                                                                    <tr key={key} className="group hover:bg-muted/50 transition-colors">
                                                                        <td className="p-3 font-medium text-foreground/80 group-hover:text-foreground font-mono text-xs">
                                                                            {key}
                                                                        </td>
                                                                        <td className="p-3">
                                                                            {key === 'description' ? (
                                                                                <div className="max-h-[300px] overflow-y-auto text-xs p-2 bg-muted rounded border font-mono whitespace-pre-wrap">
                                                                                    {val}
                                                                                </div>
                                                                            ) : (
                                                                                val !== undefined && val !== null && val !== "" ? (
                                                                                    typeof val === 'boolean' ? (val ? "Yes" : "No") :
                                                                                        <span className="font-semibold text-foreground break-all">{val.toString()}</span>
                                                                                ) : (
                                                                                    <span className="text-muted-foreground italic text-xs">-- Empty --</span>
                                                                                )
                                                                            )}
                                                                        </td>
                                                                        <td className="p-3 text-muted-foreground text-xs font-mono">
                                                                            {rawSource || "Inferred"}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}

                                                        <tr className="group hover:bg-muted/50 transition-colors bg-blue-50/30">
                                                            <td className="p-3 font-medium font-mono text-xs">features</td>
                                                            <td className="p-3" colSpan={2}>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {previewData.features && previewData.features.length > 0 ?
                                                                        previewData.features.map((f: string) => (
                                                                            <span key={f} className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors border-transparent bg-blue-50 text-blue-700">
                                                                                {f}
                                                                            </span>
                                                                        )) :
                                                                        <span className="text-muted-foreground italic text-xs">No features detected</span>
                                                                    }
                                                                </div>
                                                            </td>
                                                        </tr>

                                                        <tr className="group hover:bg-muted/50 transition-colors">
                                                            <td className="p-3 font-medium font-mono text-xs">images</td>
                                                            <td className="p-3" colSpan={2}>
                                                                {previewData.images?.length > 0 ? (
                                                                    <div className="flex flex-col gap-2">
                                                                        <div className="flex justify-between items-center">
                                                                            <span className="text-xs font-bold text-muted-foreground">{previewData.images.length} images found</span>
                                                                            <span className="text-xs text-muted-foreground">Showing all</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                                                                            {previewData.images.map((src: string, i: number) => (
                                                                                <img key={i} src={src} className="h-12 w-12 rounded-md ring-1 ring-border object-cover bg-muted hover:scale-150 transition-transform origin-center z-0 hover:z-10 shadow-sm" title={src} />
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ) : <span className="text-orange-500 font-bold text-xs">No Images Found</span>}
                                                            </td>
                                                        </tr>

                                                        <tr className="group hover:bg-muted/50 transition-colors">
                                                            <td className="p-3 font-medium font-mono text-xs">geolocation</td>
                                                            <td className="p-3">
                                                                {previewData.latitude && previewData.longitude ?
                                                                    `${previewData.latitude}, ${previewData.longitude}` :
                                                                    <span className="text-muted-foreground italic text-xs">-- Empty --</span>
                                                                }
                                                                {previewData.mapUrl && <div className="text-xs text-blue-600 mt-1 truncate max-w-[200px]">{previewData.mapUrl}</div>}
                                                            </td>
                                                            <td className="p-3 text-muted-foreground text-xs font-mono">
                                                                {previewData.mapUrl ? "From Map URL" : "Inferred"}
                                                            </td>
                                                        </tr>

                                                        {/* Discovered Fields (Metadata) */}
                                                        {previewData.metadata && Object.keys(previewData.metadata).length > 0 && (
                                                            <>
                                                                <tr className="bg-yellow-50/50">
                                                                    <td colSpan={3} className="p-2 text-xs font-bold text-yellow-700 uppercase tracking-wider text-center border-y border-yellow-200">
                                                                        🚀 New Discovered Fields (Will be saved to Metadata)
                                                                    </td>
                                                                </tr>
                                                                {Object.entries(previewData.metadata).map(([key, value]) => (
                                                                    <tr key={`meta-${key}`} className="group hover:bg-yellow-50 transition-colors">
                                                                        <td className="p-3 font-medium text-foreground/80 font-mono text-xs text-yellow-800">
                                                                            {key}
                                                                        </td>
                                                                        <td className="p-3">
                                                                            <span className="font-semibold text-foreground break-all">
                                                                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                                                            </span>
                                                                        </td>
                                                                        <td className="p-3 text-muted-foreground text-xs font-mono">
                                                                            AI Discovery
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </>
                                                        )}

                                                    </tbody>
                                                </table>
                                            </div>

                                            <div className="flex flex-col gap-3">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setIsRefineOpen(true)}
                                                    className="w-full border-dashed"
                                                >
                                                    ✨ Refine Results with AI Instructions
                                                </Button>
                                                <Button
                                                    onClick={() => router.push(`/admin/properties?propertyId=${draftId}`)}
                                                    className="w-full bg-blue-600 hover:bg-blue-700 font-bold shadow-md"
                                                    size="lg"
                                                >
                                                    Upload & Edit Property &rarr;
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="raw">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Raw AI Vision Output</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <pre className="bg-muted p-4 rounded-md overflow-auto text-xs font-mono max-h-[500px]">
                                                {JSON.stringify(previewData.rawExtracted, null, 2)}
                                            </pre>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            </Tabs>
                        </>
                    )
                }
                <AlertDialog open={isRefineOpen} onOpenChange={setIsRefineOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Refine Extraction</AlertDialogTitle>
                            <AlertDialogDescription>
                                Provide instructions to the AI to fix missing or incorrect fields.
                                <br />
                                (e.g., "The price is 500,000" or "The bedrooms are listed in the description as 3")
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="py-2 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold">Instructions for AI</label>
                                <textarea
                                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="Enter instructions..."
                                    value={refineInstructions}
                                    onChange={(e) => setRefineInstructions(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold">Interaction Target (Optional)</label>
                                <p className="text-[10px] text-muted-foreground">
                                    Enters a CSS selector OR simply the <strong>text on the button</strong> you want to click.
                                </p>
                                <Input
                                    placeholder="e.g. 'View Gallery' OR .gallery-btn"
                                    value={interactionSelector}
                                    onChange={(e) => setInteractionSelector(e.target.value)}
                                />
                            </div>
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={onRefine}>Refine</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div >
        </div >
    );
}

