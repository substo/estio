import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import * as tools from "./tools";
import { SkillLoader } from "./skills/loader";
import * as skillTools from "./skills/tools";
import { calculateRunCost } from "@/lib/ai/pricing";
import { getModelForTask } from "./model-router";
import { toolRegistry } from "./mcp/registry";
import "./mcp/server"; // Import for side effects (tool registration)
import { startTrace, endTrace, startSpan, endSpan } from "./tracing";
import { retrieveContext } from "./memory";
import { shouldUsePTC } from "./ptc/config";
import { getPtcSystemPrompt } from "./prompts/ptc-instructions";

const PLANNER_SYSTEM_PROMPT = `
You are the Estio Real Estate Planner. Your job is to break down a high-level "Ultimate Goal" into a concrete, sequential checklist of tasks.

## Input
- **Ultimate Goal**: What needs to be achieved (e.g., "Qualify the lead and book a viewing").
- **Analysis**: Your detailed analysis of the conversation history and contact state.

## Output
Produce a JSON object containing a "plan" array. Each item must have:
- "id": unique string "1", "2", etc.
- "title": Actionable task name (e.g., "Confirm Budget", "Send Listing #123", "Ask for Availability").
- "status": "pending" (always pending initially).

## Guidelines
- Be granular but efficient.
- Don't create too many steps (3-5 is usually best).
- Ordering matters. Logical flow: Qualify -> Propose -> Schedule -> Close.

## Example Output
{
  "thought": "User wants to book a viewing. Need to qualify budget first.",
  "plan": [
    { "id": "1", "title": "Ask about Budget Range", "status": "pending" },
    { "id": "2", "title": "Check Availability for Next Tuesday", "status": "pending" }
  ]
}
`;

const getExecutorSystemPrompt = (skillsRegistry: { name: string, description: string }[]) => `
You are the Estio Real Estate Executor. You have a vast library of "Skills" that you can load on-demand.

## Your Task
- **Task**: The specific item you are working on right now.
- **Goal**: The ultimate goal of the entire plan.
- **History**: Full conversation history.

## Skill System (Progressive Disclosure)
You do NOT have all instructions loaded by default. You must "install" skills to get their tools and workflows.

**Available Skills:**
${skillsRegistry.map(s => `- **${s.name}**: ${s.description}`).join('\n')}

**How to use:**
1.  Analyze the user's request.
2.  If it matches a Skill Description, call \`load_skill(name)\`.
3.  Read the instructions that are returned.
4.  Execute the specific tools defined in that skill.

## Global Tools
- \`load_skill(name)\`: Loads instructions for a skill.
- \`read_resource(skill, path)\`: Reads reference files if the skill asks you to.
- \`log_activity(message)\`: Always available to log notes.
- \`draft_reply\`: Generate the text response.

## Output
Response must be valid JSON with structured reasoning:
{
  "thought_summary": "One-line summary",
  "thought_steps": [
    { "step": 1, "description": "Analysis", "conclusion": "Outcome" }
  ],
  "tool_calls": [...],
  "task_completed": boolean,
  "task_result": "Result summary",
  "final_response": "Draft text"
}
`;


export interface AgentTask {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done' | 'failed';
    result?: string;
}

// --- Planner Function ---
export async function generateAgentPlan(contactId: string, locationId: string, history: string, goal: string): Promise<{ success: boolean, plan?: AgentTask[], thought?: string, usage?: any }> {
    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const apiKey = siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("No AI API Key");

        // Prepare Model
        const genAI = new GoogleGenerativeAI(apiKey);
        // ROUTER INTEGRATION: Select optimal model for planning
        const modelId = getModelForTask("complex_planning");
        const model = genAI.getGenerativeModel({
            model: modelId,
            generationConfig: { responseMimeType: "application/json" }
        });

        const context = `
GOAL: ${goal}
HISTORY: ${history}
`;

        const result = await model.generateContent([PLANNER_SYSTEM_PROMPT, context]);
        const parsed = JSON.parse(result.response.text());

        return {
            success: true,
            plan: parsed.plan,
            thought: parsed.thought,
            usage: {
                ...result.response.usageMetadata,
                model: modelId
            }
        };
    } catch (e) {
        console.error("Plan Generation Failed", e);
        return { success: false };
    }
}

// --- Executor Function ---
export async function executeAgentTask(contactId: string, locationId: string, history: string, currentTask: AgentTask, allTasks: AgentTask[]) {
    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const apiKey = siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("No AI API Key");

        const genAI = new GoogleGenerativeAI(apiKey);
        // ROUTER INTEGRATION: Select optimal model for execution/drafting
        const modelName = getModelForTask("draft_reply");
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 1. Get Registry for System Prompt
        const registry = SkillLoader.getRegistry();
        const SYSTEM_PROMPT = getExecutorSystemPrompt(registry);

        // Fetch Contact for Context
        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: { propertyRoles: { include: { property: true } } }
        });

        // SEMANTIC MEMORY INTEGRATION: Retrieve relevant insights
        const insights = await retrieveContext(contactId, currentTask.title, 5);
        const memoryContext = insights.length > 0
            ? `\nMEMORY (past insights about this client):\n${insights.map(i => `- [${i.category}] ${i.text}`).join('\n')}`
            : "";

        const context = `
        CURRENT TASK: ${currentTask.title}
        FULL PLAN: ${JSON.stringify(allTasks.map(t => t.title))}
        
        CONTACT CONTEXT:
Name: ${contact?.name}
Budget: ${contact?.requirementMaxPrice}
District: ${contact?.requirementDistrict}
Bedrooms: ${contact?.requirementBedrooms}

${memoryContext}

HISTORY:
        ${history}
`;

        // PTC INTEGRATION: Conditionally append coding instructions
        let finalSystemPrompt = SYSTEM_PROMPT;
        if (shouldUsePTC(currentTask.title)) {
            finalSystemPrompt += "\n\n" + getPtcSystemPrompt();
        }

        const result = await model.generateContent([
            finalSystemPrompt,
            context
        ]);

        const responseText = result.response.text();
        console.log("Executor Response:", responseText);

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (e) {
            return { success: false, message: "Agent failed to think." };
        }

        // Execute Tools
        const actions = [];
        if (parsed.tool_calls) {
            for (const call of parsed.tool_calls) {
                console.log(`Executing tool: ${call.name} `);
                try {
                    let res;
                    const args = call.arguments;

                    // MCP DISPATCH: Check if tool is in registry
                    const registeredTool = toolRegistry.find(t => t.name === call.name);

                    if (registeredTool) {
                        const mcpResult = await registeredTool.handler(args);
                        // MCP returns { content: [{ type: 'text', text: '...' }] } usually
                        // We try to unwrap JSON text if possible, or return raw
                        res = mcpResult?.content?.[0]?.text
                            ? (() => { try { return JSON.parse(mcpResult.content[0].text) } catch { return mcpResult.content[0].text } })()
                            : mcpResult;

                        // Special handling for store_insight (memory) and log_activity to ensure sync returns
                    } else {
                        // Fallback for meta-tools (Skill Loader internals)
                        switch (call.name) {
                            // --- Meta Tools ---
                            case "load_skill":
                                res = await skillTools.loadSkillTool(args.skillName || args.name);
                                break;
                            case "read_resource":
                                res = await skillTools.readResourceTool(args.skillName, args.filePath);
                                break;
                            case "list_resources":
                                res = await skillTools.listResourcesTool(args.skillName);
                                break;

                            // Legacy Direct Calls (should vary rarely be hit now that registry covers them)
                            case "draft_reply":
                                break;
                            default:
                                console.warn(`Unknown tool: ${call.name} `);
                                res = { success: false, message: "Unknown tool" };
                        }
                    }
                    actions.push({ tool: call.name, result: res });
                } catch (err) {
                    console.error(`Tool execution failed for ${call.name}`, err);
                    actions.push({ tool: call.name, error: "Failed" });
                }
            }
        }

        return {
            success: true,
            thoughtSummary: parsed.thought_summary || parsed.thought || "",
            thoughtSteps: parsed.thought_steps || [],
            actions: actions,
            draft: parsed.final_response,
            taskCompleted: parsed.task_completed,
            taskResult: parsed.task_result,
            usage: {
                ...result.response.usageMetadata,
                model: modelName
            }
        };

    } catch (e) {
        console.error("Agent Execution Failed", e);
        return { success: false, message: "Agent execution failed." };
    }
}


export class DealAgent {
    private genAI: GoogleGenerativeAI;
    private dealId: string;
    private locationId: string;

    constructor(apiKey: string, dealId: string, locationId: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.dealId = dealId;
        this.locationId = locationId;
    }

    async run(message: string, history: any[]) {
        try {
            console.log(`[DealAgent] Running for deal ${this.dealId}`);

            // Fetch Deal Context
            const deal = await db.dealContext.findUnique({
                where: { id: this.dealId },
                include: { location: true }
            });

            if (!deal) throw new Error("Deal not found");

            // ROUTER INTEGRATION
            const modelId = getModelForTask("deal_coordinator");
            const model = this.genAI.getGenerativeModel({
                model: modelId,
                generationConfig: { responseMimeType: "application/json" }
            });

            // Format History
            const historyStr = history.map(h => `${h.role}: ${h.content} `).join("\n");

            // Deal Agent Prompt (Variant)
            const SYSTEM_PROMPT = `
            You are the Estio Deal Coordinator.You are managing a real estate deal.

    DEAL: ${deal.title}
STAGE: ${deal.stage}
            
            Your goal is to coordinate between agents, buyers, and sellers.

    OUTPUT: JSON with 'thought' and 'final_response'(draft reply) and optionally 'tool_calls'(same tools available).
            `;

            const result = await model.generateContent([
                SYSTEM_PROMPT,
                `History: \n${historyStr} \n\nNew Message: ${message} `
            ]);

            const responseText = result.response.text();
            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch (e) {
                return { success: false, message: "Failed to parse AI response." };
            }

            // We could execute tools here similar to runAgent
            // For now, let's just return the draft

            return {
                success: true,
                ...parsed
            };

        } catch (e) {
            console.error("[DealAgent] Run Failed", e);
            return { success: false, message: "Deal Agent crashed." };
        }
    }
}

// --- Orchestrator Function (Restored) ---

/**
 * Main Agent Loop
 * @deprecated Use lib/ai/orchestrator.ts instead. Phase 1 Orchestrator replaces this.
 */
export async function runAgent(contactId: string, locationId: string, history: string) {
    // TRACING INTEGRATION: Start Trace
    const conv = await db.conversation.findFirst({
        where: { contactId, locationId },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true }
    });
    const conversationId = conv?.id || "unknown"; // robust fallback
    const trace = await startTrace(conversationId, "runAgent");

    try {
        // 1. Generate Plan
        // Default goal for generic runs
        const goal = "Determine the most appropriate next step for this lead and execute it to move the deal forward.";

        // Trace the planning span? Ideally yes, but keeping it simple for now as part of runAgent trace
        const planRes = await generateAgentPlan(contactId, locationId, history, goal);

        if (!planRes.success || !planRes.plan) {
            await endTrace(trace.traceId, "error", undefined, undefined, undefined, undefined);
            return { success: false, message: "Planning failed", thought: planRes.thought };
        }

        // 2. Find Next Task
        const nextTask = planRes.plan.find(t => t.status === 'pending');
        if (!nextTask) {
            await endTrace(trace.traceId, "success");
            return { success: true, message: "No pending tasks derived from analysis.", plan: planRes.plan };
        }

        // 3. Execute Task
        console.log(`[runAgent] Executing Task: ${nextTask.title}`);
        const execRes = await executeAgentTask(contactId, locationId, history, nextTask, planRes.plan);

        // TRACING INTEGRATION: End Trace with success
        await endTrace(
            trace.traceId,
            "success",
            execRes.draft,
            execRes.actions,
            // Calculate cost for execution part (ignoring planning cost for now or need to sum?)
            calculateRunCost(execRes.usage?.model || "unknown", execRes.usage?.promptTokenCount || 0, execRes.usage?.candidatesTokenCount || 0),
            {
                prompt: execRes.usage?.promptTokenCount || 0,
                completion: execRes.usage?.candidatesTokenCount || 0,
                total: execRes.usage?.totalTokenCount || 0
            }
        );

        return {
            success: true,
            plan: planRes.plan,
            currentTask: nextTask,
            execution: execRes
        };

    } catch (e: any) {
        console.error("runAgent Orchestration Failed", e);
        // TRACING INTEGRATION: End Trace with error
        await endTrace(trace.traceId, "error", undefined, undefined, undefined, undefined);
        return { success: false, message: "Agent orchestration failed." };
    }
}
