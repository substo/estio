import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import db from "@/lib/db";
import { AGENT_TOOLS, TOOL_IMPLEMENTATIONS } from "./tools";

export class DealAgent {
    private genAI: GoogleGenerativeAI;
    private model: any;
    private dealId: string;
    private locationId: string;

    constructor(apiKey: string, dealId: string, locationId: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            tools: AGENT_TOOLS
        });
        this.dealId = dealId;
        this.locationId = locationId;
    }

    async run(userMessage: string, history: { role: string, parts: Part[] }[]) {
        try {
            const chat = this.model.startChat({
                history: history,
            });

            console.log(`[Agent] Receiving input: "${userMessage}"`);
            let result = await chat.sendMessage(userMessage);
            let response = result.response;
            let functionCalls = response.functionCalls();

            // Multi-turn loop for tool usage
            // Loop while the model wants to call functions (limit to 5 turns to prevent loops)
            let turns = 0;
            while (functionCalls && functionCalls.length > 0 && turns < 5) {
                turns++;
                const call = functionCalls[0];
                console.log(`[Agent] Tool Call: ${call.name}`, call.args);

                if ((TOOL_IMPLEMENTATIONS as any)[call.name]) {
                    // Execute Tool
                    const toolResult = await (TOOL_IMPLEMENTATIONS as any)[call.name](call.args, this.locationId);

                    console.log(`[Agent] Tool Result:`, toolResult);

                    // Send Result back to Model
                    result = await chat.sendMessage([{
                        functionResponse: {
                            name: call.name,
                            response: toolResult
                        }
                    }]);

                    response = result.response;
                    functionCalls = response.functionCalls();
                } else {
                    console.error(`Unknown tool: ${call.name}`);
                    break;
                }
            }

            return response.text();

        } catch (e: any) {
            console.error("Agent Execution Error:", e);
            return `I encountered an issue processing your request: ${e.message}`;
        }
    }
}
