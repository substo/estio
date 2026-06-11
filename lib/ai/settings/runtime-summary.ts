import db from "@/lib/db";
import { ensureDefaultSkillPolicies } from "@/lib/ai/runtime/engine";
import { getContactProfileVerificationQueueStatus } from "@/lib/ai/contact-profile-verification/cron";
import { getCurrentContactClassificationRun } from "@/lib/ai/contact-classification/job";

export const EMPTY_AI_RUNTIME_SUMMARY = {
    totalPolicies: 0,
    enabledPolicies: 0,
    nextRunAt: null,
    pendingJobs: 0,
    deadJobs: 0,
    pendingSuggestions: 0,
    pendingRequirementProposals: 0,
    pendingVerificationProposals: 0,
    contactClassificationQueue: null,
    contactClassificationRun: null,
    policies: [],
    recentDecisions: [],
    recentJobs: [],
};

export async function loadAiRuntimeSummary(locationId: string) {
    try {
        await ensureDefaultSkillPolicies(locationId);
        const [
            totalPolicies,
            enabledPolicies,
            nextJob,
            pendingRuntimeJobs,
            deadRuntimeJobs,
            pendingSuggestions,
            pendingRequirementProposals,
            pendingVerificationProposals,
            contactClassificationQueue,
            contactClassificationRun,
            policies,
            recentDecisions,
            recentRuntimeJobs,
        ] = await Promise.all([
            db.aiSkillPolicy.count({
                where: { locationId },
            }),
            db.aiSkillPolicy.count({
                where: { locationId, enabled: true },
            }),
            db.aiRuntimeJob.findFirst({
                where: {
                    locationId,
                    status: "pending",
                },
                orderBy: { scheduledAt: "asc" },
                select: { scheduledAt: true },
            }),
            db.aiRuntimeJob.count({
                where: {
                    locationId,
                    status: "pending",
                },
            }),
            db.aiRuntimeJob.count({
                where: {
                    locationId,
                    status: "dead",
                },
            }),
            db.aiSuggestedResponse.count({
                where: {
                    locationId,
                    status: "pending",
                    source: { contains: "skill:" },
                },
            }),
            db.contactRequirementProposal.count({
                where: {
                    locationId,
                    status: "pending",
                    proposalType: "requirements",
                },
            }),
            db.contactRequirementProposal.count({
                where: {
                    locationId,
                    status: "pending",
                    proposalType: "verification",
                },
            }),
            getContactProfileVerificationQueueStatus({ locationId }),
            getCurrentContactClassificationRun({ locationId }),
            db.aiSkillPolicy.findMany({
                where: { locationId },
                orderBy: [{ enabled: "desc" }, { objective: "asc" }, { skillId: "asc" }],
                select: {
                    id: true,
                    skillId: true,
                    objective: true,
                    enabled: true,
                    version: true,
                    decisionPolicy: true,
                    channelPolicy: true,
                    compliancePolicy: true,
                    updatedAt: true,
                },
                take: 80,
            }),
            db.aiDecision.findMany({
                where: { locationId },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    selectedSkillId: true,
                    selectedObjective: true,
                    selectedScore: true,
                    status: true,
                    source: true,
                    holdReason: true,
                    traceId: true,
                    createdAt: true,
                },
                take: 40,
            }),
            db.aiRuntimeJob.findMany({
                where: { locationId },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    status: true,
                    attemptCount: true,
                    maxAttempts: true,
                    scheduledAt: true,
                    processedAt: true,
                    traceId: true,
                    lastError: true,
                    decision: {
                        select: {
                            selectedSkillId: true,
                            selectedObjective: true,
                        },
                    },
                    createdAt: true,
                },
                take: 30,
            }),
        ]);

        return {
            totalPolicies,
            enabledPolicies,
            nextRunAt: nextJob?.scheduledAt ? nextJob.scheduledAt.toISOString() : null,
            pendingJobs: pendingRuntimeJobs,
            deadJobs: deadRuntimeJobs,
            pendingSuggestions,
            pendingRequirementProposals,
            pendingVerificationProposals,
            contactClassificationQueue,
            contactClassificationRun,
            policies: policies.map((item) => ({
                id: item.id,
                skillId: item.skillId,
                objective: item.objective,
                enabled: item.enabled,
                version: item.version,
                decisionPolicy: item.decisionPolicy || {},
                channelPolicy: item.channelPolicy || {},
                compliancePolicy: item.compliancePolicy || {},
                updatedAt: item.updatedAt.toISOString(),
            })),
            recentDecisions: recentDecisions.map((item) => ({
                id: item.id,
                selectedSkillId: item.selectedSkillId || null,
                selectedObjective: item.selectedObjective || null,
                selectedScore: item.selectedScore || null,
                status: item.status,
                source: item.source,
                holdReason: item.holdReason || null,
                traceId: item.traceId || null,
                createdAt: item.createdAt.toISOString(),
            })),
            recentJobs: recentRuntimeJobs.map((item) => ({
                id: item.id,
                selectedSkillId: item.decision?.selectedSkillId || null,
                selectedObjective: item.decision?.selectedObjective || null,
                status: item.status,
                attemptCount: item.attemptCount,
                maxAttempts: item.maxAttempts,
                scheduledAt: item.scheduledAt.toISOString(),
                processedAt: item.processedAt ? item.processedAt.toISOString() : null,
                traceId: item.traceId || null,
                lastError: item.lastError || null,
                createdAt: item.createdAt.toISOString(),
            })),
        };
    } catch (error) {
        console.warn("[AiSettingsRuntimeSummary] Failed to load automation summary:", error);
        return EMPTY_AI_RUNTIME_SUMMARY;
    }
}
