"use client";

import { useMemo, useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    BUILTIN_AUTOMATION_TEMPLATES,
    AiAutomationConfigSchema,
    DEFAULT_AI_AUTOMATION_CONFIG,
    type AiAutomationConfig,
    type AutomationTemplateKey,
} from "@/lib/ai/automation/config";
import { runAiAutomationNowAction, updateAiAutomationConfigFromSettingsAction } from "./actions";

const CADENCE_OPTIONS: Array<{ value: AiAutomationConfig["followUpCadence"]; label: string }> = [
    { value: "daily", label: "Daily" },
    { value: "every_2_days", label: "Every 2 days" },
    { value: "every_3_days", label: "Every 3 days" },
    { value: "weekly", label: "Weekly" },
];

const RESEARCH_OPTIONS: Array<{ value: AiAutomationConfig["researchDepth"]; label: string }> = [
    { value: "minimal", label: "Minimal" },
    { value: "standard", label: "Standard" },
    { value: "deep", label: "Deep" },
];

const STYLE_OPTIONS: Array<{ value: AiAutomationConfig["styleProfile"]; label: string }> = [
    { value: "professional", label: "Professional" },
    { value: "concise", label: "Concise" },
    { value: "friendly", label: "Friendly" },
    { value: "luxury", label: "Luxury" },
];

const TEMPLATE_LABELS: Record<AutomationTemplateKey, string> = {
    post_viewing_follow_up: "Post-viewing follow-up",
    inactive_lead_reengagement: "Inactive lead re-engagement",
    re_engagement: "General re-engagement",
    listing_alert: "Listing alerts",
    custom_follow_up: "Custom follow-up",
};

type AutomationSummary = {
    totalSchedules: number;
    enabledSchedules: number;
    nextRunAt: string | null;
    pendingJobs: number;
    deadJobs: number;
    pendingSuggestions: number;
    schedules?: Array<{
        id: string;
        triggerType: string;
        templateKey: string;
        enabled: boolean;
        cadenceMinutes: number;
        timezone: string;
        nextRunAt: string | null;
        lastPlannedAt: string | null;
        lastRunAt: string | null;
        updatedAt: string;
        policy: any;
    }>;
    recentJobs?: Array<{
        id: string;
        templateKey: string;
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

interface AutomationHubSettingsProps {
    locationId: string;
    initialConfig: unknown;
    summary?: AutomationSummary | null;
}

function normalizeConfig(value: unknown): AiAutomationConfig {
    const parsed = AiAutomationConfigSchema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;
    return DEFAULT_AI_AUTOMATION_CONFIG;
}

function toBoundedInt(value: string, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function formatDateLabel(value: string | null | undefined): string {
    if (!value) return "Not scheduled yet";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Not scheduled yet";
    return d.toLocaleString();
}

function parseIdListInput(value: string): string[] {
    return Array.from(new Set(
        String(value || "")
            .split(/[\n,]/g)
            .map((item) => item.trim())
            .filter(Boolean)
    ));
}

function formatIdList(value: unknown): string {
    if (!Array.isArray(value)) return "";
    return value.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
}

function hasOverrideValues(override: any): boolean {
    if (!override || typeof override !== "object") return false;
    return Boolean(
        override.enabled !== undefined
        || override.maxFollowUps !== undefined
        || override.researchDepth
        || override.styleProfile
        || (typeof override.prompt === "string" && override.prompt.trim())
    );
}

export function AutomationHubSettings({ locationId, initialConfig, summary }: AutomationHubSettingsProps) {
    const [config, setConfig] = useState<AiAutomationConfig>(() => normalizeConfig(initialConfig));
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [latestRun, setLatestRun] = useState<any>(null);

    const enabledTemplateSet = useMemo(() => new Set(config.enabledTemplates || []), [config.enabledTemplates]);

    const setTemplateEnabled = (templateKey: AutomationTemplateKey, checked: boolean) => {
        setConfig((prev) => {
            const current = new Set(prev.enabledTemplates || []);
            if (checked) {
                current.add(templateKey);
            } else {
                if (current.size <= 1 && current.has(templateKey)) {
                    toast.error("At least one template must remain enabled.");
                    return prev;
                }
                current.delete(templateKey);
            }
            return {
                ...prev,
                enabledTemplates: Array.from(current),
            };
        });
    };

    const updateTemplateOverride = (
        templateKey: AutomationTemplateKey,
        patch: Partial<AiAutomationConfig["templateOverrides"][AutomationTemplateKey]>
    ) => {
        setConfig((prev) => {
            const current = { ...(prev.templateOverrides?.[templateKey] || {}) } as any;
            const merged = { ...current, ...patch } as any;

            if (typeof merged.prompt === "string") {
                merged.prompt = merged.prompt.trim();
                if (!merged.prompt) delete merged.prompt;
            }

            if (merged.maxFollowUps === null || merged.maxFollowUps === undefined || merged.maxFollowUps === "") {
                delete merged.maxFollowUps;
            }
            if (!merged.researchDepth) delete merged.researchDepth;
            if (!merged.styleProfile) delete merged.styleProfile;
            if (merged.enabled === null || merged.enabled === undefined) delete merged.enabled;

            const templateOverrides = { ...(prev.templateOverrides || {}) } as any;
            if (hasOverrideValues(merged)) {
                templateOverrides[templateKey] = merged;
            } else {
                delete templateOverrides[templateKey];
            }

            return {
                ...prev,
                templateOverrides,
            };
        });
    };

    const updateSchedulePolicy = (
        templateKey: AutomationTemplateKey,
        patch: Record<string, unknown>
    ) => {
        setConfig((prev) => {
            const current = { ...(prev.schedulePolicies?.[templateKey] || {}) } as Record<string, unknown>;
            const merged: Record<string, unknown> = { ...current, ...patch };

            for (const [key, value] of Object.entries(merged)) {
                if (value === undefined || value === null || value === "") {
                    delete merged[key];
                    continue;
                }
                if (Array.isArray(value) && value.length === 0) {
                    delete merged[key];
                    continue;
                }
            }

            const schedulePolicies = { ...(prev.schedulePolicies || {}) } as Record<string, any>;
            if (Object.keys(merged).length > 0) {
                schedulePolicies[templateKey] = merged;
            } else {
                delete schedulePolicies[templateKey];
            }

            return {
                ...prev,
                schedulePolicies: schedulePolicies as any,
            };
        });
    };

    const saveAutomationConfig = async () => {
        setSaving(true);
        try {
            const parsed = AiAutomationConfigSchema.safeParse(config);
            if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message || "Automation config is invalid.");
                return;
            }

            const result = await updateAiAutomationConfigFromSettingsAction(locationId, parsed.data);

            if (!result?.success) {
                toast.error(String(result?.error || "Failed to save automation settings."));
                return;
            }

            setConfig(parsed.data);
            toast.success("Automation Hub settings saved.");
        } catch (error: any) {
            toast.error(error?.message || "Failed to save automation settings.");
        } finally {
            setSaving(false);
        }
    };

    const runAutomationNow = async () => {
        setRunning(true);
        try {
            const result = await runAiAutomationNowAction(locationId, { batchSize: 60 });
            if (!result?.success) {
                toast.error(String(result?.error || "Failed to run automation cycle."));
                return;
            }
            setLatestRun(result);
            const plannerCount = Number(result?.stats?.planner?.jobsCreated || 0);
            const completed = Number(result?.stats?.worker?.completed || 0);
            toast.success(`Automation run complete. Planned ${plannerCount}, completed ${completed}.`);
        } catch (error: any) {
            toast.error(error?.message || "Failed to run automation cycle.");
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h3 className="text-lg font-medium">Automation Hub</h3>
                <p className="text-sm text-muted-foreground">
                    Configure recurring AI follow-ups that generate suggested responses for human approval.
                </p>
            </div>

            <div className="grid gap-3 rounded-lg border bg-slate-50/50 p-4 md:grid-cols-3">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Enabled Schedules</p>
                    <p className="text-sm font-semibold text-slate-900">
                        {summary?.enabledSchedules ?? 0} / {summary?.totalSchedules ?? 0}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Next Run</p>
                    <p className="text-sm font-semibold text-slate-900">{formatDateLabel(summary?.nextRunAt)}</p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending Queue / Jobs / Dead</p>
                    <p className="text-sm font-semibold text-slate-900">
                        {(summary?.pendingSuggestions ?? 0)} / {(summary?.pendingJobs ?? 0)} / {(summary?.deadJobs ?? 0)}
                    </p>
                </div>
            </div>

            <div className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p className="text-sm font-medium text-slate-900">Central Scheduler and Worker</p>
                        <p className="text-[11px] text-muted-foreground">Cron endpoint: <code>/api/cron/ai-automations</code></p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Installed via <code>scripts/install-cron.sh</code> (10-minute cadence by default).
                    </p>
                </div>

                <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-700">Schedule Runtime</p>
                    {summary?.schedules && summary.schedules.length > 0 ? (
                        <div className="max-h-56 overflow-auto rounded border">
                            <table className="min-w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="px-2 py-1 text-left font-medium">Template</th>
                                        <th className="px-2 py-1 text-left font-medium">Cadence</th>
                                        <th className="px-2 py-1 text-left font-medium">Timezone</th>
                                        <th className="px-2 py-1 text-left font-medium">Next Run</th>
                                        <th className="px-2 py-1 text-left font-medium">Last Run</th>
                                        <th className="px-2 py-1 text-left font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.schedules.map((row) => (
                                        <tr key={row.id} className="border-t">
                                            <td className="px-2 py-1">{TEMPLATE_LABELS[(row.templateKey as AutomationTemplateKey)] || row.templateKey}</td>
                                            <td className="px-2 py-1">{row.cadenceMinutes}m</td>
                                            <td className="px-2 py-1">{row.timezone || "UTC"}</td>
                                            <td className="px-2 py-1">{formatDateLabel(row.nextRunAt)}</td>
                                            <td className="px-2 py-1">{formatDateLabel(row.lastRunAt)}</td>
                                            <td className="px-2 py-1">{row.enabled ? "enabled" : "disabled"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground">No schedule rows yet. Save settings to materialize schedule records.</p>
                    )}
                </div>

                <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-700">Recent Worker Jobs</p>
                    {summary?.recentJobs && summary.recentJobs.length > 0 ? (
                        <div className="max-h-56 overflow-auto rounded border">
                            <table className="min-w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="px-2 py-1 text-left font-medium">Created</th>
                                        <th className="px-2 py-1 text-left font-medium">Template</th>
                                        <th className="px-2 py-1 text-left font-medium">Status</th>
                                        <th className="px-2 py-1 text-left font-medium">Attempts</th>
                                        <th className="px-2 py-1 text-left font-medium">Trace</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.recentJobs.map((row) => (
                                        <tr key={row.id} className="border-t">
                                            <td className="px-2 py-1">{formatDateLabel(row.createdAt)}</td>
                                            <td className="px-2 py-1">{TEMPLATE_LABELS[(row.templateKey as AutomationTemplateKey)] || row.templateKey}</td>
                                            <td className="px-2 py-1">{row.status}</td>
                                            <td className="px-2 py-1">{row.attemptCount}/{row.maxAttempts}</td>
                                            <td className="px-2 py-1 font-mono">{row.traceId ? `${row.traceId.slice(0, 8)}...` : "-"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground">No worker jobs yet.</p>
                    )}
                </div>
            </div>

            {latestRun?.success && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    Last manual run: planned {latestRun?.stats?.planner?.jobsCreated || 0}, completed {latestRun?.stats?.worker?.completed || 0}, retried {latestRun?.stats?.worker?.retried || 0}, dead-lettered {latestRun?.stats?.worker?.deadLettered || 0}.
                </div>
            )}

            <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                    <div>
                        <Label htmlFor="automationEnabled" className="text-sm font-medium">Enable Automation Hub</Label>
                        <p className="text-[11px] text-muted-foreground">Human approval remains required before sending.</p>
                    </div>
                    <input
                        id="automationEnabled"
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                        checked={config.enabled}
                        onChange={(event) => setConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
                    />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                        <Label htmlFor="automationMaxFollowUps">Max follow-ups per contact</Label>
                        <Input
                            id="automationMaxFollowUps"
                            type="number"
                            min={1}
                            max={12}
                            value={config.maxFollowUps}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                maxFollowUps: toBoundedInt(event.target.value, 1, 12, prev.maxFollowUps),
                            }))}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="automationCadence">Follow-up cadence</Label>
                        <select
                            id="automationCadence"
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                            value={config.followUpCadence}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                followUpCadence: event.target.value as AiAutomationConfig["followUpCadence"],
                            }))}
                        >
                            {CADENCE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                        <Label htmlFor="automationResearchDepth">Research depth</Label>
                        <select
                            id="automationResearchDepth"
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                            value={config.researchDepth}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                researchDepth: event.target.value as AiAutomationConfig["researchDepth"],
                            }))}
                        >
                            {RESEARCH_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="automationStyleProfile">Style profile</Label>
                        <select
                            id="automationStyleProfile"
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                            value={config.styleProfile}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                styleProfile: event.target.value as AiAutomationConfig["styleProfile"],
                            }))}
                        >
                            {STYLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="space-y-3 rounded-md border bg-white p-3">
                    <Label className="text-sm font-medium">Quiet hours</Label>
                    <div className="flex items-center gap-2">
                        <input
                            id="quietHoursEnabled"
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                            checked={!!config.quietHours?.enabled}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                quietHours: {
                                    ...(prev.quietHours || {}),
                                    enabled: event.target.checked,
                                },
                            }))}
                        />
                        <Label htmlFor="quietHoursEnabled" className="text-xs text-muted-foreground">Pause job planning in quiet hours</Label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-1.5">
                            <Label htmlFor="quietStart" className="text-xs">Start hour (0-23)</Label>
                            <Input
                                id="quietStart"
                                type="number"
                                min={0}
                                max={23}
                                value={Number(config.quietHours?.startHour ?? 21)}
                                onChange={(event) => setConfig((prev) => ({
                                    ...prev,
                                    quietHours: {
                                        ...(prev.quietHours || {}),
                                        startHour: toBoundedInt(event.target.value, 0, 23, Number(prev.quietHours?.startHour ?? 21)),
                                    },
                                }))}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="quietEnd" className="text-xs">End hour (0-23)</Label>
                            <Input
                                id="quietEnd"
                                type="number"
                                min={0}
                                max={23}
                                value={Number(config.quietHours?.endHour ?? 8)}
                                onChange={(event) => setConfig((prev) => ({
                                    ...prev,
                                    quietHours: {
                                        ...(prev.quietHours || {}),
                                        endHour: toBoundedInt(event.target.value, 0, 23, Number(prev.quietHours?.endHour ?? 8)),
                                    },
                                }))}
                            />
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                        <Label htmlFor="dailyCapConversation">Daily cap per conversation</Label>
                        <Input
                            id="dailyCapConversation"
                            type="number"
                            min={1}
                            max={50}
                            value={Number(config.dailyCaps?.perConversation ?? 3)}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                dailyCaps: {
                                    ...(prev.dailyCaps || {}),
                                    perConversation: toBoundedInt(event.target.value, 1, 50, Number(prev.dailyCaps?.perConversation ?? 3)),
                                },
                            }))}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="dailyCapLocation">Daily cap per location</Label>
                        <Input
                            id="dailyCapLocation"
                            type="number"
                            min={1}
                            max={1000}
                            value={Number(config.dailyCaps?.perLocation ?? 150)}
                            onChange={(event) => setConfig((prev) => ({
                                ...prev,
                                dailyCaps: {
                                    ...(prev.dailyCaps || {}),
                                    perLocation: toBoundedInt(event.target.value, 1, 1000, Number(prev.dailyCaps?.perLocation ?? 150)),
                                },
                            }))}
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Enabled templates</Label>
                    <div className="space-y-3">
                        {BUILTIN_AUTOMATION_TEMPLATES.map((templateKey) => {
                            const override = config.templateOverrides?.[templateKey] || {};
                            const policy = config.schedulePolicies?.[templateKey] || {};
                            const checked = enabledTemplateSet.has(templateKey);

                            return (
                                <div key={templateKey} className="rounded-md border bg-white p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                                                checked={checked}
                                                onChange={(event) => setTemplateEnabled(templateKey, event.target.checked)}
                                            />
                                            {TEMPLATE_LABELS[templateKey]}
                                        </label>
                                    </div>
                                    {checked && (
                                        <div className="mt-3 space-y-2 border-t pt-3">
                                            <div className="grid gap-2">
                                                <Label className="text-xs text-muted-foreground">Custom template prompt (optional)</Label>
                                                <textarea
                                                    className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                                                    placeholder="Optional plain-text template prompt override"
                                                    value={String((override as any).prompt || "")}
                                                    onChange={(event) => updateTemplateOverride(templateKey, { prompt: event.target.value })}
                                                />
                                                <p className="text-[10px] text-muted-foreground">Plain text only (no markdown headers/links/code blocks).</p>
                                            </div>
                                            <div className="grid gap-2 md:grid-cols-3">
                                                <div className="grid gap-1">
                                                    <Label className="text-[11px] text-muted-foreground">Override max follow-ups</Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={12}
                                                        value={(override as any).maxFollowUps ?? ""}
                                                        placeholder={`Default ${config.maxFollowUps}`}
                                                        onChange={(event) => {
                                                            const raw = event.target.value.trim();
                                                            if (!raw) {
                                                                updateTemplateOverride(templateKey, { maxFollowUps: undefined });
                                                                return;
                                                            }
                                                            updateTemplateOverride(templateKey, {
                                                                maxFollowUps: toBoundedInt(raw, 1, 12, config.maxFollowUps),
                                                            });
                                                        }}
                                                    />
                                                </div>
                                                <div className="grid gap-1">
                                                    <Label className="text-[11px] text-muted-foreground">Override research depth</Label>
                                                    <select
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                                                        value={String((override as any).researchDepth || "")}
                                                        onChange={(event) => updateTemplateOverride(templateKey, {
                                                            researchDepth: (event.target.value || undefined) as any,
                                                        })}
                                                    >
                                                        <option value="">Use global</option>
                                                        {RESEARCH_OPTIONS.map((option) => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="grid gap-1">
                                                    <Label className="text-[11px] text-muted-foreground">Override style profile</Label>
                                                    <select
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                                                        value={String((override as any).styleProfile || "")}
                                                        onChange={(event) => updateTemplateOverride(templateKey, {
                                                            styleProfile: (event.target.value || undefined) as any,
                                                        })}
                                                    >
                                                        <option value="">Use global</option>
                                                        {STYLE_OPTIONS.map((option) => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-2 rounded-md border bg-slate-50 p-2.5">
                                                <Label className="text-[11px] font-medium text-slate-700">Scheduler policy</Label>

                                                {templateKey === "post_viewing_follow_up" && (
                                                    <div className="grid gap-1.5 md:max-w-xs">
                                                        <Label className="text-[11px] text-muted-foreground">Min hours after viewing</Label>
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={168}
                                                            value={Number((policy as any).minHoursSinceViewing ?? 2)}
                                                            onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                minHoursSinceViewing: toBoundedInt(event.target.value, 1, 168, Number((policy as any).minHoursSinceViewing ?? 2)),
                                                            })}
                                                        />
                                                    </div>
                                                )}

                                                {templateKey === "inactive_lead_reengagement" && (
                                                    <div className="grid gap-2 md:grid-cols-2">
                                                        <div className="grid gap-1">
                                                            <Label className="text-[11px] text-muted-foreground">Inactive days threshold</Label>
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                max={180}
                                                                value={Number((policy as any).inactivityDays ?? 7)}
                                                                onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                    inactivityDays: toBoundedInt(event.target.value, 1, 180, Number((policy as any).inactivityDays ?? 7)),
                                                                })}
                                                            />
                                                        </div>
                                                        <div className="grid gap-1">
                                                            <Label className="text-[11px] text-muted-foreground">Minimum lead score</Label>
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                max={100}
                                                                value={Number((policy as any).minLeadScore ?? 30)}
                                                                onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                    minLeadScore: toBoundedInt(event.target.value, 0, 100, Number((policy as any).minLeadScore ?? 30)),
                                                                })}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {templateKey === "re_engagement" && (
                                                    <div className="grid gap-1.5 md:max-w-xs">
                                                        <Label className="text-[11px] text-muted-foreground">Inactive days threshold</Label>
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={180}
                                                            value={Number((policy as any).inactivityDays ?? 10)}
                                                            onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                inactivityDays: toBoundedInt(event.target.value, 1, 180, Number((policy as any).inactivityDays ?? 10)),
                                                            })}
                                                        />
                                                    </div>
                                                )}

                                                {templateKey === "listing_alert" && (
                                                    <div className="grid gap-1.5 md:max-w-xs">
                                                        <Label className="text-[11px] text-muted-foreground">Listing lookback hours</Label>
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={168}
                                                            value={Number((policy as any).listingLookbackHours ?? 1)}
                                                            onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                listingLookbackHours: toBoundedInt(event.target.value, 1, 168, Number((policy as any).listingLookbackHours ?? 1)),
                                                            })}
                                                        />
                                                    </div>
                                                )}

                                                {templateKey === "custom_follow_up" && (
                                                    <div className="grid gap-2">
                                                        <div className="grid gap-1">
                                                            <Label className="text-[11px] text-muted-foreground">Campaign context</Label>
                                                            <textarea
                                                                className="flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                                                                placeholder="Describe the custom follow-up goal/context..."
                                                                value={String((policy as any).customContext || "")}
                                                                onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                    customContext: event.target.value.trim(),
                                                                })}
                                                            />
                                                        </div>
                                                        <div className="grid gap-1 md:grid-cols-2">
                                                            <div className="grid gap-1">
                                                                <Label className="text-[11px] text-muted-foreground">Target conversation IDs (optional)</Label>
                                                                <textarea
                                                                    className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                                                                    placeholder="One per line or comma-separated"
                                                                    value={formatIdList((policy as any).targetConversationIds)}
                                                                    onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                        targetConversationIds: parseIdListInput(event.target.value),
                                                                    })}
                                                                />
                                                            </div>
                                                            <div className="grid gap-1">
                                                                <Label className="text-[11px] text-muted-foreground">Target contact IDs (optional)</Label>
                                                                <textarea
                                                                    className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                                                                    placeholder="One per line or comma-separated"
                                                                    value={formatIdList((policy as any).targetContactIds)}
                                                                    onChange={(event) => updateSchedulePolicy(templateKey, {
                                                                        targetContactIds: parseIdListInput(event.target.value),
                                                                    })}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button type="button" onClick={saveAutomationConfig} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save Automation Settings
                    </Button>
                    <Button type="button" variant="outline" onClick={runAutomationNow} disabled={running}>
                        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                        Run Automation Now
                    </Button>
                </div>
            </div>
        </div>
    );
}
