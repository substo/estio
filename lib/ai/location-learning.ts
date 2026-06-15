import db from "@/lib/db";
import { AiSkillPolicySchema } from "@/lib/ai/runtime/config";

export type LearningTargetKind = "style_policy" | "location_knowledge";

export function normalizeLearningTargetKind(value: unknown): LearningTargetKind {
    return String(value || "").trim() === "location_knowledge" ? "location_knowledge" : "style_policy";
}

function normalizeSkillId(value: unknown): string {
    return String(value || "").trim() || "general";
}

function normalizeContent(value: unknown, maxLength = 4000): string {
    return String(value || "").trim().slice(0, maxLength);
}

function slugifyKnowledgeKey(value: unknown): string {
    const slug = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
    return slug || "ai_learning";
}

export async function ensureLocationAiPromptVersion(input: {
    locationId: string;
    skillId: string;
    targetKind?: string | null;
    currentContent?: string | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const skillId = normalizeSkillId(input.skillId);
    const targetKind = normalizeLearningTargetKind(input.targetKind);
    const content = normalizeContent(input.currentContent, 4000);

    const existing = await (db as any).locationAiPromptVersion.findFirst({
        where: { locationId, skillId, targetKind },
        orderBy: { createdAt: "asc" },
        select: { id: true },
    });
    if (existing) return existing;

    return (db as any).locationAiPromptVersion.create({
        data: {
            locationId,
            skillId,
            targetKind,
            content,
            isDefault: true,
            isCurrent: true,
            source: "default_seed",
            metadata: {
                seededFrom: "current_policy",
            },
        },
        select: { id: true },
    });
}

export async function createCurrentPromptVersion(input: {
    locationId: string;
    skillId: string;
    targetKind?: string | null;
    content: string;
    proposalId?: string | null;
    approvedByUserId?: string | null;
    source?: "learning_proposal" | "manual" | "revert";
    revertedFromVersionId?: string | null;
    metadata?: Record<string, unknown> | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const skillId = normalizeSkillId(input.skillId);
    const targetKind = normalizeLearningTargetKind(input.targetKind);
    const content = normalizeContent(input.content, 4000);

    const previous = await (db as any).locationAiPromptVersion.findFirst({
        where: { locationId, skillId, targetKind, isCurrent: true },
        orderBy: { createdAt: "desc" },
        select: { id: true },
    });

    await (db as any).locationAiPromptVersion.updateMany({
        where: { locationId, skillId, targetKind, isCurrent: true },
        data: { isCurrent: false },
    });

    return (db as any).locationAiPromptVersion.create({
        data: {
            locationId,
            skillId,
            targetKind,
            content,
            isDefault: false,
            isCurrent: true,
            source: input.source || "manual",
            proposalId: input.proposalId || null,
            previousVersionId: previous?.id || null,
            approvedByUserId: input.approvedByUserId || null,
            revertedFromVersionId: input.revertedFromVersionId || null,
            metadata: input.metadata || undefined,
        },
    });
}

export async function getPromptVersionForRevert(input: {
    locationId: string;
    skillId: string;
    targetKind?: string | null;
    versionId?: string | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const skillId = normalizeSkillId(input.skillId);
    const targetKind = normalizeLearningTargetKind(input.targetKind);
    const versionId = String(input.versionId || "").trim();

    if (versionId) {
        return (db as any).locationAiPromptVersion.findFirst({
            where: { id: versionId, locationId, skillId, targetKind },
        });
    }

    return (db as any).locationAiPromptVersion.findFirst({
        where: { locationId, skillId, targetKind, isDefault: true },
        orderBy: { createdAt: "asc" },
    });
}

export async function upsertLocationKnowledgeFromLearning(input: {
    locationId: string;
    title: string;
    content: string;
    category?: string | null;
    key?: string | null;
    proposalId?: string | null;
    approvedByUserId?: string | null;
    metadata?: Record<string, unknown> | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const title = normalizeContent(input.title, 180) || "Location AI guidance";
    const content = normalizeContent(input.content, 8000);
    const category = String(input.category || "ai_learning").trim().slice(0, 80) || "ai_learning";
    const key = slugifyKnowledgeKey(input.key || title);

    return (db as any).locationKnowledgeEntry.upsert({
        where: {
            locationId_key: {
                locationId,
                key,
            },
        },
        create: {
            locationId,
            key,
            title,
            content,
            category,
            source: "learning_proposal",
            proposalId: input.proposalId || null,
            approvedByUserId: input.approvedByUserId || null,
            metadata: input.metadata || undefined,
        },
        update: {
            title,
            content,
            category,
            source: "learning_proposal",
            proposalId: input.proposalId || null,
            approvedByUserId: input.approvedByUserId || null,
            archivedAt: null,
            metadata: input.metadata || undefined,
        },
    });
}

export async function listActiveLocationKnowledge(input: {
    locationId: string;
    category?: string | null;
    limit?: number;
}) {
    const locationId = String(input.locationId || "").trim();
    if (!locationId) return [];

    const category = String(input.category || "").trim();
    const rows = await (db as any).locationKnowledgeEntry.findMany({
        where: {
            locationId,
            archivedAt: null,
            ...(category ? { category } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: Math.max(1, Math.min(20, Number(input.limit || 8))),
        select: {
            id: true,
            key: true,
            title: true,
            content: true,
            category: true,
            updatedAt: true,
        },
    });

    return rows.map((row: any) => ({
        id: String(row.id),
        key: String(row.key || ""),
        title: String(row.title || ""),
        content: String(row.content || ""),
        category: String(row.category || ""),
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    }));
}

export function formatLocationKnowledgeForPrompt(rows: Array<{ title: string; content: string; category?: string }>) {
    const lines = rows
        .map((row) => {
            const title = normalizeContent(row.title, 120);
            const content = normalizeContent(row.content, 700);
            if (!content) return null;
            return `- ${title || "Location guidance"}: ${content}`;
        })
        .filter(Boolean);
    return lines.length ? lines.join("\n") : "";
}

export function normalizeLearningProposalPayload(value: unknown) {
    const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
        proposedContent: normalizeContent(payload.proposedContent ?? payload.content, 8000),
        title: normalizeContent(payload.title, 180),
        category: normalizeContent(payload.category, 80),
        key: normalizeContent(payload.key, 100),
    };
}

export function mapLearningProposal(row: any) {
    return {
        id: row.id,
        createdAt: row.createdAt?.toISOString?.() || null,
        updatedAt: row.updatedAt?.toISOString?.() || null,
        locationId: row.locationId,
        sessionId: row.sessionId || null,
        type: row.type,
        title: row.title,
        description: row.description,
        target: row.target || null,
        payload: row.payload || null,
        status: row.status,
        riskLevel: row.riskLevel,
        confidence: row.confidence ?? null,
        appliedAt: row.appliedAt?.toISOString?.() || null,
        dismissedAt: row.dismissedAt?.toISOString?.() || null,
    };
}

export async function submitManualAgentLearningProposal(input: {
    locationId: string;
    actorUserId?: string | null;
    actorClerkUserId?: string | null;
    skillId?: string | null;
    type?: "style_policy" | "location_knowledge" | string | null;
    title?: string | null;
    description?: string | null;
    proposedContent?: string | null;
    category?: string | null;
    key?: string | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const type = normalizeLearningTargetKind(input.type);
    const skillId = normalizeSkillId(input.skillId);
    const proposedContent = String(input.proposedContent || "").trim();
    if (!locationId) return { success: false as const, error: "Missing location ID." };
    if (proposedContent.length < 8) {
        return { success: false as const, error: "Add the prompt or knowledge change before submitting." };
    }
    if (proposedContent.length > 8000) {
        return { success: false as const, error: "Learning content must be 8,000 characters or less." };
    }

    const fallbackTitle = type === "location_knowledge"
        ? "Location knowledge update"
        : `Prompt guidance for ${skillId}`;
    const title = normalizeContent(input.title || fallbackTitle, 180) || fallbackTitle;
    const description = normalizeContent(input.description || "Manual teaching submission pending admin approval.", 2000);

    const session = await (db as any).learningSession.create({
        data: {
            locationId,
            sourceFeature: "manual_teaching",
            inputType: "manual",
            status: "pending",
            summary: title,
            analysis: {
                submittedByUserId: input.actorUserId || null,
                submittedByClerkUserId: input.actorClerkUserId || null,
                type,
                skillId,
            },
            proposalsCount: 1,
        },
        select: { id: true },
    });

    const proposal = await (db as any).learningProposal.create({
        data: {
            locationId,
            sessionId: session.id,
            type,
            title,
            description,
            target: {
                locationId,
                skillId,
                targetKind: type,
            },
            payload: {
                proposedContent,
                title,
                category: String(input.category || "ai_learning").trim() || "ai_learning",
                key: String(input.key || "").trim() || undefined,
                submittedByUserId: input.actorUserId || null,
                submittedByClerkUserId: input.actorClerkUserId || null,
                applyMode: "human_approval_required",
            },
            riskLevel: "medium",
            confidence: 0.5,
        },
    });

    return { success: true as const, sessionId: session.id, proposal: mapLearningProposal(proposal) };
}

export async function listLearningProposals(input: {
    locationId: string;
    status?: string | null;
    limit?: number;
}) {
    const locationId = String(input.locationId || "").trim();
    if (!locationId) return [];

    const status = String(input.status || "").trim();
    const rows = await (db as any).learningProposal.findMany({
        where: {
            locationId,
            ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Math.max(1, Math.min(100, Number(input.limit || 40))),
    });

    return rows.map(mapLearningProposal);
}

export async function listLocationAiPromptVersions(input: {
    locationId: string;
    skillId?: string | null;
    targetKind?: string | null;
    limit?: number;
}) {
    const locationId = String(input.locationId || "").trim();
    if (!locationId) return [];

    const skillId = String(input.skillId || "").trim();
    const targetKind = normalizeLearningTargetKind(input.targetKind);
    const rows = await (db as any).locationAiPromptVersion.findMany({
        where: {
            locationId,
            ...(skillId ? { skillId } : {}),
            targetKind,
        },
        orderBy: [{ isCurrent: "desc" }, { createdAt: "desc" }],
        take: Math.max(1, Math.min(100, Number(input.limit || 40))),
    });

    return rows.map((row: any) => ({
        id: row.id,
        createdAt: row.createdAt?.toISOString?.() || null,
        locationId: row.locationId,
        skillId: row.skillId,
        targetKind: row.targetKind,
        content: row.content,
        isDefault: Boolean(row.isDefault),
        isCurrent: Boolean(row.isCurrent),
        source: row.source,
        proposalId: row.proposalId || null,
        previousVersionId: row.previousVersionId || null,
        revertedFromVersionId: row.revertedFromVersionId || null,
    }));
}

async function applyStylePolicyLearningProposal(args: {
    locationId: string;
    proposal: any;
    actorUserId: string | null;
}) {
    const target = args.proposal.target && typeof args.proposal.target === "object"
        ? args.proposal.target as Record<string, unknown>
        : {};
    const skillId = normalizeSkillId(target.skillId);
    const payload = normalizeLearningProposalPayload(args.proposal.payload);
    if (!payload.proposedContent) {
        return { success: false as const, error: "Proposal is missing prompt content." };
    }

    const existing = await db.aiSkillPolicy.findUnique({
        where: {
            locationId_skillId: {
                locationId: args.locationId,
                skillId,
            },
        },
    });

    const parsed = AiSkillPolicySchema.parse({
        locationId: args.locationId,
        skillId,
        enabled: existing?.enabled ?? true,
        objective: existing?.objective || "nurture",
        channelPolicy: existing?.channelPolicy || {},
        contactSegments: existing?.contactSegments || {},
        decisionPolicy: existing?.decisionPolicy || {},
        compliancePolicy: existing?.compliancePolicy || {},
        stylePolicy: existing?.stylePolicy || {},
        researchPolicy: existing?.researchPolicy || {},
        humanApprovalRequired: existing?.humanApprovalRequired ?? true,
        version: existing?.version || 1,
        metadata: existing?.metadata || {},
    });

    await ensureLocationAiPromptVersion({
        locationId: args.locationId,
        skillId,
        targetKind: "style_policy",
        currentContent: parsed.stylePolicy.customInstructions,
    });

    const stylePolicy = {
        ...parsed.stylePolicy,
        customInstructions: payload.proposedContent.slice(0, 4000),
    };

    await db.aiSkillPolicy.upsert({
        where: {
            locationId_skillId: {
                locationId: args.locationId,
                skillId,
            },
        },
        create: {
            locationId: args.locationId,
            skillId,
            enabled: parsed.enabled,
            objective: parsed.objective,
            channelPolicy: parsed.channelPolicy as any,
            contactSegments: parsed.contactSegments as any,
            decisionPolicy: parsed.decisionPolicy as any,
            compliancePolicy: parsed.compliancePolicy as any,
            stylePolicy: stylePolicy as any,
            researchPolicy: parsed.researchPolicy as any,
            humanApprovalRequired: parsed.humanApprovalRequired,
            version: 1,
            metadata: {
                ...(parsed.metadata || {}),
                lastLearningProposalId: args.proposal.id,
            } as any,
        },
        update: {
            stylePolicy: stylePolicy as any,
            version: { increment: 1 },
            metadata: {
                ...(parsed.metadata || {}),
                lastLearningProposalId: args.proposal.id,
            } as any,
        },
    });

    await createCurrentPromptVersion({
        locationId: args.locationId,
        skillId,
        targetKind: "style_policy",
        content: payload.proposedContent,
        proposalId: args.proposal.id,
        approvedByUserId: args.actorUserId,
        source: "learning_proposal",
        metadata: {
            proposalTitle: args.proposal.title,
        },
    });

    return { success: true as const, skillId };
}

async function applyLocationKnowledgeLearningProposal(args: {
    locationId: string;
    proposal: any;
    actorUserId: string | null;
}) {
    const payload = normalizeLearningProposalPayload(args.proposal.payload);
    if (!payload.proposedContent) {
        return { success: false as const, error: "Proposal is missing knowledge content." };
    }

    const entry = await upsertLocationKnowledgeFromLearning({
        locationId: args.locationId,
        title: payload.title || args.proposal.title,
        content: payload.proposedContent,
        category: payload.category || "ai_learning",
        key: payload.key || args.proposal.title,
        proposalId: args.proposal.id,
        approvedByUserId: args.actorUserId,
        metadata: {
            proposalTitle: args.proposal.title,
        },
    });

    return { success: true as const, knowledgeEntryId: entry.id };
}

export async function approveLearningProposal(input: {
    locationId: string;
    proposalId: string;
    actorUserId?: string | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const proposalId = String(input.proposalId || "").trim();
    const proposal = await (db as any).learningProposal.findFirst({
        where: { id: proposalId, locationId },
    });
    if (!proposal) return { success: false as const, error: "Learning proposal not found." };
    if (proposal.status !== "pending") {
        return { success: false as const, error: "Only pending proposals can be approved." };
    }

    const applied = proposal.type === "location_knowledge"
        ? await applyLocationKnowledgeLearningProposal({ locationId, proposal, actorUserId: input.actorUserId || null })
        : await applyStylePolicyLearningProposal({ locationId, proposal, actorUserId: input.actorUserId || null });
    if (!applied.success) return applied;

    await (db as any).learningProposal.update({
        where: { id: proposal.id },
        data: {
            status: "approved",
            appliedAt: new Date(),
        },
    });
    if (proposal.sessionId) {
        await (db as any).learningSession.update({
            where: { id: proposal.sessionId },
            data: {
                status: "applied",
                appliedCount: { increment: 1 },
            },
        });
    }

    return { success: true as const, ...applied };
}

export async function dismissLearningProposal(input: {
    locationId: string;
    proposalId: string;
}) {
    const locationId = String(input.locationId || "").trim();
    const proposalId = String(input.proposalId || "").trim();
    const proposal = await (db as any).learningProposal.findFirst({
        where: { id: proposalId, locationId },
        select: { id: true, sessionId: true, status: true },
    });
    if (!proposal) return { success: false as const, error: "Learning proposal not found." };
    if (proposal.status !== "pending") {
        return { success: false as const, error: "Only pending proposals can be dismissed." };
    }

    await (db as any).learningProposal.update({
        where: { id: proposal.id },
        data: {
            status: "dismissed",
            dismissedAt: new Date(),
        },
    });
    if (proposal.sessionId) {
        await (db as any).learningSession.update({
            where: { id: proposal.sessionId },
            data: { status: "dismissed" },
        });
    }

    return { success: true as const };
}

export async function revertLocationAiPrompt(input: {
    locationId: string;
    skillId: string;
    actorUserId?: string | null;
    versionId?: string | null;
}) {
    const locationId = String(input.locationId || "").trim();
    const skillId = String(input.skillId || "").trim();
    if (!skillId) return { success: false as const, error: "Missing skill ID." };

    const existing = await db.aiSkillPolicy.findUnique({
        where: {
            locationId_skillId: {
                locationId,
                skillId,
            },
        },
    });
    await ensureLocationAiPromptVersion({
        locationId,
        skillId,
        targetKind: "style_policy",
        currentContent: (existing?.stylePolicy as any)?.customInstructions || "",
    });

    const revertVersion = await getPromptVersionForRevert({
        locationId,
        skillId,
        targetKind: "style_policy",
        versionId: input.versionId || null,
    });
    if (!revertVersion) return { success: false as const, error: "No default prompt version found." };

    const parsed = AiSkillPolicySchema.parse({
        locationId,
        skillId,
        enabled: existing?.enabled ?? true,
        objective: existing?.objective || "nurture",
        channelPolicy: existing?.channelPolicy || {},
        contactSegments: existing?.contactSegments || {},
        decisionPolicy: existing?.decisionPolicy || {},
        compliancePolicy: existing?.compliancePolicy || {},
        stylePolicy: existing?.stylePolicy || {},
        researchPolicy: existing?.researchPolicy || {},
        humanApprovalRequired: existing?.humanApprovalRequired ?? true,
        version: existing?.version || 1,
        metadata: existing?.metadata || {},
    });
    const stylePolicy = {
        ...parsed.stylePolicy,
        customInstructions: String(revertVersion.content || "").slice(0, 4000),
    };

    await db.aiSkillPolicy.upsert({
        where: {
            locationId_skillId: {
                locationId,
                skillId,
            },
        },
        create: {
            locationId,
            skillId,
            enabled: parsed.enabled,
            objective: parsed.objective,
            channelPolicy: parsed.channelPolicy as any,
            contactSegments: parsed.contactSegments as any,
            decisionPolicy: parsed.decisionPolicy as any,
            compliancePolicy: parsed.compliancePolicy as any,
            stylePolicy: stylePolicy as any,
            researchPolicy: parsed.researchPolicy as any,
            humanApprovalRequired: parsed.humanApprovalRequired,
            version: 1,
            metadata: parsed.metadata as any,
        },
        update: {
            stylePolicy: stylePolicy as any,
            version: { increment: 1 },
        },
    });

    const version = await createCurrentPromptVersion({
        locationId,
        skillId,
        targetKind: "style_policy",
        content: revertVersion.content || "",
        approvedByUserId: input.actorUserId || null,
        source: "revert",
        revertedFromVersionId: revertVersion.id,
    });

    return { success: true as const, versionId: version.id, content: version.content };
}
