import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import * as tools from "./tools";
import { SkillLoader } from "./skills/loader";
import * as skillTools from "./skills/tools";
import { DEFAULT_MODEL } from "@/lib/ai/pricing";

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
export async function generateAgentPlan(contactId: string, locationId: string, history: string, goal: string): Promise<{ success: boolean, plan?: AgentTask[], thought?: string }> {
    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const apiKey = siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("No AI API Key");

        // Prepare Model
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: DEFAULT_MODEL,
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
            thought: parsed.thought
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
        const modelName = "gemini-2.5-pro";
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

        const context = `
        CURRENT TASK: ${currentTask.title}
        FULL PLAN: ${JSON.stringify(allTasks.map(t => t.title))}
        
        CONTACT CONTEXT:
Name: ${contact?.name}
Budget: ${contact?.requirementMaxPrice}
District: ${contact?.requirementDistrict}
Bedrooms: ${contact?.requirementBedrooms}

HISTORY:
        ${history}
`;

        const result = await model.generateContent([
            SYSTEM_PROMPT,
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

                        // --- Domain Tools (Still accessible, but usually gated by instructions) ---
                        case "update_requirements":
                            res = await tools.updateContactRequirements(contactId, locationId, args);
                            break;
                        case "search_properties":
                            res = await tools.searchProperties(locationId, args);
                            break;
                        case "create_viewing":
                            res = await tools.createViewing(contactId, args.propertyId, args.date, args.notes);
                            break;
                        case "log_activity":
                            res = await tools.appendLog(contactId, args.message);
                            break;
                        case "draft_reply":
                            break;
                        default:
                            console.warn(`Unknown tool: ${call.name} `);
                            res = { success: false, message: "Unknown tool" };
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

            // Prepare Model
            const model = this.genAI.getGenerativeModel({
                model: DEFAULT_MODEL,
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
export async function runAgent(contactId: string, locationId: string, history: string) {
    try {
        // 1. Generate Plan
        // Default goal for generic runs
        const goal = "Determine the most appropriate next step for this lead and execute it to move the deal forward.";
        const planRes = await generateAgentPlan(contactId, locationId, history, goal);

        if (!planRes.success || !planRes.plan) {
            return { success: false, message: "Planning failed", thought: planRes.thought };
        }

        // 2. Find Next Task
        const nextTask = planRes.plan.find(t => t.status === 'pending');
        if (!nextTask) {
            return { success: true, message: "No pending tasks derived from analysis.", plan: planRes.plan };
        }

        // 3. Execute Task
        console.log(`[runAgent] Executing Task: ${nextTask.title}`);
        const execRes = await executeAgentTask(contactId, locationId, history, nextTask, planRes.plan);

        return {
            success: true,
            plan: planRes.plan,
            currentTask: nextTask,
            execution: execRes
        };

    } catch (e) {
        console.error("runAgent Orchestration Failed", e);
        return { success: false, message: "Agent orchestration failed." };
    }
}
