"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { updateAiSettings } from "./actions";
import { Input } from "@/components/ui/input";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK, GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SkillRuntimeSettings } from "./skill-runtime-settings";

const initialState = {
    message: "",
    errors: {},
};

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save Changes"}
        </Button>
    );
}

export function AiSettingsForm({
    initialData,
    locationId,
    settingsVersion,
    hasGoogleAiApiKey,
    runtimeSummary,
}: {
    initialData: any,
    locationId: string,
    settingsVersion: number,
    hasGoogleAiApiKey: boolean,
    runtimeSummary?: {
        totalPolicies: number;
        enabledPolicies: number;
        nextRunAt: string | null;
        pendingJobs: number;
        deadJobs: number;
        pendingSuggestions: number;
        policies: Array<{
            id: string;
            skillId: string;
            objective: string;
            enabled: boolean;
            version: number;
            decisionPolicy: any;
            channelPolicy: any;
            compliancePolicy: any;
            updatedAt: string;
        }>;
        recentDecisions: Array<{
            id: string;
            selectedSkillId: string | null;
            selectedObjective: string | null;
            selectedScore: number | null;
            status: string;
            source: string;
            holdReason: string | null;
            traceId: string | null;
            createdAt: string;
        }>;
        recentJobs: Array<{
            id: string;
            selectedSkillId: string | null;
            selectedObjective: string | null;
            status: string;
            attemptCount: number;
            maxAttempts: number;
            scheduledAt: string;
            processedAt: string | null;
            traceId: string | null;
            lastError: string | null;
            createdAt: string;
        }>;
    } | null,
}) {
    const [state, action] = useActionState(updateAiSettings, initialState);

    // Local state for research URL since it's not persisted in DB directly here
    // but used for the "Generate Brand Voice" action
    const [researchUrl, setResearchUrl] = useState("");
    const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

    const [availableModels, setAvailableModels] = useState<any[]>([]);
    const [googleAiModel, setGoogleAiModel] = useState(
        (typeof initialData?.googleAiModel === "string" && initialData.googleAiModel.trim()) || GEMINI_FLASH_LATEST_ALIAS
    );
    const [googleAiModelExtraction, setGoogleAiModelExtraction] = useState(
        (typeof initialData?.googleAiModelExtraction === "string" && initialData.googleAiModelExtraction.trim())
        || (typeof initialData?.googleAiModel === "string" && initialData.googleAiModel.trim())
        || GEMINI_FLASH_LATEST_ALIAS
    );
    const [googleAiModelDesign, setGoogleAiModelDesign] = useState(
        (typeof initialData?.googleAiModelDesign === "string" && initialData.googleAiModelDesign.trim())
        || (typeof initialData?.googleAiModel === "string" && initialData.googleAiModel.trim())
        || GEMINI_FLASH_LATEST_ALIAS
    );
    const [googleAiModelTranscription, setGoogleAiModelTranscription] = useState(
        (typeof initialData?.googleAiModelTranscription === "string" && initialData.googleAiModelTranscription.trim())
        || (typeof initialData?.googleAiModelExtraction === "string" && initialData.googleAiModelExtraction.trim())
        || GEMINI_FLASH_STABLE_FALLBACK
    );
    const hasUserSelectedGeneralModelRef = useRef(false);
    const hasUserSelectedExtractionModelRef = useRef(false);
    const hasUserSelectedDesignModelRef = useRef(false);
    const hasUserSelectedTranscriptionModelRef = useRef(false);

    const hasConfiguredGeneralModel = Boolean(
        typeof initialData?.googleAiModel === "string" && initialData.googleAiModel.trim()
    );
    const hasConfiguredExtractionModel = Boolean(
        typeof initialData?.googleAiModelExtraction === "string" && initialData.googleAiModelExtraction.trim()
    );
    const hasConfiguredDesignModel = Boolean(
        typeof initialData?.googleAiModelDesign === "string" && initialData.googleAiModelDesign.trim()
    );
    const hasConfiguredTranscriptionModel = Boolean(
        typeof initialData?.googleAiModelTranscription === "string" && initialData.googleAiModelTranscription.trim()
    );

    useEffect(() => {
        let mounted = true;
        // Dynamically import action if needed or just use import
        import("@/app/(main)/admin/conversations/actions").then(mod => {
            mod.getAiModelPickerDefaultsAction().then(({ models, defaults }: any) => {
                if (mounted && models && models.length > 0) {
                    setAvailableModels(models);

                    if (!hasUserSelectedGeneralModelRef.current && !hasConfiguredGeneralModel && defaults?.general) {
                        setGoogleAiModel(defaults.general);
                    }
                    if (!hasUserSelectedExtractionModelRef.current && !hasConfiguredExtractionModel && defaults?.extraction) {
                        setGoogleAiModelExtraction(defaults.extraction);
                    }
                    if (!hasUserSelectedDesignModelRef.current && !hasConfiguredDesignModel && defaults?.design) {
                        setGoogleAiModelDesign(defaults.design);
                    }
                    if (!hasUserSelectedTranscriptionModelRef.current && !hasConfiguredTranscriptionModel) {
                        setGoogleAiModelTranscription(defaults?.extraction || defaults?.general || GEMINI_FLASH_STABLE_FALLBACK);
                    }
                }
            });
        });
        return () => { mounted = false; };
    }, [hasConfiguredDesignModel, hasConfiguredExtractionModel, hasConfiguredGeneralModel, hasConfiguredTranscriptionModel]);

    return (
        <div className="space-y-8">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Sparkles className="w-24 h-24 text-indigo-600" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2 text-indigo-700">
                        <Sparkles className="w-5 h-5" />
                        <h3 className="text-lg font-bold">AI Configuration</h3>
                    </div>
                    <p className="text-sm text-indigo-600/80 max-w-lg">
                        Configure the brains behind your agent. Set up your API keys and choose the models that power different parts of the system.
                    </p>
                </div>
            </div>

            <form action={action} className="space-y-8">
                <input type="hidden" name="locationId" value={locationId} />
                <input type="hidden" name="settingsVersion" value={String(settingsVersion)} />

                {/* API Keys */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">API Keys</h3>
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="googleAiApiKey">Google Gemini AI API Key</Label>
                            <Input
                                id="googleAiApiKey"
                                name="googleAiApiKey"
                                type="password"
                                placeholder="AIza..."
                            />
                            <p className="text-sm text-muted-foreground">
                                Required for AI content generation features. Existing keys are encrypted at rest and are never returned in plaintext.
                            </p>
                            {hasGoogleAiApiKey && (
                                <div className="flex items-center gap-2 text-xs text-emerald-700">
                                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                    API key is configured.
                                </div>
                            )}
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input
                                    type="checkbox"
                                    name="clearGoogleAiApiKey"
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-red-600"
                                />
                                Clear saved API key
                            </label>
                        </div>
                    </div>
                </div>

                <Separator />

                {/* AI Model Configuration */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Model Configuration</h3>
                    <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">

                        {/* General / Default */}
                        <div className="grid gap-2">
                            <Label htmlFor="googleAiModel">Default Model (General)</Label>
                            <select
                                id="googleAiModel"
                                name="googleAiModel"
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={googleAiModel}
                                onChange={(e) => {
                                    hasUserSelectedGeneralModelRef.current = true;
                                    setGoogleAiModel(e.target.value);
                                }}
                            >
                                {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                            {/* Stage 1: Extraction */}
                            <div className="grid gap-2">
                                <Label htmlFor="googleAiModelExtraction" className="text-xs text-slate-500 uppercase tracking-wider">Stage 1: Extraction</Label>
                                <select
                                    id="googleAiModelExtraction"
                                    name="googleAiModelExtraction"
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                    value={googleAiModelExtraction}
                                    onChange={(e) => {
                                        hasUserSelectedExtractionModelRef.current = true;
                                        setGoogleAiModelExtraction(e.target.value);
                                    }}
                                >
                                    {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                        <option key={model.value} value={model.value}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-muted-foreground">Used for scraping & initial structure.</p>
                            </div>

                            {/* Stage 2: Design */}
                            <div className="grid gap-2">
                                <Label htmlFor="googleAiModelDesign" className="text-xs text-slate-500 uppercase tracking-wider">Stage 2: Design Engine</Label>
                                <select
                                    id="googleAiModelDesign"
                                    name="googleAiModelDesign"
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                    value={googleAiModelDesign}
                                    onChange={(e) => {
                                        hasUserSelectedDesignModelRef.current = true;
                                        setGoogleAiModelDesign(e.target.value);
                                    }}
                                >
                                    {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                        <option key={model.value} value={model.value}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-muted-foreground">Used for redesigns & badges.</p>
                            </div>

                            {/* Audio Transcription */}
                            <div className="grid gap-2">
                                <Label htmlFor="googleAiModelTranscription" className="text-xs text-slate-500 uppercase tracking-wider">Audio: Transcription</Label>
                                <select
                                    id="googleAiModelTranscription"
                                    name="googleAiModelTranscription"
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                    value={googleAiModelTranscription}
                                    onChange={(e) => {
                                        hasUserSelectedTranscriptionModelRef.current = true;
                                        setGoogleAiModelTranscription(e.target.value);
                                    }}
                                >
                                    {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                        <option key={model.value} value={model.value}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-muted-foreground">Used for WhatsApp audio transcript generation.</p>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                            <div className="space-y-0.5">
                                <Label htmlFor="whatsappTranscriptOnDemandEnabled" className="text-xs text-slate-500 uppercase tracking-wider">
                                    Audio: On-demand Controls
                                </Label>
                                <p className="text-[10px] text-muted-foreground">
                                    Enables `Transcribe now`, `Regenerate transcript`, and conversation bulk backfill actions.
                                </p>
                            </div>
                            <input
                                id="whatsappTranscriptOnDemandEnabled"
                                name="whatsappTranscriptOnDemandEnabled"
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                                defaultChecked={initialData?.whatsappTranscriptOnDemandEnabled === true}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
                                <Label htmlFor="whatsappTranscriptRetentionDays" className="text-xs text-slate-500 uppercase tracking-wider">
                                    Audio: Retention Policy
                                </Label>
                                <select
                                    id="whatsappTranscriptRetentionDays"
                                    name="whatsappTranscriptRetentionDays"
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                    defaultValue={String(initialData?.whatsappTranscriptRetentionDays || 90)}
                                >
                                    <option value="30">30 days</option>
                                    <option value="90">90 days</option>
                                    <option value="365">365 days</option>
                                </select>
                                <p className="text-[10px] text-muted-foreground">
                                    Applies to automatic transcript cleanup jobs.
                                </p>
                            </div>

                            <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
                                <Label htmlFor="whatsappTranscriptVisibility" className="text-xs text-slate-500 uppercase tracking-wider">
                                    Audio: Visibility Policy
                                </Label>
                                <select
                                    id="whatsappTranscriptVisibility"
                                    name="whatsappTranscriptVisibility"
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                    defaultValue={String(initialData?.whatsappTranscriptVisibility || "team")}
                                >
                                    <option value="team">Team members</option>
                                    <option value="admin_only">Admins only</option>
                                </select>
                                <p className="text-[10px] text-muted-foreground">
                                    Controls who can view transcript text and extraction payloads.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <Separator />

                <SkillRuntimeSettings
                    locationId={locationId}
                    summary={runtimeSummary || null}
                />

                <Separator />

                {/* Outreach Assistant Configuration */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Outreach Assistant</h3>
                    <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id="outreachEnabled"
                                name="outreachEnabled"
                                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                                defaultChecked={initialData?.outreachConfig?.enabled ?? false}
                            />
                            <Label htmlFor="outreachEnabled" className="font-medium">Enable Martin's Outreach Assistant</Label>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Automatically analyze new leads to generate Vision IDs, extract requirements, and draft agentic follow-up messages.
                        </p>

                        <div className="grid gap-4 pt-2">
                            <div className="grid gap-2">
                                <Label htmlFor="visionIdPrompt">Vision ID & Extraction Prompt</Label>
                                <textarea
                                    id="visionIdPrompt"
                                    name="visionIdPrompt"
                                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    placeholder="Instructions for generating the Visual ID and extracting requirements..."
                                    defaultValue={initialData?.outreachConfig?.visionIdPrompt || `Analyze Input: Identify the lead's name, whether it is a Rent or Sale inquiry, the property URL (if any), and the notes provided.

Contact Creation: Generate the "First Name" and "Last Name" fields for a phone contact.

First Name Field: [Full First Name] [Full Last Name]
Last Name (Second Name) Field: Lead [Rent/Sale] [Ref #] [Brief Details]

If a specific property URL is provided: Include the Ref number, type (2bdr Apt), Area, and Price.
Example: Lead Rent DT4012 2bdr Apt Chlorakas, Paphos €750/mo

If multiple properties or general notes are provided: Use the Ref numbers and key requirements (Budget/Area).
Example: Lead Rent DT1234/DT5562 Paphos/Peyia €1200 Budget

Sale vs Rent: Always specify "Lead Sale" or "Lead Rent" at the start.

Also extract any explicit requirements (District, Bedrooms, Price, etc.) to populate the contact fields.`}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="icebreakerPrompt">Step 1: The Icebreaker Prompt</Label>
                                <textarea
                                    id="icebreakerPrompt"
                                    name="icebreakerPrompt"
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    placeholder="Draft a very short message to acknowledge the inquiry..."
                                    defaultValue={initialData?.outreachConfig?.icebreakerPrompt || `Goal: Get a response about a viewing.
Content: Mention the specific property (if URL/Ref provided) or the general area.
Tone: Concise, direct, and helpful. No "How are you?" or "Hope you're well."
At the end of the first message only write the exact property mentioned full url for the leads reference.`}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="qualifierPrompt">Step 2: The Qualifier Prompt</Label>
                                <textarea
                                    id="qualifierPrompt"
                                    name="qualifierPrompt"
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    placeholder="Draft a follow-up message to be sent after they reply..."
                                    defaultValue={initialData?.outreachConfig?.qualifierPrompt || `Goal: Gather data not found in the initial lead file.
Questions to include:
"When are you looking to start a tenancy?" (or "When are you looking to purchase?" if sale).
"How long of a contract are you looking for?" (If rent).
"What is your monthly budget range?"
"Are there any other options on downtowncyprus.com you’d like to see?"
Ask for their email address to set up automated property alerts.`}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <Separator />

                {/* Brand Voice Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Brand Voice & Research</h3>

                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="researchUrl">Existing Website URL (for AI Research)</Label>
                            <Input
                                id="researchUrl"
                                value={researchUrl}
                                onChange={(e) => setResearchUrl(e.target.value)}
                                placeholder="https://downtowncyprus.com"
                                className="bg-muted/50"
                            />
                            <p className="text-sm text-muted-foreground">
                                Enter your current live website URL here. The AI will browse this site to learn your brand voice.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="brandVoice">Brand Voice Instructions</Label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                    disabled={isGeneratingVoice}
                                    onClick={async () => {
                                        if (!researchUrl) {
                                            toast.error("Please enter an Existing Website URL first.");
                                            return;
                                        }

                                        setIsGeneratingVoice(true);
                                        try {
                                            const { generateBrandVoiceFromSite } = await import("@/app/(main)/admin/content/ai-actions");
                                            const result = await generateBrandVoiceFromSite(locationId, researchUrl);

                                            if (result.success && result.voice) {
                                                const textarea = document.getElementById("brandVoice") as HTMLTextAreaElement;
                                                if (textarea) {
                                                    textarea.value = result.voice;
                                                    toast.success("Brand Voice generated from research!");
                                                }
                                            } else {
                                                toast.error(result.error || "Failed to generate voice.");
                                            }
                                        } catch (e) {
                                            toast.error("Error generating voice.");
                                        } finally {
                                            setIsGeneratingVoice(false);
                                        }
                                    }}
                                >
                                    {isGeneratingVoice ? (
                                        <>
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Researching...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-3 h-3" />
                                            Generate with AI
                                        </>
                                    )}
                                </Button>
                            </div>
                            <textarea
                                id="brandVoice"
                                name="brandVoice"
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="e.g. Professional, authoritative, yet approachable. We focus on luxury properties and high-net-worth individuals."
                                defaultValue={initialData?.brandVoice || ""}
                            />
                            <p className="text-sm text-muted-foreground">
                                Describe your brand's tone of voice. This will guide the AI when rewriting imported content.
                            </p>
                        </div>
                    </div>
                </div>

                {state?.errors?._form && (
                    <div className="p-3 bg-red-100 text-red-700 text-sm rounded-md">
                        {state.errors._form}
                    </div>
                )}
                {state?.errors?._version && (
                    <div className="p-3 bg-red-100 text-red-700 text-sm rounded-md">
                        {state.errors._version}
                    </div>
                )}

                {state?.message && (
                    <div className="p-3 bg-green-100 text-green-700 text-sm rounded-md">
                        {state.message}
                    </div>
                )}

                <div className="flex justify-end">
                    <SubmitButton />
                </div>
            </form>
        </div>
    );
}
