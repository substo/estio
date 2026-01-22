import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import * as tools from "./tools";
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

const EXECUTOR_SYSTEM_PROMPT = `
You are the Estio Real Estate Executor. You are executing a specific task from a larger plan.

## Your Task
- **Task**: The specific item you are working on right now.
- **Goal**: The ultimate goal of the entire plan.
- **History**: Full conversation history.

## Tools
You have tools to perform actions. Invoke them via "tool_calls".
- **update_requirements**: Set fields.
- **search_properties**: Search listings.
- **create_viewing**: Schedule physical viewing.
- **log_activity**: Add structured note.
- **draft_reply**: IMPORTANT: Generate the actual reply text to the user here.

## Output
Response must be valid JSON with structured reasoning:
{
  "thought_summary": "One-line summary of your reasoning (shown by default)",
  "thought_steps": [
    { "step": 1, "description": "What you analyzed or decided", "conclusion": "The outcome or finding" },
    { "step": 2, "description": "Next analysis step", "conclusion": "What you found" }
  ],
  "tool_calls": [...],
  "task_completed": boolean, // Set to true ONLY if you have fully achieved the current task.
  "task_result": "Summary of what was done (e.g. 'Budget confirmed as 500k')",
  "final_response": "The draft text to send to the lead."
}

IMPORTANT: Always include both thought_summary (brief) and thought_steps (detailed array) so users can view your full reasoning process on demand.
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

HISTORY:
        ${history}
`;

        const result = await model.generateContent([
            EXECUTOR_SYSTEM_PROMPT,
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
                    switch (call.name) {
                        case "update_requirements":
                            res = await tools.updateContactRequirements(contactId, locationId, call.arguments);
                            break;
                        case "search_properties":
                            res = await tools.searchProperties(locationId, call.arguments);
                            break;
                        case "create_viewing":
                            res = await tools.createViewing(contactId, call.arguments.propertyId, call.arguments.date, call.arguments.notes);
                            break;
                        case "log_activity":
                            res = await tools.appendLog(contactId, call.arguments.message);
                            break;
                        case "draft_reply":
                            // Handled via final_response, but if tool called, ok.
                            break;
                        default:
                            console.warn(`Unknown tool: ${call.name} `);
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
