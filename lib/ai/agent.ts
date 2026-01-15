
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import * as tools from "./tools";

const MANUS_SYSTEM_PROMPT = `
You are the Estio Real Estate Super-Agent, an autonomous AI designed to manage real estate leads with expert precision.

## Core Methodology (Plan -> Act -> Verify)
1. **Analyze**: Deeply understand the user's intent, the conversation history, and the current state of the contact.
2. **Plan**: Formulate a strategy. Is the lead ready to view? Do they need more properties? Are they unresponsive?
3. **Act**: Use your tools to execute the plan. Update requirements, schedule viewings, or draft replies.
4. **Verify**: Ensure the action was successful and meaningful.

## Your Capabilities (Tools)
You have access to the following tools. You invoke them by outputting a JSON object with the key "tool_calls".

- **update_requirements**: Set status, budget, district, fields.
- **search_properties**: Find listings matching criteria.
- **create_viewing**: Schedule a physical viewing.
- **log_activity**: Add a structured note to the CRM log.
- **draft_reply**: Generate a text response for the agent to send.

## Rules
- **Vision ID**: Always ensure the contact's "requirements" fields are up to date so the "Visual ID" (e.g., "Lead Rent Paphos") is accurate.
- **Tone**: Professional, concise, high-end Real Estate Agent.
- **Safety**: Do not hallucinate property details. Only use what you find in search_properties.

## Output Format
Response must be valid JSON:
{
  "thought": "Internal reasoning process...",
  "tool_calls": [
     { "name": "update_requirements", "arguments": { ... } },
     { "name": "log_activity", "arguments": { "message": "Updated budget to..." } }
  ],
  "final_response": "Draft text if applicable, otherwise null"
}
`;

export async function runAgent(contactId: string, locationId: string, history: string, notes: string = "") {
    try {
        // 1. Setup
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const apiKey = siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("No AI API Key");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-pro", // Creating a more capable agent requires Pro
            generationConfig: { responseMimeType: "application/json" }
        });

        // 2. Fetch Context
        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: { propertyRoles: { include: { property: true } } }
        });
        if (!contact) throw new Error("Contact not found");

        const context = `
        CONTACT CONTEXT:
        Name: ${contact.name}
        Phone: ${contact.phone}
        Current Req Status: ${contact.requirementStatus}
        Current District: ${contact.requirementDistrict}
        Current Budget: ${contact.requirementMaxPrice}
        Notes: ${contact.requirementOtherDetails}
        
        CONVERSATION HISTORY:
        ${history}
        
        INPUT NOTES:
        ${notes}
        `;

        // 3. Generate Plan & Actions
        const result = await model.generateContent([
            MANUS_SYSTEM_PROMPT,
            context
        ]);

        const responseText = result.response.text();
        console.log("Agent Response:", responseText);

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (e) {
            console.error("Agent JSON Parse Error", e);
            return { success: false, message: "Agent failed to think." };
        }

        // 4. Execute Tools
        const results = [];
        if (parsed.tool_calls) {
            for (const call of parsed.tool_calls) {
                console.log(`Executing tool: ${call.name}`);
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
                        default:
                            console.warn(`Unknown tool: ${call.name}`);
                    }
                    results.push({ tool: call.name, result: res });
                } catch (err) {
                    console.error(`Tool execution failed for ${call.name}`, err);
                    results.push({ tool: call.name, error: "Failed" });
                }
            }
        }

        // 5. Finalize
        // If "draft_reply" was in output (or just final_response text), return it
        return {
            success: true,
            thought: parsed.thought,
            actions: results,
            draft: parsed.final_response
        };

    } catch (e) {
        console.error("Agent Run Failed", e);
        return { success: false, message: "Agent run failed." };
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
                model: "gemini-2.5-pro",
                generationConfig: { responseMimeType: "application/json" }
            });

            // Format History
            const historyStr = history.map(h => `${h.role}: ${h.content}`).join("\n");

            // Deal Agent Prompt (Variant)
            const SYSTEM_PROMPT = `
            You are the Estio Deal Coordinator. You are managing a real estate deal.
            
            DEAL: ${deal.title}
            STAGE: ${deal.stage}
            
            Your goal is to coordinate between agents, buyers, and sellers.
            
            OUTPUT: JSON with 'thought' and 'final_response' (draft reply) and optionally 'tool_calls' (same tools available).
            `;

            const result = await model.generateContent([
                SYSTEM_PROMPT,
                `History:\n${historyStr}\n\nNew Message: ${message}`
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
