import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { DEFAULT_MODEL } from "@/lib/ai/pricing";

export async function generateSmartReplies(conversationId: string) {
    try {
        console.log(`[Smart Reply] Starting generation for Conversation: ${conversationId}`);

        // 1. Fetch Conversation & Config
        const conversation = await db.conversation.findUnique({
            where: { id: conversationId },
            include: {
                messages: { orderBy: { createdAt: 'desc' }, take: 15 },
                location: { include: { siteConfig: true } }
            }
        });

        if (!conversation) {
            console.error(`[Smart Reply] Conversation not found (DB Query Failed): ${conversationId}`);
            return;
        }

        // 2. Setup AI
        const siteConfig = conversation.location.siteConfig as any;
        const apiKey = siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY;

        // Match coordinator.ts default (assuming 2.5 exists in 2026)
        let modelName = DEFAULT_MODEL;

        if (siteConfig?.googleAiModel) {
            modelName = siteConfig.googleAiModel;
        }

        if (!apiKey) {
            console.warn("[Smart Reply] No API Key found. Skipping.");
            return;
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        // 3. Prepare Context
        const reversedMessages = [...conversation.messages].reverse();
        let conversationText = "";
        reversedMessages.forEach(m => {
            const sender = m.direction === 'outbound' ? 'Agent' : 'Contact';
            // Only include text messages for now
            if (!m.body) return;
            conversationText += `${sender}: ${m.body}\n`;
        });

        // 4. Prompt
        console.log(`[Smart Reply] Generating with prompt for ${conversationId}`);
        const prompt = `
        You are a helpful assistant for a Real Estate Agent.
        Analyze the following conversation history and suggest 3 short, distinct "next actions" or "intents" for the agent.
        
        Conversation History:
        ${conversationText}

        Rules:
        - Provide exactly 3 options.
        - Options should be short labels (max 4-5 words) describing the INTENT, not the full message.
        - Examples: "Confirm Viewing", "Send Price List", "Ask for Budget", "Say Thanks", "Schedule Call".
        - The intent will be used to generate a full draft later.
        - Output format: JSON array of strings. Example: ["Intent 1", "Intent 2", "Intent 3"]
        - Do not output markdown code blocks. Just the raw JSON.
        `;

        console.log("[Smart Reply] Calling Gemini...");
        // 5. Generate
        const result = await model.generateContent(prompt);
        const response = result.response;
        console.log("[Smart Reply] Gemini Response received.");
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        console.log(`[Smart Reply] Raw AI Output: ${text}`);

        let suggestions: string[] = [];
        try {
            suggestions = JSON.parse(text);
        } catch (e) {
            console.error("[Smart Reply] Failed to parse JSON:", text);
            // Fallback: splitting by newlines if it failed to give JSON
            suggestions = text.split('\n').filter(s => s.trim().length > 0).slice(0, 3);
        }

        // Validate suggestions are strings
        suggestions = suggestions.filter(s => typeof s === 'string').slice(0, 3);

        console.log(`[Smart Reply] Generated suggestions:`, suggestions);

        // 6. Save to DB
        await db.conversation.update({
            where: { id: conversationId },
            data: { suggestedActions: suggestions }
        });

    } catch (error) {
        console.error("[Smart Reply] Error generating suggestions:", error);
    }
}
