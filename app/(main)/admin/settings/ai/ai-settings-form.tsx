"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { runRequirementsIntelligenceNowAction, updateAiSettings } from "./actions";
import { Input } from "@/components/ui/input";
import { DEFAULT_REPLY_LANGUAGE, REPLY_LANGUAGE_OPTIONS } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK, GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SkillRuntimeSettings } from "./skill-runtime-settings";

type AiSettingsFormState = {
    message?: string;
    version?: number;
    errors?: {
        _form?: string[];
        _version?: string[];
    };
};

type RequirementsLastRunStats = {
    contactsChecked?: number;
    contactsWithoutNewActivity?: number;
    skippedPending?: number;
    proposalsCreated?: number;
    failures?: number;
};

type RequirementsLastRun = {
    status?: string;
    source?: string;
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    mode?: string;
    batchSize?: number;
    stats?: RequirementsLastRunStats;
    error?: string | null;
};

type RequirementsIntelligenceSettings = {
    mode?: string;
    model?: string;
    allowedPropertyDomains?: string[];
    lastRun?: RequirementsLastRun | null;
};

type AiSettingsInitialData = {
    [key: string]: unknown;
    defaultReplyLanguage?: string;
    googleAiModel?: string;
    googleAiModelExtraction?: string;
    googleAiModelDesign?: string;
    googleAiModelTranscription?: string;
    googleAiModelTranslation?: string;
    whatsappTranscriptOnDemandEnabled?: boolean;
    whatsappTranscriptRetentionDays?: number | string;
    whatsappTranscriptVisibility?: string;
    viewingSessionRetentionDays?: number | string;
    viewingSessionTranscriptVisibility?: string;
    viewingSessionAiDisclosureRequired?: boolean;
    viewingSessionRawAudioStorageEnabled?: boolean;
    viewingSessionAiDisclosureVersion?: string;
    viewingSessionTranslationModel?: string;
    viewingSessionInsightsModel?: string;
    viewingSessionSummaryModel?: string;
    precisionRemoveEnabled?: boolean;
    brandVoice?: string;
    outreachConfig?: {
        enabled?: boolean;
        visionIdPrompt?: string;
        icebreakerPrompt?: string;
        qualifierPrompt?: string;
    };
    requirementsIntelligence?: RequirementsIntelligenceSettings;
};

type AiRuntimeSummary = {
    totalPolicies: number;
    enabledPolicies: number;
    nextRunAt: string | null;
    pendingJobs: number;
    deadJobs: number;
    pendingSuggestions: number;
    pendingRequirementProposals?: number;
    requirementsIntelligence?: RequirementsIntelligenceSettings;
    policies: Array<{
        id: string;
        skillId: string;
        objective: string;
        enabled: boolean;
        version: number;
        decisionPolicy: unknown;
        channelPolicy: unknown;
        compliancePolicy: unknown;
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
};

type AiModelPickerDefaults = Partial<Record<"general" | "extraction" | "design" | "translation", string>>;

const initialState: AiSettingsFormState = {
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

function AiSettingsFormFooter({ state }: { state: AiSettingsFormState }) {
    return (
        <>
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
        </>
    );
}

type AiModelOption = {
    value: string;
    label: string;
};

function AiModelSelect({
    id,
    name,
    label,
    value,
    models,
    description,
    compactLabel = false,
    onChange,
}: {
    id: string;
    name: string;
    label: string;
    value: string;
    models: AiModelOption[];
    description?: string;
    compactLabel?: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <div className="grid gap-2">
            <Label
                htmlFor={id}
                className={compactLabel ? "text-xs text-slate-500 uppercase tracking-wider" : undefined}
            >
                {label}
            </Label>
            <select
                id={id}
                name={name}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                {models.map((model) => (
                    <option key={model.value} value={model.value}>
                        {model.label}
                    </option>
                ))}
            </select>
            {description ? <p className="text-[10px] text-muted-foreground">{description}</p> : null}
        </div>
    );
}

function getInitialStringValue(initialData: AiSettingsInitialData, key: string): string {
    const value = initialData?.[key];
    return typeof value === "string" ? value.trim() : "";
}

function getInitialModelValue(initialData: AiSettingsInitialData, keys: string[], fallback: string): string {
    for (const key of keys) {
        const value = getInitialStringValue(initialData, key);
        if (value) return value;
    }

    return fallback;
}

function hasInitialModelValue(initialData: AiSettingsInitialData, key: string): boolean {
    return Boolean(getInitialStringValue(initialData, key));
}

function ModelSelectionSection({
    initialData,
    modelOptions,
    googleAiModel,
    googleAiModelExtraction,
    googleAiModelDesign,
    googleAiModelTranscription,
    googleAiModelTranslation,
    onGeneralModelChange,
    onExtractionModelChange,
    onDesignModelChange,
    onTranscriptionModelChange,
    onTranslationModelChange,
}: {
    initialData: AiSettingsInitialData;
    modelOptions: AiModelOption[];
    googleAiModel: string;
    googleAiModelExtraction: string;
    googleAiModelDesign: string;
    googleAiModelTranscription: string;
    googleAiModelTranslation: string;
    onGeneralModelChange: (value: string) => void;
    onExtractionModelChange: (value: string) => void;
    onDesignModelChange: (value: string) => void;
    onTranscriptionModelChange: (value: string) => void;
    onTranslationModelChange: (value: string) => void;
}) {
    return (
        <>
            <div className="grid gap-2">
                <Label htmlFor="defaultReplyLanguage">Default Reply Language</Label>
                <select
                    id="defaultReplyLanguage"
                    name="defaultReplyLanguage"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    defaultValue={String(initialData?.defaultReplyLanguage || DEFAULT_REPLY_LANGUAGE)}
                >
                    {REPLY_LANGUAGE_OPTIONS.map((language) => (
                        <option key={language.value} value={language.value}>
                            {language.label}
                        </option>
                    ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                    AI Draft `Auto` follows this location default unless the conversation picker is set to a specific language.
                </p>
            </div>

            <AiModelSelect
                id="googleAiModel"
                name="googleAiModel"
                label="Default Model (General)"
                value={googleAiModel}
                models={modelOptions}
                onChange={onGeneralModelChange}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <AiModelSelect
                    id="googleAiModelExtraction"
                    name="googleAiModelExtraction"
                    label="Stage 1: Extraction"
                    value={googleAiModelExtraction}
                    models={modelOptions}
                    compactLabel
                    description="Used for scraping & initial structure."
                    onChange={onExtractionModelChange}
                />

                <AiModelSelect
                    id="googleAiModelDesign"
                    name="googleAiModelDesign"
                    label="Stage 2: Design Engine"
                    value={googleAiModelDesign}
                    models={modelOptions}
                    compactLabel
                    description="Used for redesigns & badges."
                    onChange={onDesignModelChange}
                />

                <AiModelSelect
                    id="googleAiModelTranscription"
                    name="googleAiModelTranscription"
                    label="Audio: Transcription"
                    value={googleAiModelTranscription}
                    models={modelOptions}
                    compactLabel
                    description="Used for WhatsApp audio transcript generation."
                    onChange={onTranscriptionModelChange}
                />

                <AiModelSelect
                    id="googleAiModelTranslation"
                    name="googleAiModelTranslation"
                    label="Conversation: Translation"
                    value={googleAiModelTranslation}
                    models={modelOptions}
                    compactLabel
                    description="Used for conversation message, thread, and reply translation."
                    onChange={onTranslationModelChange}
                />
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
        </>
    );
}

function RequirementsIntelligenceSection({
    initialData,
    modelOptions,
    fallbackModel,
    pendingRequirementProposals,
    requirementsLastRun,
    runningRequirementsScan,
    onRunRequirementsScan,
}: {
    initialData: AiSettingsInitialData;
    modelOptions: AiModelOption[];
    fallbackModel: string;
    pendingRequirementProposals: number;
    requirementsLastRun: RequirementsLastRun | null;
    runningRequirementsScan: boolean;
    onRunRequirementsScan: () => void;
}) {
    const formatDateLabel = (value: string | null | undefined) => {
        if (!value) return "Never";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
    };

    return (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="space-y-0.5">
                <Label className="text-xs text-slate-500 uppercase tracking-wider">
                    AI Requirement Intelligence
                </Label>
                <p className="text-[10px] text-muted-foreground">
                    Maintains evolving client search criteria as human-approved contact updates.
                </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="requirementsIntelligenceMode" className="text-xs text-slate-500 uppercase tracking-wider">
                        Mode
                    </Label>
                    <select
                        id="requirementsIntelligenceMode"
                        name="requirementsIntelligenceMode"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        defaultValue={String(initialData?.requirementsIntelligence?.mode || "manual_only")}
                    >
                        <option value="off">Off</option>
                        <option value="manual_only">Manual only</option>
                        <option value="new_activity">Suggest from new activity</option>
                        <option value="daily_and_new_activity">Daily scan + new activity</option>
                    </select>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="requirementsIntelligenceModel" className="text-xs text-slate-500 uppercase tracking-wider">
                        Model
                    </Label>
                    <select
                        id="requirementsIntelligenceModel"
                        name="requirementsIntelligenceModel"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        defaultValue={String(initialData?.requirementsIntelligence?.model || fallbackModel)}
                    >
                        {modelOptions.map((model) => (
                            <option key={model.value} value={model.value}>
                                {model.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="grid gap-2">
                <Label htmlFor="requirementsAllowedPropertyDomains" className="text-xs text-slate-500 uppercase tracking-wider">
                    Allowed property page domains
                </Label>
                <textarea
                    id="requirementsAllowedPropertyDomains"
                    name="requirementsAllowedPropertyDomains"
                    className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={"downtowncyprus.com\nexample-agency.com"}
                    defaultValue={(initialData?.requirementsIntelligence?.allowedPropertyDomains || []).join("\n")}
                />
                <p className="text-[10px] text-muted-foreground">
                    One domain per line. Requirement Intelligence may crawl one public listing page from these domains to extract property evidence. Internal/private URLs are still blocked.
                </p>
            </div>
            <div className="text-[10px] text-muted-foreground">
                Pending proposals: {pendingRequirementProposals}
            </div>
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-xs font-medium text-slate-700">Requirements Scan Status</div>
                        <div className="text-[10px] text-muted-foreground">
                            Last run: {formatDateLabel(requirementsLastRun?.finishedAt)}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={runningRequirementsScan}
                        onClick={onRunRequirementsScan}
                    >
                        {runningRequirementsScan ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                        Run Requirements Scan Now
                    </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Checked</p>
                        <p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.contactsChecked || 0)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">No New Activity</p>
                        <p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.contactsWithoutNewActivity || 0)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Pending Skip</p>
                        <p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.skippedPending || 0)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Created</p>
                        <p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.proposalsCreated || 0)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Failures</p>
                        <p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.failures || 0)}</p>
                    </div>
                </div>
                {requirementsLastRun?.error && (
                    <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
                        {String(requirementsLastRun.error)}
                    </div>
                )}
            </div>
        </div>
    );
}

function AudioTranscriptPolicySection({ initialData }: { initialData: AiSettingsInitialData }) {
    return (
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
    );
}

function ViewingSessionPolicySection({ initialData }: { initialData: AiSettingsInitialData }) {
    return (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="space-y-0.5">
                <Label className="text-xs text-slate-500 uppercase tracking-wider">
                    Viewing Sessions: Policy
                </Label>
                <p className="text-[10px] text-muted-foreground">
                    Applies to live viewing-session transcripts and client join requirements.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionRetentionDays" className="text-xs text-slate-500 uppercase tracking-wider">
                        Viewing Transcript Retention
                    </Label>
                    <select
                        id="viewingSessionRetentionDays"
                        name="viewingSessionRetentionDays"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        defaultValue={String(initialData?.viewingSessionRetentionDays || 90)}
                    >
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="365">365 days</option>
                    </select>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionTranscriptVisibility" className="text-xs text-slate-500 uppercase tracking-wider">
                        Viewing Transcript Visibility
                    </Label>
                    <select
                        id="viewingSessionTranscriptVisibility"
                        name="viewingSessionTranscriptVisibility"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        defaultValue={String(initialData?.viewingSessionTranscriptVisibility || "team")}
                    >
                        <option value="team">Team members</option>
                        <option value="admin_only">Admins only</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2">
                    <input
                        id="viewingSessionAiDisclosureRequired"
                        name="viewingSessionAiDisclosureRequired"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.viewingSessionAiDisclosureRequired !== false}
                    />
                    <span className="space-y-0.5">
                        <span className="block text-xs font-medium text-slate-700">Require AI disclosure acceptance</span>
                        <span className="block text-[10px] text-muted-foreground">
                            Clients must acknowledge AI assistance before joining.
                        </span>
                    </span>
                </label>

                <label className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2">
                    <input
                        id="viewingSessionRawAudioStorageEnabled"
                        name="viewingSessionRawAudioStorageEnabled"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.viewingSessionRawAudioStorageEnabled === true}
                    />
                    <span className="space-y-0.5">
                        <span className="block text-xs font-medium text-slate-700">Allow raw audio storage</span>
                        <span className="block text-[10px] text-muted-foreground">
                            Keep disabled for v1 unless your retention policy explicitly requires raw audio.
                        </span>
                    </span>
                </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionAiDisclosureVersion" className="text-xs text-slate-500 uppercase tracking-wider">
                        Disclosure Version
                    </Label>
                    <Input
                        id="viewingSessionAiDisclosureVersion"
                        name="viewingSessionAiDisclosureVersion"
                        placeholder="v1"
                        defaultValue={String(initialData?.viewingSessionAiDisclosureVersion || "v1")}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionTranslationModel" className="text-xs text-slate-500 uppercase tracking-wider">
                        Translation Model Override
                    </Label>
                    <Input
                        id="viewingSessionTranslationModel"
                        name="viewingSessionTranslationModel"
                        placeholder="gemini-2.5-flash"
                        defaultValue={String(initialData?.viewingSessionTranslationModel || "")}
                    />
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionInsightsModel" className="text-xs text-slate-500 uppercase tracking-wider">
                        Insights Model Override
                    </Label>
                    <Input
                        id="viewingSessionInsightsModel"
                        name="viewingSessionInsightsModel"
                        placeholder="gemini-2.5-flash"
                        defaultValue={String(initialData?.viewingSessionInsightsModel || "")}
                    />
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionSummaryModel" className="text-xs text-slate-500 uppercase tracking-wider">
                        Summary Model Override
                    </Label>
                    <Input
                        id="viewingSessionSummaryModel"
                        name="viewingSessionSummaryModel"
                        placeholder="gemini-2.5-flash"
                        defaultValue={String(initialData?.viewingSessionSummaryModel || "")}
                    />
                </div>
            </div>
        </div>
    );
}

function ModelConfigurationSection({
    initialData,
    modelOptions,
    googleAiModel,
    googleAiModelExtraction,
    googleAiModelDesign,
    googleAiModelTranscription,
    googleAiModelTranslation,
    pendingRequirementProposals,
    requirementsLastRun,
    runningRequirementsScan,
    onGeneralModelChange,
    onExtractionModelChange,
    onDesignModelChange,
    onTranscriptionModelChange,
    onTranslationModelChange,
    onRunRequirementsScan,
}: {
    initialData: AiSettingsInitialData;
    modelOptions: AiModelOption[];
    googleAiModel: string;
    googleAiModelExtraction: string;
    googleAiModelDesign: string;
    googleAiModelTranscription: string;
    googleAiModelTranslation: string;
    pendingRequirementProposals: number;
    requirementsLastRun: RequirementsLastRun | null;
    runningRequirementsScan: boolean;
    onGeneralModelChange: (value: string) => void;
    onExtractionModelChange: (value: string) => void;
    onDesignModelChange: (value: string) => void;
    onTranscriptionModelChange: (value: string) => void;
    onTranslationModelChange: (value: string) => void;
    onRunRequirementsScan: () => void;
}) {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-medium">Model Configuration</h3>
            <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
                <ModelSelectionSection
                    initialData={initialData}
                    modelOptions={modelOptions}
                    googleAiModel={googleAiModel}
                    googleAiModelExtraction={googleAiModelExtraction}
                    googleAiModelDesign={googleAiModelDesign}
                    googleAiModelTranscription={googleAiModelTranscription}
                    googleAiModelTranslation={googleAiModelTranslation}
                    onGeneralModelChange={onGeneralModelChange}
                    onExtractionModelChange={onExtractionModelChange}
                    onDesignModelChange={onDesignModelChange}
                    onTranscriptionModelChange={onTranscriptionModelChange}
                    onTranslationModelChange={onTranslationModelChange}
                />

                <RequirementsIntelligenceSection
                    initialData={initialData}
                    modelOptions={modelOptions}
                    fallbackModel={googleAiModelExtraction}
                    pendingRequirementProposals={pendingRequirementProposals}
                    requirementsLastRun={requirementsLastRun}
                    runningRequirementsScan={runningRequirementsScan}
                    onRunRequirementsScan={onRunRequirementsScan}
                />

                <AudioTranscriptPolicySection initialData={initialData} />

                <ViewingSessionPolicySection initialData={initialData} />
            </div>
        </div>
    );
}

function PropertyImageEditingSection({
    initialData,
    precisionRemoveInfrastructureReady,
}: {
    initialData: AiSettingsInitialData;
    precisionRemoveInfrastructureReady: boolean;
}) {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-medium">Property Image Editing</h3>
            <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
                    <input
                        id="precisionRemoveEnabled"
                        name="precisionRemoveEnabled"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.precisionRemoveEnabled === true}
                    />
                    <span className="space-y-1">
                        <span className="block text-sm font-medium text-slate-900">Enable Precision Remove</span>
                        <span className="block text-xs text-muted-foreground">
                            Allows admins for this location to use manual mask-based object removal inside the property media editor.
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                            Infrastructure status: {precisionRemoveInfrastructureReady
                                ? "Google Cloud image editing is configured on this server."
                                : "Google Cloud image editing is not fully configured on this server yet."}
                        </span>
                    </span>
                </label>
            </div>
        </div>
    );
}

function OutreachAssistantSection({ initialData }: { initialData: AiSettingsInitialData }) {
    return (
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
    );
}

function BrandVoiceResearchSection({
    initialData,
    locationId,
    researchUrl,
    isGeneratingVoice,
    onResearchUrlChange,
    onGeneratingVoiceChange,
}: {
    initialData: AiSettingsInitialData;
    locationId: string;
    researchUrl: string;
    isGeneratingVoice: boolean;
    onResearchUrlChange: (value: string) => void;
    onGeneratingVoiceChange: (value: boolean) => void;
}) {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-medium">Brand Voice & Research</h3>

            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="researchUrl">Existing Website URL (for AI Research)</Label>
                    <Input
                        id="researchUrl"
                        value={researchUrl}
                        onChange={(e) => onResearchUrlChange(e.target.value)}
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

                                onGeneratingVoiceChange(true);
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
                                    onGeneratingVoiceChange(false);
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
    );
}

function ApiKeysSection({ hasGoogleAiApiKey }: { hasGoogleAiApiKey: boolean }) {
    return (
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
    );
}

function AiConfigurationHeader() {
    return (
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
    );
}

export function AiSettingsForm({
    initialData,
    locationId,
    settingsVersion,
    hasGoogleAiApiKey,
    precisionRemoveInfrastructureReady,
    runtimeSummary,
}: {
    initialData: AiSettingsInitialData;
    locationId: string;
    settingsVersion: number;
    hasGoogleAiApiKey: boolean;
    precisionRemoveInfrastructureReady: boolean;
    runtimeSummary?: AiRuntimeSummary | null;
}) {
    const [state, action] = useActionState(updateAiSettings, initialState);

    // Local state for research URL since it's not persisted in DB directly here
    // but used for the "Generate Brand Voice" action
    const [researchUrl, setResearchUrl] = useState("");
    const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

    const [availableModels, setAvailableModels] = useState<AiModelOption[]>([]);
    const [runningRequirementsScan, setRunningRequirementsScan] = useState(false);
    const [requirementsLastRun, setRequirementsLastRun] = useState<RequirementsLastRun | null>(
        runtimeSummary?.requirementsIntelligence?.lastRun || initialData?.requirementsIntelligence?.lastRun || null
    );
    const [googleAiModel, setGoogleAiModel] = useState(
        getInitialModelValue(initialData, ["googleAiModel"], GEMINI_FLASH_LATEST_ALIAS)
    );
    const [googleAiModelExtraction, setGoogleAiModelExtraction] = useState(
        getInitialModelValue(initialData, ["googleAiModelExtraction", "googleAiModel"], GEMINI_FLASH_LATEST_ALIAS)
    );
    const [googleAiModelDesign, setGoogleAiModelDesign] = useState(
        getInitialModelValue(initialData, ["googleAiModelDesign", "googleAiModel"], GEMINI_FLASH_LATEST_ALIAS)
    );
    const [googleAiModelTranscription, setGoogleAiModelTranscription] = useState(
        getInitialModelValue(initialData, ["googleAiModelTranscription", "googleAiModelExtraction"], GEMINI_FLASH_STABLE_FALLBACK)
    );
    const [googleAiModelTranslation, setGoogleAiModelTranslation] = useState(
        getInitialModelValue(initialData, ["googleAiModelTranslation"], GEMINI_FLASH_LATEST_ALIAS)
    );
    const hasUserSelectedGeneralModelRef = useRef(false);
    const hasUserSelectedExtractionModelRef = useRef(false);
    const hasUserSelectedDesignModelRef = useRef(false);
    const hasUserSelectedTranscriptionModelRef = useRef(false);
    const hasUserSelectedTranslationModelRef = useRef(false);

    const hasConfiguredGeneralModel = hasInitialModelValue(initialData, "googleAiModel");
    const hasConfiguredExtractionModel = hasInitialModelValue(initialData, "googleAiModelExtraction");
    const hasConfiguredDesignModel = hasInitialModelValue(initialData, "googleAiModelDesign");
    const hasConfiguredTranscriptionModel = hasInitialModelValue(initialData, "googleAiModelTranscription");
    const hasConfiguredTranslationModel = hasInitialModelValue(initialData, "googleAiModelTranslation");
    const modelOptions = availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS;

    useEffect(() => {
        let mounted = true;
        // Dynamically import action if needed or just use import
        import("@/app/(main)/admin/conversations/actions").then(mod => {
            mod.getAiModelPickerDefaultsAction().then(({ models, defaults }: { models: AiModelOption[]; defaults?: AiModelPickerDefaults }) => {
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
                    if (!hasUserSelectedTranslationModelRef.current && !hasConfiguredTranslationModel) {
                        setGoogleAiModelTranslation(defaults?.translation || GEMINI_FLASH_LATEST_ALIAS);
                    }
                }
            });
        });
        return () => { mounted = false; };
    }, [hasConfiguredDesignModel, hasConfiguredExtractionModel, hasConfiguredGeneralModel, hasConfiguredTranscriptionModel, hasConfiguredTranslationModel]);

    const runRequirementsScan = async () => {
        setRunningRequirementsScan(true);
        try {
            const result = await runRequirementsIntelligenceNowAction(locationId, { batchSize: 40 });
            if (!result?.success) {
                toast.error(String(result?.error || "Requirements scan failed."));
                return;
            }
            const stats = result.stats || {};
            setRequirementsLastRun({
                status: Number(stats.failures || 0) > 0 ? "failed" : "completed",
                source: "manual",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 0,
                mode: String(initialData?.requirementsIntelligence?.mode || "manual_only"),
                batchSize: 40,
                stats,
                error: Number(stats.failures || 0) > 0 ? `${Number(stats.failures)} contact(s) failed.` : null,
            });
            toast.success(
                `Requirements scan complete. Checked ${Number(stats.contactsChecked || 0)}, created ${Number(stats.proposalsCreated || 0)} proposal${Number(stats.proposalsCreated || 0) === 1 ? "" : "s"}.`
            );
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Requirements scan failed.");
        } finally {
            setRunningRequirementsScan(false);
        }
    };

    return (
        <div className="space-y-8">
            <AiConfigurationHeader />

            <form action={action} className="space-y-8">
                <input type="hidden" name="locationId" value={locationId} />
                <input type="hidden" name="settingsVersion" value={String(settingsVersion)} />

                <ApiKeysSection hasGoogleAiApiKey={hasGoogleAiApiKey} />

                <Separator />

                <ModelConfigurationSection
                    initialData={initialData}
                    modelOptions={modelOptions}
                    googleAiModel={googleAiModel}
                    googleAiModelExtraction={googleAiModelExtraction}
                    googleAiModelDesign={googleAiModelDesign}
                    googleAiModelTranscription={googleAiModelTranscription}
                    googleAiModelTranslation={googleAiModelTranslation}
                    pendingRequirementProposals={Number(runtimeSummary?.pendingRequirementProposals || 0)}
                    requirementsLastRun={requirementsLastRun}
                    runningRequirementsScan={runningRequirementsScan}
                    onGeneralModelChange={(value) => {
                        hasUserSelectedGeneralModelRef.current = true;
                        setGoogleAiModel(value);
                    }}
                    onExtractionModelChange={(value) => {
                        hasUserSelectedExtractionModelRef.current = true;
                        setGoogleAiModelExtraction(value);
                    }}
                    onDesignModelChange={(value) => {
                        hasUserSelectedDesignModelRef.current = true;
                        setGoogleAiModelDesign(value);
                    }}
                    onTranscriptionModelChange={(value) => {
                        hasUserSelectedTranscriptionModelRef.current = true;
                        setGoogleAiModelTranscription(value);
                    }}
                    onTranslationModelChange={(value) => {
                        hasUserSelectedTranslationModelRef.current = true;
                        setGoogleAiModelTranslation(value);
                    }}
                    onRunRequirementsScan={runRequirementsScan}
                />

                <Separator />

                <PropertyImageEditingSection
                    initialData={initialData}
                    precisionRemoveInfrastructureReady={precisionRemoveInfrastructureReady}
                />

                <Separator />

                <SkillRuntimeSettings
                    locationId={locationId}
                    summary={runtimeSummary || null}
                />

                <Separator />

                <OutreachAssistantSection initialData={initialData} />

                <Separator />

                <BrandVoiceResearchSection
                    initialData={initialData}
                    locationId={locationId}
                    researchUrl={researchUrl}
                    isGeneratingVoice={isGeneratingVoice}
                    onResearchUrlChange={setResearchUrl}
                    onGeneratingVoiceChange={setIsGeneratingVoice}
                />

                <AiSettingsFormFooter state={state} />
            </form>
        </div>
    );
}
