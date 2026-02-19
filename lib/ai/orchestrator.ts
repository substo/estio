import db from "@/lib/db";
import { classifyIntent } from "./classifier";
import { analyzeSentiment } from "./sentiment";
import { startTrace, startSpan, endSpan, endTrace } from "./tracing";
import { validateAction } from "./policy";
import { SkillLoader, executeSkill } from "./skills/loader";
import { retrieveContext } from "./memory";
import { reflectOnDraft } from "./reflexion";

interface OrchestratorInput {
    conversationId: string;
    contactId: string;
    message: string;
    conversationHistory: string;
    dealStage?: string;
}

export interface OrchestratorResult {
    traceId: string;
    intent: string;
    sentiment: any;
    skillUsed: string | null;
    actions: any[];
    draftReply: string | null;
    requiresHumanApproval: boolean;
    reasoning: string;
    policyResult?: any;
}

/**
 * Main orchestration function.
 * This replaces the current runAgent() as the primary entry point.
 */
export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
    const trace = await startTrace(input.conversationId, "orchestrator");

    // ── STEP 1: Classify Intent ──
    const classifySpan = await startSpan(trace, "Classify Intent", "thought");
    const classification = await classifyIntent(input.message, input.conversationHistory);
    await endSpan(classifySpan.spanId, classifySpan.startTime, "success", {
        output: `Intent: ${classification.intent} (Risk: ${classification.risk})`
    });

    // ── STEP 2: Analyze Sentiment ──
    const sentimentSpan = await startSpan(trace, "Analyze Sentiment", "thought");
    const sentiment = await analyzeSentiment(input.message);
    await endSpan(sentimentSpan.spanId, sentimentSpan.startTime, "success", {
        output: `Sentiment: ${sentiment.emotion}, Readiness: ${sentiment.buyerReadiness}`
    });

    // ── STEP 3: Retrieve Relevant Memory ──
    const memories = await retrieveContext(input.contactId, input.message, 5);

    // ── STEP 4: Route to Skill ──
    let skillResult: any = null;

    console.log(`[ORCHESTRATOR] Classification: intent=${classification.intent}, skill=${classification.suggestedSkill}, risk=${classification.risk}`);

    if (classification.suggestedSkill) {
        const skillSpan = await startSpan(trace, `Execute Skill: ${classification.suggestedSkill}`, "tool");
        const skill = SkillLoader.loadSkill(classification.suggestedSkill);
        console.log(`[ORCHESTRATOR] Skill loaded: ${skill ? skill.name : 'NULL - SKILL NOT FOUND'}`);
        if (skill) console.log(`[ORCHESTRATOR] Skill tools: ${skill.tools?.join(', ') || 'none'}`);

        if (skill) {
            // Fetch contact + location + siteConfig (reusing existing query, extended)
            const contactData = await db.contact.findFirst({
                where: {
                    OR: [{ id: input.contactId }, { ghlContactId: input.contactId }]
                },
                include: { location: { include: { siteConfig: true } } }
            });

            // Fetch the agent identity.
            // Use assigned agent first; if missing, fall back to first user on the location.
            let agentName = "Agent";
            let agentUserId = contactData?.leadAssignedToAgent ?? undefined;
            let agent: { id: string; firstName: string | null; lastName: string | null; name: string | null } | null = null;

            if (agentUserId) {
                agent = await db.user.findUnique({
                    where: { id: agentUserId },
                    select: { id: true, firstName: true, lastName: true, name: true }
                });
            }

            if (!agent && contactData?.locationId) {
                agent = await db.user.findFirst({
                    where: {
                        locations: {
                            some: { id: contactData.locationId }
                        }
                    },
                    orderBy: { createdAt: "asc" },
                    select: { id: true, firstName: true, lastName: true, name: true }
                });
            }

            if (agent) {
                agentUserId = agent.id;
                agentName = agent.firstName
                    ? `${agent.firstName}${agent.lastName ? ' ' + agent.lastName : ''}`
                    : agent.name || "Agent";
            }

            skillResult = await executeSkill(skill, {
                ...input,
                locationId: contactData?.locationId,
                intent: classification.intent,
                sentiment,
                memories,
                apiKey: contactData?.location?.siteConfig?.googleAiApiKey ?? undefined,
                agentName,
                businessName: contactData?.location?.name ?? undefined,
                websiteDomain: contactData?.location?.siteConfig?.domain ?? contactData?.location?.domain ?? undefined,
                brandVoice: contactData?.location?.siteConfig?.brandVoice ?? undefined,
                agentUserId,
            });

            console.log(`[ORCHESTRATOR] Skill result:`, JSON.stringify({
                modelUsed: skillResult?.modelUsed,
                thoughtSummary: skillResult?.thoughtSummary?.substring(0, 100),
                draftReply: skillResult?.draftReply?.substring(0, 200) || 'NULL/EMPTY',
                toolCalls: skillResult?.toolCalls?.length || 0,
                error: skillResult?.error || 'none',
                cost: skillResult?.cost,
                promptTokens: skillResult?.promptTokens,
                completionTokens: skillResult?.completionTokens
            }));

            await endSpan(skillSpan.spanId, skillSpan.startTime, skillResult.error ? "error" : "success", {
                output: skillResult.draftReply,
                // errorMessage: skillResult.error, // Need to update endSpan signature or metadata usage
                // For now passing as generic metadata
                // Note: existing endSpan signature: (spanId, startTime, status, metadata)
                // metadata is { output?, errorMessage? }
            });
        } else {
            await endSpan(skillSpan.spanId, skillSpan.startTime, "error", { errorMessage: "Skill not found" });
        }
    }

    // ── STEP 5: Policy Check ──
    const policySpan = await startSpan(trace, "Policy Check", "planning");
    const policyResult = await validateAction({
        intent: classification.intent,
        risk: classification.risk,
        actions: skillResult?.toolCalls ?? [],
        draftReply: skillResult?.draftReply ?? null,
        dealStage: input.dealStage,
    });

    await endSpan(policySpan.spanId, policySpan.startTime, policyResult.approved ? "success" : "error", {
        output: policyResult.reason
    });

    // ── STEP 6: Reflexion (for high-risk only) ──
    if (classification.risk === "high" && skillResult?.draftReply) {
        const reflexionSpan = await startSpan(trace, "Reflexion (Critic)", "thought");
        skillResult.draftReply = await reflectOnDraft(
            skillResult.draftReply,
            input.conversationHistory,
            classification.intent
        );
        await endSpan(reflexionSpan.spanId, reflexionSpan.startTime, "success", {
            output: "Draft refined by critic"
        });
    }

    // End Root Trace
    const finalDraft = skillResult?.draftReply || null;
    console.log(`[ORCHESTRATOR] Final draft being saved to trace: ${finalDraft ? finalDraft.substring(0, 200) : 'NULL'}`);
    console.log(`[ORCHESTRATOR] skillResult exists: ${!!skillResult}, skillResult.draftReply type: ${typeof skillResult?.draftReply}, value: ${JSON.stringify(skillResult?.draftReply)?.substring(0, 200)}`);

    const promptTokens = skillResult?.promptTokens ?? 0;
    const completionTokens = skillResult?.completionTokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const traceThoughtSteps = Array.isArray(skillResult?.thoughtSteps) ? [...skillResult.thoughtSteps] : [];
    if (skillResult?.llmCall) {
        traceThoughtSteps.push({
            step: traceThoughtSteps.length + 1,
            description: "LLM call debug payload",
            details: skillResult.llmCall
        });
    }

    // Persist root trace with usage/model/thought details so UI shows accurate data.
    await endTrace(
        trace.traceId,
        skillResult?.error ? "error" : "success",
        finalDraft,
        skillResult?.toolCalls || [],
        skillResult?.cost || 0,
        {
            prompt: promptTokens,
            completion: completionTokens,
            total: totalTokens
        },
        {
            model: skillResult?.modelUsed,
            thoughtSummary: skillResult?.thoughtSummary ?? `Intent: ${classification.intent}`,
            thoughtSteps: traceThoughtSteps.length > 0 ? traceThoughtSteps : undefined
        }
    );

    return {
        traceId: trace.traceId,
        intent: classification.intent,
        sentiment,
        skillUsed: classification.suggestedSkill,
        actions: skillResult?.toolCalls ?? [],
        draftReply: skillResult?.draftReply ?? null,
        requiresHumanApproval: classification.risk === "high" || !policyResult.approved,
        reasoning: skillResult?.thoughtSummary ?? "No specialist skill needed.",
        policyResult
    };
}
