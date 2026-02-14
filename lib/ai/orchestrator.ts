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

    if (classification.suggestedSkill) {
        const skillSpan = await startSpan(trace, `Execute Skill: ${classification.suggestedSkill}`, "tool");
        const skill = SkillLoader.loadSkill(classification.suggestedSkill);

        if (skill) {
            skillResult = await executeSkill(skill, {
                ...input,
                intent: classification.intent,
                sentiment,
                memories,
                apiKey: (await db.contact.findUnique({
                    where: { id: input.contactId },
                    include: { location: { include: { siteConfig: true } } }
                }))?.location?.siteConfig?.googleAiApiKey ?? undefined
            });

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
    // Using endTrace signature: (traceId, status, output, toolCalls, cost, tokens)
    await endTrace(
        trace.traceId,
        "success",
        skillResult?.draftReply || null,
        skillResult?.toolCalls || [],
        skillResult?.cost || 0,
        undefined
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
