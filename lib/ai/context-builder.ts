
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { getMessages, getConversation } from "@/lib/ghl/conversations";
import { DEFAULT_MODEL } from "@/lib/ai/pricing";

interface MultiContextParams {
    dealContextId: string;
    targetAudience: 'LEAD' | 'OWNER' | 'OTHER';
    accessToken: string;
    userHints?: string;
}

export async function generateMultiContextDraft(params: MultiContextParams) {
    try {
        // 1. Fetch Deal Context
        const dealContext = await db.dealContext.findUnique({
            where: { id: params.dealContextId },
            include: { location: true } // Need location for API Key
        });

        if (!dealContext) {
            throw new Error("Deal Context not found");
        }

        // 2. Setup AI
        const configAny = await db.siteConfig.findUnique({ where: { locationId: dealContext.location.id } }) as any;
        const apiKey = configAny?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("No AI API Key configured");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: configAny?.googleAiModel || DEFAULT_MODEL });

        // 3. Fetch All Linked Conversations
        const conversationPromises = dealContext.conversationIds.map(async (cid: string) => {
            const [details, messages] = await Promise.all([
                getConversation(params.accessToken, cid),
                getMessages(params.accessToken, cid)
            ]);
            return {
                id: cid,
                details: details.conversation,
                messages: Array.isArray(messages?.messages?.messages) ? [...messages.messages.messages].reverse() : []
            };
        });

        const conversations = await Promise.all(conversationPromises);

        // 4. Fetch Linked Properties (Context)
        const propertyPromises = dealContext.propertyIds.map((id: string) => db.property.findUnique({ where: { id } }));
        const properties = (await Promise.all(propertyPromises)).filter(Boolean);

        // 5. Build the "God Mode" Prompt
        let systemPrompt = `You are an expert Real Estate Deal Coordinator. 
        You are looking at a "Deal Room" which contains multiple separate conversations about the same property/deal.
        
        Your Goal: Draft a message to the ${params.targetAudience} that moves the deal forward, based on what you know from ALL parties.
        
        CONTEXT - ENTITIES:
        Properties: ${properties.map((p: any) => `${p?.title} (€${p?.price})`).join(", ")}
        Stage: ${dealContext.stage}
        
        CONTEXT - CONVERSATIONS (The "Truth"):
        `;

        conversations.forEach((c: any, index: number) => {
            systemPrompt += `\n[Conversation ${index + 1} - with ${c.details.contactName || 'Unknown'}]\n`;

            // Summarize last few messages
            const recent = c.messages.slice(-5);
            recent.forEach((m: any) => {
                const sender = m.direction === 'outbound' ? 'Agent' : (c.details.contactName || 'Contact');
                systemPrompt += `  ${sender}: ${m.body}\n`;
            });
        });

        const userInstruction = params.userHints ? `\n\nSpecific Instruction from Agent: "${params.userHints}"` : "";

        const finalPrompt = `${systemPrompt}
        
        ${userInstruction}
        
        TASK:
        Draft a reply to the ${params.targetAudience}.
        - If drafting to OWNER: Mention if the lead is interested or has made an offer.
        - If drafting to LEAD: Confirm details based on what the owner said (if applicable).
        - Tone: Professional, helpful, concise.
        - FORMATTING: Plain text only. Do NOT use Markdown (no **bold**, no headers).
        - Output: JSON with { "draft": "...", "reasoning": "...", "intent": "..." }
        `;

        // 6. Generate
        const result = await model.generateContent(finalPrompt);
        const text = result.response.text();

        // 7. Parse (Simple heuristic for now, assuming Gemini follows instruction)
        // Clean markdown blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            // Fallback if not valid JSON
            return {
                draft: text,
                reasoning: "AI returned unstructured text.",
                intent: "General"
            };
        }

    } catch (error: any) {
        console.error("MultiContext AI Error:", error);
        return {
            draft: "Error generating draft.",
            reasoning: error.message
        };
    }
}
