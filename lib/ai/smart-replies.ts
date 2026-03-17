import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { assembleTimelineEvents, formatTimelineEventForPrompt } from "@/lib/conversations/timeline-events";
import { DEFAULT_MODEL, calculateRunCost } from "@/lib/ai/pricing";
import {
    buildDealProtectiveCommunicationContract,
    resolveCommunicationLanguage
} from "@/lib/ai/prompts/communication-policy";

export async function generateSmartReplies(conversationId: string) {
    try {
        console.log(`[Smart Reply] Starting generation for Conversation: ${conversationId}`);

        // 1. Fetch Conversation & Config
        const conversation = await db.conversation.findUnique({
            where: { id: conversationId },
            include: {
                location: { include: { siteConfig: true } },
                contact: { select: { preferredLang: true } }
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
        const timelineResult = await assembleTimelineEvents({
            mode: "chat",
            locationId: conversation.locationId,
            conversationId: conversation.id,
            includeMessages: true,
            includeActivities: true,
            take: 36, // same window as AI Draft Compaction
        });
        
        const recentEvents = timelineResult.events;
        const conversationText = recentEvents.map((e) => formatTimelineEventForPrompt(e, 220)).join("\n");
        
        // Find latest inbound text for language detection
        const latestInboundText = [...recentEvents]
            .reverse() // from newest to oldest since events are sorted ascending by assembleTimelineEvents
            .find((e): e is import("@/lib/conversations/timeline-events").TimelineMessageEvent => e.kind === "message" && e.message.direction === "inbound" && (e.message.body || "").trim().length > 0)
            ?.message?.body || "";
            
        const languageResolution = resolveCommunicationLanguage({
            manualOverrideLanguage: "en", // Force English language for AI Suggested Replies
            latestInboundText,
            contactPreferredLanguage: conversation.contact?.preferredLang ?? null,
            threadText: conversationText,
        });
        const communicationContract = buildDealProtectiveCommunicationContract({
            expectedLanguage: languageResolution.expectedLanguage,
            latestInboundLanguage: languageResolution.latestInboundLanguage,
            contactPreferredLanguage: languageResolution.contactPreferredLanguage,
            contextLabel: "suggested action labels",
        });

        // 4. Prompt
        console.log(`[Smart Reply] Generating with prompt for ${conversationId}`);
        const prompt = `
        You are a helpful assistant for a Real Estate Agent.
        Analyze the following conversation history and suggest 3 short, distinct "next actions" or "intents" for the agent.
        
        ${communicationContract}
        
        Conversation History:
        ${conversationText}

        Rules:
        - Provide exactly 3 options.
        - Options should be short labels (max 4-5 words) describing the INTENT, not the full message.
        - Keep labels neutral, factual, and commercially aware.
        - Avoid pressure language and emotional sales wording.
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

        const usage = response.usageMetadata;
        
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        
        if (usage) {
            promptTokens = usage.promptTokenCount || 0;
            completionTokens = usage.candidatesTokenCount || 0;
            totalTokens = usage.totalTokenCount || (promptTokens + completionTokens);
        } else {
            // fallback estimate
            promptTokens = Math.ceil(prompt.length / 4);
            completionTokens = Math.ceil(text.length / 4);
            totalTokens = promptTokens + completionTokens;
        }
        
        const cost = calculateRunCost(modelName, promptTokens, completionTokens);

        // 6. Save to DB
        await db.conversation.update({
            where: { id: conversationId },
            data: { 
                suggestedActions: suggestions,
                promptTokens: { increment: promptTokens },
                completionTokens: { increment: completionTokens },
                totalTokens: { increment: totalTokens },
                totalCost: { increment: cost }
            }
        });

        // 7. Log Execution
        await db.agentExecution.create({
            data: {
                conversationId,
                taskId: "smart-reply-gen",
                taskTitle: "Background Smart Replies Generation",
                taskStatus: "done",
                thoughtSummary: `Generated ${suggestions.length} suggestions using ${modelName}.`,
                latencyMs: 0, 
                status: "done",
                promptTokens,
                completionTokens,
                totalTokens,
                model: modelName,
                cost,
                draftReply: JSON.stringify(suggestions)
            }
        });

    } catch (error) {
        console.error("[Smart Reply] Error generating suggestions:", error);
    }
}
