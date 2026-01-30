"use client";

import { useActionState, useState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { updateAiSettings } from "./actions";
import { Input } from "@/components/ui/input";
import { GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

export function AiSettingsForm({ initialData, locationId }: { initialData: any, locationId: string }) {
    const [state, action] = useActionState(updateAiSettings, initialState);

    // Local state for research URL since it's not persisted in DB directly here
    // but used for the "Generate Brand Voice" action
    const [researchUrl, setResearchUrl] = useState("");
    const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

    const [availableModels, setAvailableModels] = useState<any[]>([]);

    useEffect(() => {
        let mounted = true;
        // Dynamically import action if needed or just use import
        import("@/app/(main)/admin/conversations/actions").then(mod => {
            mod.getAvailableAiModelsAction().then(models => {
                if (mounted && models && models.length > 0) setAvailableModels(models);
            });
        });
        return () => { mounted = false; };
    }, []);

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
                                defaultValue={initialData?.googleAiApiKey || ""}
                            />
                            <p className="text-sm text-muted-foreground">
                                Required for AI content generation features. Get your key from Google AI Studio.
                            </p>
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
                                defaultValue={initialData?.googleAiModel || "gemini-2.5-flash"}
                            >
                                {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            {/* Stage 1: Extraction */}
                            <div className="grid gap-2">
                                <Label htmlFor="googleAiModelExtraction" className="text-xs text-slate-500 uppercase tracking-wider">Stage 1: Extraction</Label>
                                <select
                                    id="googleAiModelExtraction"
                                    name="googleAiModelExtraction"
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                    defaultValue={initialData?.googleAiModelExtraction || "gemini-2.5-flash"}
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
                                    defaultValue={initialData?.googleAiModelDesign || "gemini-2.5-flash"}
                                >
                                    {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map((model) => (
                                        <option key={model.value} value={model.value}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-muted-foreground">Used for redesigns & badges.</p>
                            </div>
                        </div>
                    </div>
                </div>

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
