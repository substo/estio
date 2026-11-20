"use server";

import { auth } from "@clerk/nextjs/server";
import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";
import { revalidatePath } from "next/cache";
import { resolveAuthenticatedDbUserId } from "@/lib/auth/current-user";
import { getStudioAccess } from "@/lib/studio/access";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import { SettingsVersionConflictError } from "@/lib/settings/errors";
import { runRequirementsIntelligenceCron } from "@/lib/ai/requirements-intelligence/service";
import { LOCATION_CONFIG_DEFAULTS } from "@/lib/location-config/model";
import { CRM_FEATURE_SETTINGS, crmFeatureSettingsPatch, type CrmFeatureSettingsSection, type CrmFeatureSettingsState } from "./fields";
import {
    listAiDecisions,
    listAiRuntimeJobs,
    listAgentLearningProposalsAction,
    listLocationAiPromptVersionsAction,
    listSkillPolicies,
    approveAgentLearningProposalAction,
    dismissAgentLearningProposalAction,
    revertLocationAiPromptAction,
    runAiRuntimeNow,
    simulateSkillDecision,
    submitAgentLearningProposalAction,
    upsertSkillPolicy,
} from "@/app/(main)/admin/conversations/actions";

async function authorizeAiSettingsLocation(locationId: unknown) {
    const targetLocationId = typeof locationId === "string" ? locationId.trim() : "";
    if (!targetLocationId) return { ok: false as const, error: "Missing Location ID." };
    const [access, session] = await Promise.all([getStudioAccess(targetLocationId), auth()]);
    if (access?.app !== "estio" || access.role !== "ADMIN" || session.actor) {
        return { ok: false as const, error: "Location admin access is required." };
    }
    return { ok: true as const, locationId: access.locationId };
}

export async function updateCrmFeatureSettings(
    section: CrmFeatureSettingsSection,
    previous: CrmFeatureSettingsState,
    form: FormData,
): Promise<CrmFeatureSettingsState> {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "updateCrmFeatureSettings");
    if (!Object.hasOwn(CRM_FEATURE_SETTINGS, section)) return { ...previous, error: "Unknown settings section." };
    const authorization = await authorizeAiSettingsLocation(form.get("locationId"));
    if (!authorization.ok) return { ...previous, error: authorization.error };

    const version = String(form.get("settingsVersion") ?? "");
    const expectedVersion = Number(version);
    if (!version || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        return { ...previous, error: "Refresh this page before saving your changes." };
    }
    const { locationId } = authorization;
    const target = { scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI } as const;
    try {
        const [current, actorUserId] = await Promise.all([
            settingsService.getDocument<Record<string, unknown>>(target),
            resolveAuthenticatedDbUserId(),
        ]);
        const existing = current?.payload ?? {};
        const saved = await settingsService.upsertDocument({
            ...target,
            expectedVersion,
            actorUserId,
            schemaVersion: current?.schemaVersion ?? 1,
            payload: {
                whatsappTranscriptRetentionDays: LOCATION_CONFIG_DEFAULTS.whatsappTranscriptRetentionDays,
                ...existing,
                ...crmFeatureSettingsPatch(section, form, existing),
            },
        });
        revalidatePath(`/settings/${section}`);
        revalidatePath(CRM_FEATURE_SETTINGS[section].featureHref);
        return { version: saved.version };
    } catch (error) {
        if (error instanceof SettingsVersionConflictError) {
            return { ...previous, error: "Another tab changed the settings. Refresh this page and try again." };
        }
        console.error("Could not save CRM feature settings", error);
        return { ...previous, error: "Could not save your changes." };
    }
}

type RunAiAutomationNowResult = {
    success: boolean;
    error?: string;
    stats?: any;
};

async function runAiAutomationNowAction(
    locationId: string,
    options?: { plannerOnly?: boolean; batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false, error: authorization.error };

    try {
        const runtime = await runAiRuntimeNow(authorization.locationId, {
            plannerOnly: !!options?.plannerOnly,
            batchSize: Math.max(1, Math.min(300, Number(options?.batchSize || 80))),
            source: "automation",
        });
        if (!runtime.success) {
            return { success: false, error: runtime.error || "Failed to run AI runtime cron." };
        }

        revalidatePath("/settings/conversations");
        return { success: true, stats: runtime.stats };
    } catch (error: any) {
        console.error("[runAiRuntimeNowAction] Error:", error);
        return { success: false, error: error?.message || "Failed to run runtime cron." };
    }
}

export async function runAiRuntimeNowAction(
    locationId: string,
    options?: { plannerOnly?: boolean; batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "runAiRuntimeNowAction");
    return runAiAutomationNowAction(locationId, options);
}

export async function runRequirementsIntelligenceNowAction(
    locationId: string,
    options?: { batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "runRequirementsIntelligenceNowAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false, error: authorization.error };

    try {
        const stats = await runRequirementsIntelligenceCron({
            locationId: authorization.locationId,
            batchSize: Math.max(1, Math.min(100, Number(options?.batchSize || 40))),
            source: "manual",
            force: true,
        });
        revalidatePath("/settings/contacts");
        return { success: true, stats };
    } catch (error: any) {
        console.error("[runRequirementsIntelligenceNowAction] Error:", error);
        return { success: false, error: error?.message || "Failed to run Requirements Intelligence scan." };
    }
}

export async function listSkillPoliciesFromSettingsAction(locationId: string) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "listSkillPoliciesFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listSkillPolicies(authorization.locationId);
}

export async function upsertSkillPolicyFromSettingsAction(locationId: string, skillId: string, policy: unknown) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "upsertSkillPolicyFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return upsertSkillPolicy(authorization.locationId, skillId, policy);
}

export async function submitAgentLearningProposalFromSettingsAction(locationId: string, input: {
    skillId?: string | null;
    type?: "style_policy" | "location_knowledge" | string | null;
    title?: string | null;
    description?: string | null;
    proposedContent?: string | null;
    category?: string | null;
    key?: string | null;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "submitAgentLearningProposalFromSettingsAction");
    return submitAgentLearningProposalAction({
        ...input,
        locationId,
    });
}

export async function listAgentLearningProposalsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    limit?: number;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "listAgentLearningProposalsFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listAgentLearningProposalsAction({
        locationId: authorization.locationId,
        status: input?.status ?? null,
        limit: input?.limit,
    });
}

export async function approveAgentLearningProposalFromSettingsAction(locationId: string, proposalId: string) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "approveAgentLearningProposalFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return approveAgentLearningProposalAction({
        locationId: authorization.locationId,
        proposalId,
    });
}

export async function dismissAgentLearningProposalFromSettingsAction(locationId: string, proposalId: string) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "dismissAgentLearningProposalFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return dismissAgentLearningProposalAction({
        locationId: authorization.locationId,
        proposalId,
    });
}

export async function revertLocationAiPromptFromSettingsAction(locationId: string, input: {
    skillId: string;
    versionId?: string | null;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "revertLocationAiPromptFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return revertLocationAiPromptAction({
        locationId: authorization.locationId,
        skillId: input.skillId,
        versionId: input.versionId || null,
        targetKind: "style_policy",
    });
}

export async function listLocationAiPromptVersionsFromSettingsAction(locationId: string, input?: {
    skillId?: string | null;
    limit?: number;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "listLocationAiPromptVersionsFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listLocationAiPromptVersionsAction({
        locationId: authorization.locationId,
        skillId: input?.skillId || null,
        targetKind: "style_policy",
        limit: input?.limit,
    });
}

export async function listAiRuntimeDecisionsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    skillId?: string | null;
    since?: string | null;
    limit?: number;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "listAiRuntimeDecisionsFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listAiDecisions({
        ...input,
        locationId: authorization.locationId,
        limit: Math.max(1, Math.min(120, Number(input?.limit || 40))),
    });
}

export async function listAiRuntimeJobsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    since?: string | null;
    limit?: number;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "listAiRuntimeJobsFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listAiRuntimeJobs({
        ...input,
        locationId: authorization.locationId,
        limit: Math.max(1, Math.min(120, Number(input?.limit || 40))),
    });
}

export async function simulateSkillDecisionFromSettingsAction(input: {
    locationId: string;
    conversationId?: string | null;
    dealId?: string | null;
    contactId?: string | null;
}) {
    await assertCrmActionAllowed("settings/_components/crm-features/actions.ts", "simulateSkillDecisionFromSettingsAction");
    const authorization = await authorizeAiSettingsLocation(input.locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return simulateSkillDecision(input);
}
