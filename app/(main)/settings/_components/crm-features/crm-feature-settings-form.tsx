"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pause, Play, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DEFAULT_REPLY_LANGUAGE, REPLY_LANGUAGE_OPTIONS } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { filterModelsForTask, type AiTaskId } from "@/lib/ai/model-capabilities";
import { runRequirementsIntelligenceNowAction, updateCrmFeatureSettings } from "./actions";
import type { CrmFeatureSettingsSection, CrmFeatureSettingsState } from "./fields";

type RequirementsLastRunStats = {
    contactsChecked?: number;
    contactsWithoutNewActivity?: number;
    skippedPending?: number;
    skippedUnverified?: number;
    skippedDebounce?: number;
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
    activityDebounceMinutes?: number;
    autoReprocessCampaignCandidates?: boolean;
    lastRun?: RequirementsLastRun | null;
};

type ContactProfileVerificationLastRunStats = {
    checked?: number;
    verified?: number;
    proposals?: number;
    skipped?: number;
    failures?: number;
    reprocessedCampaignBlocks?: number;
};

type ContactProfileVerificationLastRun = {
    status?: string;
    source?: string;
    startedAt?: string;
    finishedAt?: string | null;
    durationMs?: number;
    mode?: string;
    batchSize?: number;
    stats?: ContactProfileVerificationLastRunStats;
    currentContactId?: string | null;
    error?: string | null;
};

type ContactProfileVerificationSettings = {
    mode?: string;
    model?: string;
    newContactDelayHours?: number;
    recertificationDays?: number;
    recertifyOnNewActivity?: boolean;
    batchSize?: number;
    autoReprocessCampaignBlocks?: boolean;
    lastRun?: ContactProfileVerificationLastRun | null;
};

type ContactClassificationQueueStatus = {
    eligible?: number;
    queued?: number;
    pendingReview?: number;
    failed?: number;
    latestQueuedAt?: string | null;
};

type ContactClassificationRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "canceled";

type ContactClassificationRun = {
    id: string;
    locationId: string;
    status: ContactClassificationRunStatus;
    source: string;
    model: string;
    totalQueued: number;
    checked: number;
    verified: number;
    proposals: number;
    skipped: number;
    failures: number;
    reprocessedCampaignBlocks: number;
    remaining: number;
    progressPercent: number;
    startedAt: string | null;
    finishedAt: string | null;
    lastHeartbeatAt: string | null;
    lastError: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

type ContactClassificationProgress = {
    queuedCount: number;
    eligibleCount: number;
    checkedCount: number;
    qualifiedLeads: number;
    failedCount: number;
    progressPercent: number;
    statusLabel: string;
};

export type AiSettingsInitialData = {
    defaultReplyLanguage?: string;
    googleAiModel?: string;
    googleAiModelExtraction?: string;
    googleAiModelDesign?: string;
    googleAiModelTranscription?: string;
    whatsappTranscriptOnDemandEnabled?: boolean;
    whatsappTranscriptRetentionDays?: number | string;
    whatsappTranscriptVisibility?: string;
    viewingSessionRetentionDays?: number | string;
    viewingSessionTranscriptVisibility?: string;
    viewingSessionAiDisclosureRequired?: boolean;
    viewingSessionRawAudioStorageEnabled?: boolean;
    viewingSessionAiDisclosureVersion?: string;
    viewingSessionTranslationModel?: string | null;
    viewingSessionInsightsModel?: string | null;
    viewingSessionSummaryModel?: string | null;
    precisionRemoveEnabled?: boolean;
    outreachConfig?: {
        enabled?: boolean;
        visionIdPrompt?: string;
        icebreakerPrompt?: string;
        qualifierPrompt?: string;
    };
    requirementsIntelligence?: RequirementsIntelligenceSettings;
    contactProfileVerification?: ContactProfileVerificationSettings;
};

type AiRuntimeSummary = {
    totalPolicies: number;
    enabledPolicies: number;
    nextRunAt: string | null;
    pendingJobs: number;
    deadJobs: number;
    pendingSuggestions: number;
    pendingRequirementProposals?: number;
    pendingVerificationProposals?: number;
    contactClassificationQueue?: ContactClassificationQueueStatus | null;
    contactClassificationRun?: ContactClassificationRun | null;
    requirementsIntelligence?: RequirementsIntelligenceSettings;
    contactProfileVerification?: ContactProfileVerificationSettings;
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

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save Changes"}
        </Button>
    );
}

function FormFooter({ state }: { state: CrmFeatureSettingsState }) {
    return <div className="space-y-3">
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        {state.version !== undefined && !state.error && <p role="status" className="text-sm text-muted-foreground">Changes saved.</p>}
        <div className="flex justify-end"><SubmitButton /></div>
    </div>;
}

type AiModelOption = {
    value: string;
    label: string;
    description?: string;
};

function getAiModelProviderLabel(modelId: string): string {
    const normalized = modelId.toLowerCase();
    if (normalized.startsWith("chatgpt_subscription:")) return "ChatGPT Subscription";
    if (normalized.startsWith("openai:")) return "OpenAI API";
    if (normalized.includes("gemini")) return "Google Gemini";
    return "Other Providers";
}

function AiModelSelect({
    id,
    name,
    label,
    value,
    models,
    description,
    compactLabel = false,
    taskId,
    onChange,
}: {
    id: string;
    name: string;
    label: string;
    value: string;
    models: AiModelOption[];
    description?: string;
    compactLabel?: boolean;
    taskId?: AiTaskId;
    onChange: (value: string) => void;
}) {
    const compatibleModels = taskId ? filterModelsForTask(models, taskId) : models;
    const selectableModels = compatibleModels.length > 0 ? compatibleModels : models;
    const options = selectableModels.some((model) => model.value === value)
        ? selectableModels
        : [{ value, label: value }, ...selectableModels];
    const groupedModels = options.reduce<Record<string, AiModelOption[]>>((groups, model) => {
        const provider = getAiModelProviderLabel(model.value);
        groups[provider] = groups[provider] || [];
        groups[provider].push(model);
        return groups;
    }, {});

    return (
        <div className="grid gap-2">
            <Label
                htmlFor={id}
                className={compactLabel ? "text-xs text-muted-foreground uppercase tracking-wider" : undefined}
            >
                {label}
            </Label>
            <select
                id={id}
                name={name}
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                {Object.entries(groupedModels).map(([provider, providerModels]) => (
                    <optgroup key={provider} label={provider}>
                        {providerModels.map((model) => (
                            <option key={model.value} value={model.value}>
                                {model.label}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
            {description ? <p className="text-[10px] text-muted-foreground">{description}</p> : null}
        </div>
    );
}

function deriveContactClassificationProgress(args: {
    queue: ContactClassificationQueueStatus | null | undefined;
    run: ContactClassificationRun | null | undefined;
}): ContactClassificationProgress {
    const activeRun = args.run && ["queued", "running", "paused"].includes(args.run.status) ? args.run : null;
    const queuedCount = activeRun ? Number(activeRun.remaining || 0) : Number(args.queue?.queued || 0);
    const eligibleCount = Number(args.queue?.eligible || 0);
    const checkedCount = activeRun ? Number(activeRun.checked || 0) : Number(args.run?.checked || 0);
    const qualifiedLeads = activeRun ? Number(activeRun.verified || 0) : Number(args.run?.verified || 0);
    const failedCount = Number(args.queue?.failed || 0);
    const progressPercent = activeRun
        ? Number(activeRun.progressPercent || 0)
        : eligibleCount > 0
            ? Math.max(0, Math.min(100, Math.round(((eligibleCount - queuedCount) / eligibleCount) * 100)))
            : 100;
    const statusLabel = activeRun?.status === "running" || activeRun?.status === "queued"
        ? "Checking contacts"
        : activeRun?.status === "paused"
            ? "Paused"
            : args.run?.status === "failed"
                ? "Needs attention"
                : queuedCount > 0
            ? "Ready to check"
            : failedCount > 0
                ? "Needs attention"
                : "Up to date";

    return {
        queuedCount,
        eligibleCount,
        checkedCount,
        qualifiedLeads,
        failedCount,
        progressPercent,
        statusLabel,
    };
}

async function readJsonResponse<T>(response: Response, fallbackError: string): Promise<T> {
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
        throw new Error(String(result?.error || `${fallbackError} (${response.status}).`));
    }

    return result as T;
}

function ConversationReplyLanguage({ initialData }: { initialData: AiSettingsInitialData }) {
    return (
        <div className="grid gap-2">
                <Label htmlFor="defaultReplyLanguage">Default Reply Language</Label>
                <select
                    id="defaultReplyLanguage"
                    name="defaultReplyLanguage"
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
    );
}

function OnDemandTranscripts({ initialData }: { initialData: AiSettingsInitialData }) {
    return (
        <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                <div className="space-y-0.5">
                    <Label htmlFor="whatsappTranscriptOnDemandEnabled" className="text-xs text-muted-foreground uppercase tracking-wider">
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
    );
}

function LeadIntelligenceSection({
    initialData,
    modelOptions,
    fallbackModel,
    contactProfileVerificationModel,
    pendingRequirementProposals,
    pendingVerificationProposals,
    contactClassificationQueue,
    contactClassificationRun,
    contactClassificationQueueUpdatedAt,
    requirementsLastRun,
    contactProfileVerificationLastRun,
    runningRequirementsScan,
    runningVerifyContactsNow,
    onContactProfileVerificationModelChange,
    onRunRequirementsScan,
    onVerifyContactsNow,
    onPauseContactClassification,
    onResumeContactClassification,
    onCancelContactClassification,
}: {
    initialData: AiSettingsInitialData;
    modelOptions: AiModelOption[];
    fallbackModel: string;
    contactProfileVerificationModel: string;
    pendingRequirementProposals: number;
    pendingVerificationProposals: number;
    contactClassificationQueue: ContactClassificationQueueStatus | null;
    contactClassificationRun: ContactClassificationRun | null;
    contactClassificationQueueUpdatedAt: string | null;
    requirementsLastRun: RequirementsLastRun | null;
    contactProfileVerificationLastRun: ContactProfileVerificationLastRun | null;
    runningRequirementsScan: boolean;
    runningVerifyContactsNow: boolean;
    onContactProfileVerificationModelChange: (value: string) => void;
    onRunRequirementsScan: () => void;
    onVerifyContactsNow: () => void;
    onPauseContactClassification: () => void;
    onResumeContactClassification: () => void;
    onCancelContactClassification: () => void;
}) {
    const requirements = initialData?.requirementsIntelligence || {};
    const verification = initialData?.contactProfileVerification || {};
    const formatDateLabel = (value: string | null | undefined) => {
        if (!value) return "Never";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
    };
    const leadMode = requirements.mode === "off" && verification.mode === "off"
        ? "off"
        : requirements.mode === "manual_only" && verification.mode === "manual_only"
            ? "manual_only"
            : "automatic";
    const reprocessEnabled = requirements.autoReprocessCampaignCandidates !== false
        && verification.autoReprocessCampaignBlocks !== false;
    const runningLeadIntelligence = runningRequirementsScan || runningVerifyContactsNow;
    const activeContactClassificationRun = contactClassificationRun && ["queued", "running"].includes(contactClassificationRun.status)
        ? contactClassificationRun
        : null;
    const pausedContactClassificationRun = contactClassificationRun?.status === "paused" ? contactClassificationRun : null;
    const runningAnyContactClassification = Boolean(activeContactClassificationRun || pausedContactClassificationRun) || runningVerifyContactsNow;
    const requirementWaitHours = Math.max(0, Math.min(24, Math.round(Number(requirements.activityDebounceMinutes ?? 24 * 60) / 60)));
    const classificationProgress = deriveContactClassificationProgress({
        queue: contactClassificationQueue,
        run: contactClassificationRun,
    });
    const activeRunModelChanged = Boolean(
        activeContactClassificationRun
        && contactProfileVerificationModel
        && activeContactClassificationRun.model
        && contactProfileVerificationModel !== activeContactClassificationRun.model
    );
    const contactVerificationModels = filterModelsForTask(modelOptions, "contact.verification");
    const contactVerificationOptions = contactVerificationModels.length > 0 ? contactVerificationModels : modelOptions;
    const verificationOptions = contactVerificationOptions.some((model) => model.value === contactProfileVerificationModel)
        ? contactVerificationOptions
        : [{ value: contactProfileVerificationModel, label: contactProfileVerificationModel }, ...contactVerificationOptions];
    const requirementModels = filterModelsForTask(modelOptions, "contact.requirements");
    const requirementOptions = requirementModels.length > 0 ? requirementModels : modelOptions;
    const requirementModelValue = String(requirements.model || fallbackModel);
    const requirementsOptions = requirementOptions.some((model) => model.value === requirementModelValue)
        ? requirementOptions
        : [{ value: requirementModelValue, label: requirementModelValue }, ...requirementOptions];

    return (
        <div className="space-y-3">
            <div className="space-y-0.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Lead Intelligence
                </Label>
                <p className="text-[10px] text-muted-foreground">
                    AI identifies real buyer/renter leads, keeps their requirements current, and leaves uncertain cases for review.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-card p-3">
                <div className="grid gap-2">
                    <Label htmlFor="leadIntelligenceMode" className="text-xs text-muted-foreground uppercase tracking-wider">
                        Mode
                    </Label>
                    <select
                        id="leadIntelligenceMode"
                        name="leadIntelligenceMode"
                        className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                        defaultValue={leadMode}
                    >
                        <option value="off">Off</option>
                        <option value="manual_only">Manual only</option>
                        <option value="automatic">Automatic</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                        Automatic classifies new contacts and updates requirements after new contact messages.
                    </p>
                </div>
                <details className="rounded-md border border-border bg-muted/40 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-foreground">Advanced model settings</summary>
                    <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="grid gap-2">
                            <Label htmlFor="contactProfileVerificationModel" className="text-xs text-muted-foreground uppercase tracking-wider">
                                Contact Classification model
                            </Label>
                            <select
                                id="contactProfileVerificationModel"
                                name="contactProfileVerificationModel"
                                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                                value={contactProfileVerificationModel}
                                onChange={(event) => onContactProfileVerificationModelChange(event.target.value)}
                            >
                                {verificationOptions.map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="requirementsIntelligenceModel" className="text-xs text-muted-foreground uppercase tracking-wider">
                                Requirements model
                            </Label>
                            <select
                                id="requirementsIntelligenceModel"
                                name="requirementsIntelligenceModel"
                                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                                defaultValue={requirementModelValue}
                            >
                                {requirementsOptions.map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </details>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-xs font-medium text-foreground">Contact Classification</div>
                            <div className="text-[10px] text-muted-foreground">Classifies contacts as buyer/renter leads, owners, agents, not leads, or needs review. Confident decisions are applied automatically.</div>
                            <div className="text-[10px] text-muted-foreground">Last run: {formatDateLabel(contactClassificationRun?.finishedAt || contactProfileVerificationLastRun?.finishedAt)}</div>
                            <div className="mt-1 text-[10px] font-medium text-foreground">{classificationProgress.statusLabel}</div>
                            {activeContactClassificationRun ? (
                                <div className="text-[10px] text-muted-foreground">
                                    Running in the background. You can refresh this page and it will keep working.
                                </div>
                            ) : null}
                            {activeRunModelChanged ? (
                                <div className="text-[10px] text-muted-foreground">
                                    Current run is using {activeContactClassificationRun?.model}. Model changes apply to the next run.
                                </div>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" className="min-h-11 text-xs" disabled={runningAnyContactClassification} onClick={onVerifyContactsNow}>
                                {activeContactClassificationRun || runningVerifyContactsNow ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                                Verify Contacts Now
                            </Button>
                            {activeContactClassificationRun ? (
                                <Button type="button" variant="outline" size="sm" className="min-h-11 text-xs" onClick={onPauseContactClassification}>
                                    <Pause className="mr-1.5 h-3.5 w-3.5" />
                                    Pause
                                </Button>
                            ) : null}
                            {pausedContactClassificationRun ? (
                                <>
                                    <Button type="button" variant="outline" size="sm" className="min-h-11 text-xs" onClick={onResumeContactClassification}>
                                        <Play className="mr-1.5 h-3.5 w-3.5" />
                                        Resume
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" className="min-h-11 text-xs" onClick={onCancelContactClassification}>
                                        <X className="mr-1.5 h-3.5 w-3.5" />
                                        Cancel
                                    </Button>
                                </>
                            ) : activeContactClassificationRun ? (
                                <Button type="button" variant="outline" size="sm" className="min-h-11 text-xs" onClick={onCancelContactClassification}>
                                    <X className="mr-1.5 h-3.5 w-3.5" />
                                    Cancel
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-5">
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">To Check</p><p className="text-sm font-semibold">{classificationProgress.queuedCount}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Eligible</p><p className="text-sm font-semibold">{classificationProgress.eligibleCount}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Checked</p><p className="text-sm font-semibold">{classificationProgress.checkedCount}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Qualified Leads</p><p className="text-sm font-semibold">{classificationProgress.qualifiedLeads}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Needs Review</p><p className="text-sm font-semibold">{pendingVerificationProposals}</p></div>
                    </div>
                    <div className="mt-3">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                                className="h-full rounded-full bg-emerald-500 transition-all"
                                style={{ width: `${classificationProgress.progressPercent}%` }}
                            />
                        </div>
                        <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>{classificationProgress.queuedCount > 0 ? `${classificationProgress.queuedCount} contact${classificationProgress.queuedCount === 1 ? "" : "s"} waiting` : "No contacts waiting"}</span>
                            <span>{classificationProgress.progressPercent}% clear</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                        Verify Contacts Now queues eligible contacts, checks them one by one, applies safe decisions automatically, and leaves only uncertain contacts for review.
                        Failed: {contactClassificationRun?.failures ?? classificationProgress.failedCount}.
                        {contactClassificationQueueUpdatedAt ? ` Last updated: ${formatDateLabel(contactClassificationQueueUpdatedAt)}.` : ""}
                    </div>
                </div>

                <div className="rounded-md border border-border bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-xs font-medium text-foreground">Requirement Updates</div>
                            <div className="text-[10px] text-muted-foreground">Updates approved buyer/renter requirements from new contact messages.</div>
                            <div className="text-[10px] text-muted-foreground">Last run: {formatDateLabel(requirementsLastRun?.finishedAt)}</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="min-h-11 text-xs" disabled={runningLeadIntelligence} onClick={onRunRequirementsScan}>
                            {runningLeadIntelligence ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                            Run Requirement Updates
                        </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Checked</p><p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.contactsChecked || 0)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Created</p><p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.proposalsCreated || 0)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Unqualified</p><p className="text-sm font-semibold">{Number(requirementsLastRun?.stats?.skippedUnverified || 0)}</p></div>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">Pending requirement proposals: {pendingRequirementProposals}</div>
                </div>
            </div>

            <details className="rounded-md border border-border bg-muted/40 p-3">
                <summary className="cursor-pointer text-xs font-medium text-foreground">Advanced controls</summary>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                        <Label htmlFor="requirementsActivityWaitHours" className="text-xs text-muted-foreground uppercase tracking-wider">
                            Wait after new contact messages before updating requirements
                        </Label>
                        <Input
                            id="requirementsActivityWaitHours"
                            name="requirementsActivityWaitHours"
                            type="number"
                            min={0}
                            max={24}
                            defaultValue={String(requirementWaitHours)}
                        />
                        <p className="text-[10px] text-muted-foreground">
                            Hours to wait after the latest contact-sent message. Default is once per day.
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="leadIntelligenceBatchSize" className="text-xs text-muted-foreground uppercase tracking-wider">
                            Contacts to process per run
                        </Label>
                        <Input
                            id="leadIntelligenceBatchSize"
                            name="leadIntelligenceBatchSize"
                            type="number"
                            min={1}
                            max={500}
                            defaultValue={String(verification.batchSize ?? 50)}
                        />
                        <p className="text-[10px] text-muted-foreground">
                            Higher values finish large backlogs faster but each run takes longer.
                        </p>
                    </div>
                    <label className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 md:col-span-2">
                        <input
                            id="leadIntelligenceAutoReprocessCampaignCandidates"
                            name="leadIntelligenceAutoReprocessCampaignCandidates"
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                            defaultChecked={reprocessEnabled}
                        />
                        <span className="space-y-0.5">
                            <span className="block text-xs font-medium text-foreground">Update active campaign matches after lead details change</span>
                            <span className="block text-[10px] text-muted-foreground">Only active blocked or pending candidates are rechecked. Sent, skipped, rejected, and approved candidates stay unchanged.</span>
                        </span>
                    </label>
                    <div className="grid gap-2 md:col-span-2">
                        <Label htmlFor="requirementsAllowedPropertyDomains" className="text-xs text-muted-foreground uppercase tracking-wider">
                            Allowed property page domains
                        </Label>
                        <textarea
                            id="requirementsAllowedPropertyDomains"
                            name="requirementsAllowedPropertyDomains"
                            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            placeholder={"downtowncyprus.com\nexample-agency.com"}
                            defaultValue={(requirements.allowedPropertyDomains || []).join("\n")}
                        />
                    </div>
                </div>
            </details>
        </div>
    );
}

function AudioTranscriptPolicySection({ initialData }: { initialData: AiSettingsInitialData }) {
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="grid gap-2 rounded-md border border-border bg-card p-3">
                <Label htmlFor="whatsappTranscriptRetentionDays" className="text-xs text-muted-foreground uppercase tracking-wider">
                    Audio: Retention Policy
                </Label>
                <select
                    id="whatsappTranscriptRetentionDays"
                    name="whatsappTranscriptRetentionDays"
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
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

            <div className="grid gap-2 rounded-md border border-border bg-card p-3">
                <Label htmlFor="whatsappTranscriptVisibility" className="text-xs text-muted-foreground uppercase tracking-wider">
                    Audio: Visibility Policy
                </Label>
                <select
                    id="whatsappTranscriptVisibility"
                    name="whatsappTranscriptVisibility"
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
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

function OptionalModelSelect({
    id,
    name,
    label,
    value,
    models,
    description,
    taskId,
}: {
    id: string;
    name: string;
    label: string;
    value?: string | null;
    models: AiModelOption[];
    description: string;
    taskId?: AiTaskId;
}) {
    const compatibleModels = taskId ? filterModelsForTask(models, taskId) : models;
    const selectableModels = compatibleModels.length > 0 ? compatibleModels : models;
    const selectedValue = String(value || "");
    const options = !selectedValue || selectableModels.some((model) => model.value === selectedValue)
        ? selectableModels
        : [{ value: selectedValue, label: selectedValue }, ...selectableModels];

    return (
        <div className="grid gap-2">
            <Label htmlFor={id} className="text-xs text-muted-foreground uppercase tracking-wider">
                {label}
            </Label>
            <select
                id={id}
                name={name}
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                defaultValue={selectedValue}
            >
                <option value="">Use default model</option>
                {options.map((model) => (
                    <option key={model.value} value={model.value}>
                        {model.label}
                    </option>
                ))}
            </select>
            <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
    );
}

function ViewingSessionPolicySection({
    initialData,
    modelOptions,
}: {
    initialData: AiSettingsInitialData;
    modelOptions: AiModelOption[];
}) {
    return (
        <div className="space-y-3 rounded-md border border-border bg-card p-3">
            <div className="space-y-0.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Live Assist: Policy
                </Label>
                <p className="text-[10px] text-muted-foreground">
                    Applies only to Live Assist transcripts, summaries, insights, and client join requirements.
                    Conversation inbox translation uses the Conversation: Translation model above.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionRetentionDays" className="text-xs text-muted-foreground uppercase tracking-wider">
                        Live Assist Transcript Retention
                    </Label>
                    <select
                        id="viewingSessionRetentionDays"
                        name="viewingSessionRetentionDays"
                        className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                        defaultValue={String(initialData?.viewingSessionRetentionDays || 90)}
                    >
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="365">365 days</option>
                    </select>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionTranscriptVisibility" className="text-xs text-muted-foreground uppercase tracking-wider">
                        Live Assist Transcript Visibility
                    </Label>
                    <select
                        id="viewingSessionTranscriptVisibility"
                        name="viewingSessionTranscriptVisibility"
                        className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                        defaultValue={String(initialData?.viewingSessionTranscriptVisibility || "team")}
                    >
                        <option value="team">Team members</option>
                        <option value="admin_only">Admins only</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                    <input
                        id="viewingSessionAiDisclosureRequired"
                        name="viewingSessionAiDisclosureRequired"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.viewingSessionAiDisclosureRequired !== false}
                    />
                    <span className="space-y-0.5">
                        <span className="block text-xs font-medium text-foreground">Require AI disclosure acceptance</span>
                        <span className="block text-[10px] text-muted-foreground">
                            Clients must acknowledge AI assistance before joining.
                        </span>
                    </span>
                </label>

                <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                    <input
                        id="viewingSessionRawAudioStorageEnabled"
                        name="viewingSessionRawAudioStorageEnabled"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.viewingSessionRawAudioStorageEnabled === true}
                    />
                    <span className="space-y-0.5">
                        <span className="block text-xs font-medium text-foreground">Allow raw audio storage</span>
                        <span className="block text-[10px] text-muted-foreground">
                            Keep disabled for v1 unless your retention policy explicitly requires raw audio.
                        </span>
                    </span>
                </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="viewingSessionAiDisclosureVersion" className="text-xs text-muted-foreground uppercase tracking-wider">
                        Live Assist AI Disclosure Version
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
                <OptionalModelSelect
                    id="viewingSessionTranslationModel"
                    name="viewingSessionTranslationModel"
                    label="Live Assist: Translation"
                    value={initialData?.viewingSessionTranslationModel}
                    models={modelOptions}
                    taskId="viewing.translation"
                    description="Optional override for translating Live Assist transcripts."
                />

                <OptionalModelSelect
                    id="viewingSessionInsightsModel"
                    name="viewingSessionInsightsModel"
                    label="Live Assist: Insights"
                    value={initialData?.viewingSessionInsightsModel}
                    models={modelOptions}
                    taskId="viewing.insights"
                    description="Optional override for extracting Live Assist insights."
                />

                <OptionalModelSelect
                    id="viewingSessionSummaryModel"
                    name="viewingSessionSummaryModel"
                    label="Live Assist: Summary"
                    value={initialData?.viewingSessionSummaryModel}
                    models={modelOptions}
                    taskId="viewing.summary"
                    description="Optional override for Live Assist summaries."
                />
            </div>
        </div>
    );
}

function PropertyImageEditingSection({
    initialData,
    hasGoogleAiApiKey,
}: {
    initialData: AiSettingsInitialData;
    hasGoogleAiApiKey: boolean;
}) {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-medium">Property Image Editing</h3>
            <div className="space-y-4 border rounded-lg p-4 bg-muted/40">
                <label className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3">
                    <input
                        id="precisionRemoveEnabled"
                        name="precisionRemoveEnabled"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.precisionRemoveEnabled === true}
                    />
                    <span className="space-y-1">
                        <span className="block text-sm font-medium text-foreground">Enable Precision Remove</span>
                        <span className="block text-xs text-muted-foreground">
                            Allows admins for this location to use manual mask-based object removal inside the property media editor.
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                            Provider status: {hasGoogleAiApiKey
                                ? "Gemini image editing is configured for this location."
                                : "Add a Google Gemini AI API key before using image editing."}
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
            <div className="space-y-4 border rounded-lg p-4 bg-muted/40">
                <div className="flex items-center space-x-2">
                    <input
                        type="checkbox"
                        id="outreachEnabled"
                        name="outreachEnabled"
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                        defaultChecked={initialData?.outreachConfig?.enabled ?? false}
                    />
                    <Label htmlFor="outreachEnabled" className="font-medium">Enable Outreach Assistant</Label>
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

function LeadIntelligenceControls({ locationId, initialData, modelOptions }: Pick<FeatureFormProps, "locationId" | "initialData" | "modelOptions">) {
    const [runningRequirementsScan, setRunningRequirementsScan] = useState(false);
    const [runningVerifyContactsNow, setRunningVerifyContactsNow] = useState(false);
    const [runtimeSummaryState, setRuntimeSummaryState] = useState<AiRuntimeSummary | null>(null);
    const [requirementsLastRun, setRequirementsLastRun] = useState<RequirementsLastRun | null>(
        initialData?.requirementsIntelligence?.lastRun || null
    );
    const [contactProfileVerificationLastRun, setContactProfileVerificationLastRun] = useState<ContactProfileVerificationLastRun | null>(
        initialData?.contactProfileVerification?.lastRun || null
    );
    const [contactClassificationQueue, setContactClassificationQueue] = useState<ContactClassificationQueueStatus | null>(
        null
    );
    const [contactClassificationRun, setContactClassificationRun] = useState<ContactClassificationRun | null>(
        null
    );
    const [contactClassificationQueueUpdatedAt, setContactClassificationQueueUpdatedAt] = useState<string | null>(
        null
    );
    const [contactProfileVerificationModel, setContactProfileVerificationModel] = useState(
        String(initialData?.contactProfileVerification?.model || initialData?.googleAiModelExtraction || initialData?.googleAiModel || GEMINI_FLASH_LATEST_ALIAS)
    );
    function updateContactClassificationQueue(status: ContactClassificationQueueStatus | null | undefined) {
        setContactClassificationQueue(status || null);
        setContactClassificationQueueUpdatedAt(new Date().toISOString());
        if (status) {
            setRuntimeSummaryState((current) => current
                ? { ...current, pendingVerificationProposals: Number(status.pendingReview || 0) }
                : current);
        }
    }

    function updateContactClassificationRun(run: ContactClassificationRun | null | undefined) {
        setContactClassificationRun(run || null);
        if (run) {
            setContactProfileVerificationLastRun({
                status: run.status,
                source: run.source,
                startedAt: run.startedAt || undefined,
                finishedAt: run.finishedAt,
                durationMs: run.startedAt
                    ? Math.max(0, (new Date(run.finishedAt || run.updatedAt || new Date()).getTime() - new Date(run.startedAt).getTime()))
                    : 0,
                mode: String(initialData?.contactProfileVerification?.mode || "manual_only"),
                batchSize: Number(initialData?.contactProfileVerification?.batchSize || 50),
                stats: {
                    checked: run.checked,
                    verified: run.verified,
                    proposals: run.proposals,
                    skipped: run.skipped,
                    failures: run.failures,
                    reprocessedCampaignBlocks: run.reprocessedCampaignBlocks,
                },
                error: run.lastError,
            });
        }
    }

    async function refreshContactClassificationQueue() {
        const params = new URLSearchParams({ locationId });
        const response = await fetch(`/api/admin/contacts/classification/queue-all?${params.toString()}`);
        const result = await readJsonResponse<{ success: true; status?: ContactClassificationQueueStatus | null }>(
            response,
            "Could not load contact classification status",
        );
        updateContactClassificationQueue(result.status);
        return result.status as ContactClassificationQueueStatus | null;
    }

    async function refreshContactClassificationRun() {
        const params = new URLSearchParams({ locationId });
        const response = await fetch(`/api/admin/contacts/classification/jobs?${params.toString()}`);
        const result = await readJsonResponse<{ success: true; run?: ContactClassificationRun | null }>(
            response,
            "Could not load contact classification run",
        );
        updateContactClassificationRun(result.run || null);
        return result.run || null;
    }

    useEffect(() => {
        let cancelled = false;

        async function loadRuntimeSummary() {
            const params = new URLSearchParams({ locationId });
            const response = await fetch(`/api/admin/conversations/runtime-summary?${params.toString()}`);
            const result = await readJsonResponse<{ success: true; summary?: AiRuntimeSummary | null }>(
                response,
                "Could not load AI runtime summary",
            );
            if (cancelled) return;

            const summary = result.summary || null;
            setRuntimeSummaryState(summary);
            if (summary?.contactClassificationQueue) {
                updateContactClassificationQueue(summary.contactClassificationQueue);
            }
            updateContactClassificationRun(summary?.contactClassificationRun || null);
        }

        loadRuntimeSummary().catch(() => null);
        return () => { cancelled = true; };
    }, [locationId]);

    useEffect(() => {
        const activeRun = contactClassificationRun && ["queued", "running", "paused"].includes(contactClassificationRun.status);
        const shouldPoll = Boolean(activeRun)
            || Number(contactClassificationQueue?.queued || 0) > 0
            || runningVerifyContactsNow;
        if (!shouldPoll) return;

        const interval = window.setInterval(() => {
            refreshContactClassificationQueue().catch(() => null);
            refreshContactClassificationRun().catch(() => null);
        }, activeRun ? 3000 : 10000);
        return () => window.clearInterval(interval);
    }, [contactClassificationQueue?.queued, contactClassificationRun?.status, locationId, runningVerifyContactsNow]);

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

    async function startContactClassificationJobRequest() {
        const response = await fetch("/api/admin/contacts/classification/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locationId, model: contactProfileVerificationModel }),
        });
        return readJsonResponse<{
            success: true;
            created?: boolean;
            run?: ContactClassificationRun | null;
        }>(response, "Could not verify contacts");
    }

    async function updateContactClassificationJobRequest(action: "pause" | "resume" | "cancel") {
        const runId = contactClassificationRun?.id;
        if (!runId) throw new Error("No active contact classification run.");
        const response = await fetch(`/api/admin/contacts/classification/jobs/${encodeURIComponent(runId)}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locationId }),
        });
        return readJsonResponse<{
            success: true;
            run?: ContactClassificationRun | null;
        }>(response, `Could not ${action} contact classification`);
    }

    const verifyContactsNow = async () => {
        setRunningVerifyContactsNow(true);
        try {
            const result = await startContactClassificationJobRequest();
            updateContactClassificationRun(result.run || null);
            await refreshContactClassificationQueue().catch(() => null);
            toast.success(result.created ? "Contact classification started." : "Contact classification is already running.");
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Could not verify contacts.");
        } finally {
            setRunningVerifyContactsNow(false);
        }
    };

    const pauseContactClassification = async () => {
        try {
            const result = await updateContactClassificationJobRequest("pause");
            updateContactClassificationRun(result.run || null);
            toast.success("Contact classification paused.");
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Could not pause contact classification.");
        }
    };

    const resumeContactClassification = async () => {
        try {
            const result = await updateContactClassificationJobRequest("resume");
            updateContactClassificationRun(result.run || null);
            toast.success("Contact classification resumed.");
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Could not resume contact classification.");
        }
    };

    const cancelContactClassification = async () => {
        try {
            const result = await updateContactClassificationJobRequest("cancel");
            updateContactClassificationRun(result.run || null);
            await refreshContactClassificationQueue().catch(() => null);
            toast.success("Contact classification canceled.");
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Could not cancel contact classification.");
        }
    };

    return <LeadIntelligenceSection
        initialData={initialData}
        modelOptions={modelOptions}
        fallbackModel={initialData.googleAiModelExtraction || GEMINI_FLASH_LATEST_ALIAS}
        contactProfileVerificationModel={contactProfileVerificationModel}
        pendingRequirementProposals={Number(runtimeSummaryState?.pendingRequirementProposals || 0)}
        pendingVerificationProposals={Number(runtimeSummaryState?.pendingVerificationProposals || 0)}
        contactClassificationQueue={contactClassificationQueue}
        contactClassificationRun={contactClassificationRun}
        contactClassificationQueueUpdatedAt={contactClassificationQueueUpdatedAt}
        requirementsLastRun={requirementsLastRun}
        contactProfileVerificationLastRun={contactProfileVerificationLastRun}
        runningRequirementsScan={runningRequirementsScan}
        runningVerifyContactsNow={runningVerifyContactsNow}
        onContactProfileVerificationModelChange={setContactProfileVerificationModel}
        onRunRequirementsScan={runRequirementsScan}
        onVerifyContactsNow={verifyContactsNow}
        onPauseContactClassification={pauseContactClassification}
        onResumeContactClassification={resumeContactClassification}
        onCancelContactClassification={cancelContactClassification}
    />;
}


type FeatureFormProps = {
    section: CrmFeatureSettingsSection;
    locationId: string;
    initialData: AiSettingsInitialData;
    settingsVersion: number;
    modelOptions: AiModelOption[];
    hasGoogleAiApiKey: boolean;
};

export function CrmFeatureSettingsForm({ section, locationId, initialData, settingsVersion, modelOptions, hasGoogleAiApiKey }: FeatureFormProps) {
    const [state, action] = useActionState(updateCrmFeatureSettings.bind(null, section), {});
    const [transcriptionModel, setTranscriptionModel] = useState(initialData.googleAiModelTranscription || GEMINI_FLASH_STABLE_FALLBACK);
    const [extractionModel, setExtractionModel] = useState(initialData.googleAiModelExtraction || GEMINI_FLASH_LATEST_ALIAS);
    const [designModel, setDesignModel] = useState(initialData.googleAiModelDesign || GEMINI_FLASH_LATEST_ALIAS);

    return <form action={action} className="space-y-6">
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="settingsVersion" value={state.version ?? settingsVersion} />

        {section === "conversations" && <>
            <ConversationReplyLanguage initialData={initialData} />
            <AiModelSelect id="googleAiModelTranscription" name="googleAiModelTranscription" label="WhatsApp transcription model"
                value={transcriptionModel} models={modelOptions} taskId="audio.transcription" onChange={setTranscriptionModel} />
            <OnDemandTranscripts initialData={initialData} />
            <AudioTranscriptPolicySection initialData={initialData} />
        </>}
        {section === "contacts" && <>
            <LeadIntelligenceControls locationId={locationId} initialData={initialData} modelOptions={modelOptions} />
            <OutreachAssistantSection initialData={initialData} />
        </>}
        {section === "live-assist" && <ViewingSessionPolicySection initialData={initialData} modelOptions={modelOptions} />}
        {section === "property-media" && <>
            <PropertyImageEditingSection initialData={initialData} hasGoogleAiApiKey={hasGoogleAiApiKey} />
            <AiModelSelect id="googleAiModelExtraction" name="googleAiModelExtraction" label="Property import model"
                value={extractionModel} models={modelOptions} taskId="property.import.text" onChange={setExtractionModel} />
            <AiModelSelect id="googleAiModelDesign" name="googleAiModelDesign" label="Design and content model"
                value={designModel} models={modelOptions} taskId="property.design" onChange={setDesignModel} />
        </>}

        <FormFooter state={state} />
    </form>;
}
