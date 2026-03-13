"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    listAiRuntimeDecisionsFromSettingsAction,
    listAiRuntimeJobsFromSettingsAction,
    listSkillPoliciesFromSettingsAction,
    runAiRuntimeNowAction,
    simulateSkillDecisionFromSettingsAction,
    upsertSkillPolicyFromSettingsAction,
} from "./actions";

type RuntimeSummary = {
    totalPolicies: number;
    enabledPolicies: number;
    nextRunAt: string | null;
    pendingJobs: number;
    deadJobs: number;
    pendingSuggestions: number;
    policies: any[];
    recentDecisions: any[];
    recentJobs: any[];
};

interface SkillRuntimeSettingsProps {
    locationId: string;
    summary?: RuntimeSummary | null;
}

const OBJECTIVE_OPTIONS = [
    { value: "nurture", label: "Nurture" },
    { value: "book_viewing", label: "Book Viewing" },
    { value: "revive", label: "Revive" },
    { value: "listing_alert", label: "Listing Alert" },
    { value: "deal_progress", label: "Deal Progress" },
];

const AGGRESSIVENESS_OPTIONS = [
    { value: "conservative", label: "Conservative" },
    { value: "balanced", label: "Balanced" },
    { value: "assertive", label: "Assertive" },
];

function formatDateLabel(value: string | null | undefined): string {
    if (!value) return "Not scheduled";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Not scheduled";
    return d.toLocaleString();
}

function toBoundedNumber(value: string, min: number, max: number, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalizePolicy(policy: any) {
    return {
        id: policy.id,
        skillId: String(policy.skillId || ""),
        enabled: Boolean(policy.enabled),
        objective: String(policy.objective || "nurture"),
        humanApprovalRequired: policy.humanApprovalRequired !== false,
        decisionPolicy: {
            aggressiveness: String(policy.decisionPolicy?.aggressiveness || "balanced"),
            minScoreThreshold: Number(policy.decisionPolicy?.minScoreThreshold ?? 0.45),
            baseCooldownHours: Number(policy.decisionPolicy?.baseCooldownHours ?? 24),
            maxSuggestionsPer7d: Number(policy.decisionPolicy?.maxSuggestionsPer7d ?? 7),
        },
        stylePolicy: {
            profile: String(policy.stylePolicy?.profile || "professional"),
            tone: String(policy.stylePolicy?.tone || "helpful"),
            customInstructions: String(policy.stylePolicy?.customInstructions || ""),
        },
        researchPolicy: {
            depthBudget: Number(policy.researchPolicy?.depthBudget ?? 2),
            citationRequired: Boolean(policy.researchPolicy?.citationRequired),
        },
        channelPolicy: {
            enabledChannels: Array.isArray(policy.channelPolicy?.enabledChannels)
                ? policy.channelPolicy.enabledChannels
                : ["whatsapp", "sms", "email"],
            quietHours: {
                enabled: policy.channelPolicy?.quietHours?.enabled !== false,
                startHour: Number(policy.channelPolicy?.quietHours?.startHour ?? 21),
                endHour: Number(policy.channelPolicy?.quietHours?.endHour ?? 8),
            },
            dailyCapPerConversation: Number(policy.channelPolicy?.dailyCapPerConversation ?? 3),
            dailyCapPerLocation: Number(policy.channelPolicy?.dailyCapPerLocation ?? 150),
        },
        compliancePolicy: {
            globalBaseline: String(policy.compliancePolicy?.globalBaseline || "us_eu_safe"),
            requireConsent: policy.compliancePolicy?.requireConsent !== false,
            enforceOptOut: policy.compliancePolicy?.enforceOptOut !== false,
            enforceQuietHours: policy.compliancePolicy?.enforceQuietHours !== false,
            enforceEmailSenderAuth: policy.compliancePolicy?.enforceEmailSenderAuth !== false,
            requireUnsubscribeForEmail: policy.compliancePolicy?.requireUnsubscribeForEmail !== false,
        },
        contactSegments: {
            minLeadScore: Number(policy.contactSegments?.minLeadScore ?? 0),
            maxInactivityDays: Number(policy.contactSegments?.maxInactivityDays ?? 30),
            includeTags: Array.isArray(policy.contactSegments?.includeTags) ? policy.contactSegments.includeTags : [],
            excludeTags: Array.isArray(policy.contactSegments?.excludeTags) ? policy.contactSegments.excludeTags : [],
        },
        version: Number(policy.version || 1),
    };
}

export function SkillRuntimeSettings({ locationId, summary }: SkillRuntimeSettingsProps) {
    const initialPolicies = useMemo(
        () => (summary?.policies || []).map((policy) => normalizePolicy(policy)),
        [summary?.policies]
    );

    const [policies, setPolicies] = useState<any[]>(initialPolicies);
    const [decisions, setDecisions] = useState<any[]>(summary?.recentDecisions || []);
    const [jobs, setJobs] = useState<any[]>(summary?.recentJobs || []);
    const [busyPolicyId, setBusyPolicyId] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [simulating, setSimulating] = useState(false);
    const [simulationInput, setSimulationInput] = useState({
        conversationId: "",
        dealId: "",
        contactId: "",
    });
    const [simulationResult, setSimulationResult] = useState<any>(null);

    const derivedEnabledPolicies = policies.length > 0
        ? policies.filter((policy) => policy.enabled).length
        : (summary?.enabledPolicies ?? 0);
    const derivedTotalPolicies = policies.length > 0
        ? policies.length
        : (summary?.totalPolicies ?? 0);
    const derivedPendingJobs = jobs.length > 0
        ? jobs.filter((job) => String(job?.status || "").toLowerCase() === "pending").length
        : (summary?.pendingJobs ?? 0);
    const derivedDeadJobs = jobs.length > 0
        ? jobs.filter((job) => String(job?.status || "").toLowerCase() === "dead").length
        : (summary?.deadJobs ?? 0);
    const derivedNextRunAt = useMemo(() => {
        const pending = jobs
            .filter((job) => String(job?.status || "").toLowerCase() === "pending")
            .map((job) => String(job?.scheduledAt || "").trim())
            .filter(Boolean)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        return pending[0] || summary?.nextRunAt || null;
    }, [jobs, summary?.nextRunAt]);

    const refreshRuntimeData = useCallback(async () => {
        setRefreshing(true);
        try {
            const [policyRows, decisionRows, jobRows] = await Promise.all([
                listSkillPoliciesFromSettingsAction(locationId),
                listAiRuntimeDecisionsFromSettingsAction(locationId, { limit: 40 }),
                listAiRuntimeJobsFromSettingsAction(locationId, { limit: 30 }),
            ]);

            setPolicies(Array.isArray(policyRows) ? policyRows.map((policy) => normalizePolicy(policy)) : []);
            setDecisions(Array.isArray(decisionRows) ? decisionRows : []);
            setJobs(Array.isArray(jobRows)
                ? jobRows.map((job: any) => ({
                    ...job,
                    selectedSkillId: job?.selectedSkillId || job?.decision?.selectedSkillId || null,
                    selectedObjective: job?.selectedObjective || job?.decision?.selectedObjective || null,
                }))
                : []);
        } catch (error: any) {
            toast.error(error?.message || "Failed to refresh runtime data.");
        } finally {
            setRefreshing(false);
        }
    }, [locationId]);

    const updatePolicy = (policyId: string, patch: Record<string, any>) => {
        setPolicies((prev) => prev.map((policy) => {
            if (policy.id !== policyId) return policy;
            return { ...policy, ...patch };
        }));
    };

    const savePolicy = async (policy: any) => {
        if (!policy?.skillId) {
            toast.error("Missing skill identifier.");
            return;
        }

        setBusyPolicyId(policy.id);
        try {
            const result = await upsertSkillPolicyFromSettingsAction(locationId, policy.skillId, {
                enabled: policy.enabled,
                objective: policy.objective,
                humanApprovalRequired: true,
                decisionPolicy: policy.decisionPolicy,
                channelPolicy: policy.channelPolicy,
                compliancePolicy: policy.compliancePolicy,
                stylePolicy: policy.stylePolicy,
                researchPolicy: policy.researchPolicy,
                contactSegments: policy.contactSegments,
            });

            if (!result?.success) {
                toast.error(String(result?.error || "Failed to save skill policy."));
                return;
            }

            toast.success(`Saved policy for ${policy.skillId}.`);
            await refreshRuntimeData();
        } catch (error: any) {
            toast.error(error?.message || "Failed to save skill policy.");
        } finally {
            setBusyPolicyId(null);
        }
    };

    const runRuntimeNow = async () => {
        setRunning(true);
        try {
            const result = await runAiRuntimeNowAction(locationId, { batchSize: 100 });
            if (!result?.success) {
                toast.error(String(result?.error || "Runtime run failed."));
                return;
            }

            toast.success(
                `Runtime complete. Planned ${Number(result?.stats?.planner?.decisionsCreated || 0)}, completed ${Number(result?.stats?.worker?.completed || 0)}.`
            );
            await refreshRuntimeData();
        } catch (error: any) {
            toast.error(error?.message || "Runtime run failed.");
        } finally {
            setRunning(false);
        }
    };

    const simulateDecision = async () => {
        setSimulating(true);
        try {
            const result = await simulateSkillDecisionFromSettingsAction({
                locationId,
                conversationId: simulationInput.conversationId.trim() || null,
                dealId: simulationInput.dealId.trim() || null,
                contactId: simulationInput.contactId.trim() || null,
            });
            if (!(result as any)?.success) {
                toast.error(String((result as any)?.error || "Simulation failed."));
                setSimulationResult(null);
                return;
            }
            setSimulationResult(result);
        } catch (error: any) {
            toast.error(error?.message || "Simulation failed.");
            setSimulationResult(null);
        } finally {
            setSimulating(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h3 className="text-lg font-medium">Skill Runtime Hub</h3>
                <p className="text-sm text-muted-foreground">
                    Unified policy-driven runtime for manual drafts, semi-auto, mission orchestration, and cron follow-ups.
                </p>
            </div>

            <div className="grid gap-3 rounded-lg border bg-slate-50/50 p-4 md:grid-cols-4">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Enabled Policies</p>
                    <p className="text-sm font-semibold text-slate-900">
                        {derivedEnabledPolicies} / {derivedTotalPolicies}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Next Runtime Job</p>
                    <p className="text-sm font-semibold text-slate-900">{formatDateLabel(derivedNextRunAt)}</p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending Jobs / Dead</p>
                    <p className="text-sm font-semibold text-slate-900">
                        {derivedPendingJobs} / {derivedDeadJobs}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending Suggestions</p>
                    <p className="text-sm font-semibold text-slate-900">{summary?.pendingSuggestions ?? 0}</p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button type="button" onClick={runRuntimeNow} disabled={running}>
                    {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                    Run Runtime Now
                </Button>
                <Button type="button" variant="outline" onClick={refreshRuntimeData} disabled={refreshing}>
                    {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Refresh
                </Button>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Skill Policies</p>
                    <p className="text-[11px] text-muted-foreground">Global baseline: US+EU safe, human approval only</p>
                </div>

                {policies.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No skill policies yet.</p>
                ) : (
                    <div className="space-y-3">
                        {policies.map((policy) => (
                            <div key={policy.id} className="rounded-md border bg-white p-3 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-medium text-slate-900">{policy.skillId}</p>
                                        <p className="text-[11px] text-muted-foreground">v{policy.version} · objective: {policy.objective}</p>
                                    </div>
                                    <label className="inline-flex items-center gap-2 text-xs">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                                            checked={policy.enabled}
                                            onChange={(event) => updatePolicy(policy.id, { enabled: event.target.checked })}
                                        />
                                        Enabled
                                    </label>
                                </div>

                                <div className="grid gap-3 md:grid-cols-4">
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Objective</Label>
                                        <select
                                            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                                            value={policy.objective}
                                            onChange={(event) => updatePolicy(policy.id, { objective: event.target.value })}
                                        >
                                            {OBJECTIVE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Aggressiveness</Label>
                                        <select
                                            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                                            value={policy.decisionPolicy.aggressiveness}
                                            onChange={(event) => updatePolicy(policy.id, {
                                                decisionPolicy: {
                                                    ...policy.decisionPolicy,
                                                    aggressiveness: event.target.value,
                                                },
                                            })}
                                        >
                                            {AGGRESSIVENESS_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Min Score</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={1}
                                            step="0.01"
                                            value={policy.decisionPolicy.minScoreThreshold}
                                            onChange={(event) => updatePolicy(policy.id, {
                                                decisionPolicy: {
                                                    ...policy.decisionPolicy,
                                                    minScoreThreshold: toBoundedNumber(event.target.value, 0, 1, policy.decisionPolicy.minScoreThreshold),
                                                },
                                            })}
                                        />
                                    </div>
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Cooldown (hours)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={336}
                                            value={policy.decisionPolicy.baseCooldownHours}
                                            onChange={(event) => updatePolicy(policy.id, {
                                                decisionPolicy: {
                                                    ...policy.decisionPolicy,
                                                    baseCooldownHours: Math.round(toBoundedNumber(event.target.value, 1, 336, policy.decisionPolicy.baseCooldownHours)),
                                                },
                                            })}
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-3">
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Style Profile</Label>
                                        <Input
                                            value={policy.stylePolicy.profile}
                                            onChange={(event) => updatePolicy(policy.id, {
                                                stylePolicy: {
                                                    ...policy.stylePolicy,
                                                    profile: event.target.value,
                                                },
                                            })}
                                        />
                                    </div>
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Tone</Label>
                                        <Input
                                            value={policy.stylePolicy.tone}
                                            onChange={(event) => updatePolicy(policy.id, {
                                                stylePolicy: {
                                                    ...policy.stylePolicy,
                                                    tone: event.target.value,
                                                },
                                            })}
                                        />
                                    </div>
                                    <div className="grid gap-1">
                                        <Label className="text-[11px] text-muted-foreground">Research Depth Budget</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={5}
                                            value={policy.researchPolicy.depthBudget}
                                            onChange={(event) => updatePolicy(policy.id, {
                                                researchPolicy: {
                                                    ...policy.researchPolicy,
                                                    depthBudget: Math.round(toBoundedNumber(event.target.value, 1, 5, policy.researchPolicy.depthBudget)),
                                                },
                                            })}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-end">
                                    <Button
                                        type="button"
                                        onClick={() => savePolicy(policy)}
                                        disabled={busyPolicyId === policy.id}
                                    >
                                        {busyPolicyId === policy.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Save Policy
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-500" />
                    <p className="text-sm font-medium">Decision Simulator</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    <div className="grid gap-1">
                        <Label className="text-[11px] text-muted-foreground">Conversation ID (optional)</Label>
                        <Input
                            value={simulationInput.conversationId}
                            onChange={(event) => setSimulationInput((prev) => ({ ...prev, conversationId: event.target.value }))}
                            placeholder="ghlConversationId or internal ID"
                        />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-[11px] text-muted-foreground">Deal ID (optional)</Label>
                        <Input
                            value={simulationInput.dealId}
                            onChange={(event) => setSimulationInput((prev) => ({ ...prev, dealId: event.target.value }))}
                        />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-[11px] text-muted-foreground">Contact ID (optional)</Label>
                        <Input
                            value={simulationInput.contactId}
                            onChange={(event) => setSimulationInput((prev) => ({ ...prev, contactId: event.target.value }))}
                        />
                    </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <Button type="button" variant="outline" onClick={simulateDecision} disabled={simulating}>
                        {simulating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Simulate Decision
                    </Button>
                    {simulationResult?.selected && (
                        <p className="text-xs text-emerald-700">
                            Selected: {simulationResult.selected.skillId} ({simulationResult.selected.objective}) score {Number(simulationResult.selected.score || 0).toFixed(2)}
                        </p>
                    )}
                </div>
                {Array.isArray(simulationResult?.evaluations) && simulationResult.evaluations.length > 0 && (
                    <div className="max-h-52 overflow-auto rounded border">
                        <table className="min-w-full text-xs">
                            <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                    <th className="px-2 py-1 text-left font-medium">Skill</th>
                                    <th className="px-2 py-1 text-left font-medium">Objective</th>
                                    <th className="px-2 py-1 text-left font-medium">Score</th>
                                    <th className="px-2 py-1 text-left font-medium">Hold Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {simulationResult.evaluations.map((row: any) => (
                                    <tr key={`${row.policyId}:${row.skillId}`} className="border-t">
                                        <td className="px-2 py-1">{row.skillId}</td>
                                        <td className="px-2 py-1">{row.objective}</td>
                                        <td className="px-2 py-1">{Number(row.score || 0).toFixed(2)}</td>
                                        <td className="px-2 py-1">{row.holdReason || "-"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">Recent Decisions</p>
                    {decisions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No recent decisions yet.</p>
                    ) : (
                        <div className="max-h-56 overflow-auto rounded border">
                            <table className="min-w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="px-2 py-1 text-left font-medium">Created</th>
                                        <th className="px-2 py-1 text-left font-medium">Skill</th>
                                        <th className="px-2 py-1 text-left font-medium">Status</th>
                                        <th className="px-2 py-1 text-left font-medium">Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {decisions.map((row) => (
                                        <tr key={row.id} className="border-t">
                                            <td className="px-2 py-1">{formatDateLabel(row.createdAt)}</td>
                                            <td className="px-2 py-1">{row.selectedSkillId || "-"}</td>
                                            <td className="px-2 py-1">{row.status}</td>
                                            <td className="px-2 py-1">{row.selectedScore != null ? Number(row.selectedScore).toFixed(2) : "-"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">Recent Runtime Jobs</p>
                    {jobs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No recent runtime jobs yet.</p>
                    ) : (
                        <div className="max-h-56 overflow-auto rounded border">
                            <table className="min-w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="px-2 py-1 text-left font-medium">Created</th>
                                        <th className="px-2 py-1 text-left font-medium">Skill</th>
                                        <th className="px-2 py-1 text-left font-medium">Status</th>
                                        <th className="px-2 py-1 text-left font-medium">Attempts</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobs.map((row) => (
                                        <tr key={row.id} className="border-t">
                                            <td className="px-2 py-1">{formatDateLabel(row.createdAt)}</td>
                                            <td className="px-2 py-1">{row.selectedSkillId || "-"}</td>
                                            <td className="px-2 py-1">{row.status}</td>
                                            <td className="px-2 py-1">{row.attemptCount}/{row.maxAttempts}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
