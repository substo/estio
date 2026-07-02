
import db from "@/lib/db";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { getMessages, getConversation } from "@/lib/ghl/conversations";
import { DEFAULT_MODEL } from "@/lib/ai/pricing";
import { callLLMWithMetadata } from "@/lib/ai/llm";
import { resolveAiModelDefault } from "@/lib/ai/fetch-models";
import { collectDealConversationReferences } from "@/lib/deals/conversation-links";
import { isLikelyGhlConversationId } from "@/lib/conversations/identity";
import {
    buildDealProtectiveCommunicationContract,
    resolveCommunicationLanguage
} from "@/lib/ai/prompts/communication-policy";

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
            include: {
                location: true,
                conversationLinks: {
                    select: {
                        conversationId: true,
                        legacyConversationRef: true,
                    },
                },
            }
        });

        if (!dealContext) {
            throw new Error("Deal Context not found");
        }

        // 2. Setup AI
        const configAny = await db.siteConfig.findUnique({ where: { locationId: dealContext.location.id } }) as any;
        const modelName = await resolveAiModelDefault(dealContext.location.id, "draft")
            || configAny?.googleAiModel
            || DEFAULT_MODEL;

        // 3. Fetch all linked conversations from Estio first. GHL is only a legacy fallback.
        const refs = collectDealConversationReferences(dealContext);
        const localConversations = refs.allRefs.length > 0
            ? await db.conversation.findMany({
                where: {
                    locationId: dealContext.location.id,
                    OR: [
                        { id: { in: refs.linkedConversationIds } },
                        { id: { in: refs.legacyConversationRefs } },
                        { ghlConversationId: { in: refs.legacyConversationRefs } },
                        { syncRecords: { some: { providerConversationId: { in: refs.legacyConversationRefs } } } },
                        { syncRecords: { some: { providerThreadId: { in: refs.legacyConversationRefs } } } },
                    ],
                },
                include: {
                    contact: { select: { name: true, email: true } },
                    messages: {
                        orderBy: { createdAt: "desc" },
                        take: 5,
                        select: {
                            body: true,
                            direction: true,
                            createdAt: true,
                        },
                    },
                },
            })
            : [];

        const byLocalRef = new Map<string, typeof localConversations[number]>();
        for (const conversation of localConversations) {
            byLocalRef.set(conversation.id, conversation);
            if (conversation.ghlConversationId) byLocalRef.set(conversation.ghlConversationId, conversation);
        }

        const seenConversationRefs = new Set<string>();
        const conversations = refs.allRefs.length > 0
            ? (await Promise.all(refs.allRefs.map(async (ref: string) => {
                const localConversation = byLocalRef.get(ref);
                if (localConversation) {
                    if (seenConversationRefs.has(localConversation.id)) return null;
                    seenConversationRefs.add(localConversation.id);
                    return {
                        id: localConversation.id,
                        details: {
                            contactName: localConversation.contact?.name || localConversation.contact?.email || "Unknown",
                        },
                        messages: [...localConversation.messages]
                            .reverse()
                            .map((message) => ({
                                body: message.body,
                                direction: message.direction,
                            })),
                    };
                }

                if (!params.accessToken || !isLikelyGhlConversationId(ref)) return null;
                if (seenConversationRefs.has(ref)) return null;
                seenConversationRefs.add(ref);
                const [details, messages] = await Promise.all([
                    getConversation(params.accessToken, ref),
                    getMessages(params.accessToken, ref)
                ]);
                return {
                    id: ref,
                    details: details.conversation,
                    messages: Array.isArray(messages?.messages?.messages) ? [...messages.messages.messages].reverse() : []
                };
            }))).filter(Boolean)
            : [];

        // 4. Fetch Linked Properties (Context)
        const propertyPromises = dealContext.propertyIds.map((id: string) => db.property.findUnique({ where: { id } }));
        const properties = (await Promise.all(propertyPromises)).filter(Boolean);

        // 5. Build the "God Mode" Prompt
        const allMessages = conversations.flatMap((conversation: any) => conversation.messages || []);
        const latestInboundMessage = [...allMessages]
            .reverse()
            .find((message: any) => message?.direction === "inbound" && String(message?.body || "").trim().length > 0)?.body || "";
        const threadText = allMessages.map((message: any) => String(message?.body || "").trim()).filter(Boolean).join("\n");
        const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(dealContext.location.id);
        const languageResolution = resolveCommunicationLanguage({
            locationDefaultLanguage: locationDefaultReplyLanguage,
            latestInboundText: latestInboundMessage,
            threadText,
            fallbackLanguage: locationDefaultReplyLanguage,
        });
        const communicationContract = buildDealProtectiveCommunicationContract({
            expectedLanguage: languageResolution.expectedLanguage,
            latestInboundLanguage: languageResolution.latestInboundLanguage,
            contextLabel: "deal-room outbound drafting",
        });

        let systemPrompt = `You are an expert Real Estate Deal Coordinator. 
        You are looking at a "Deal Room" which contains multiple separate conversations about the same property/deal.
        
        Your Goal: Draft a message to the ${params.targetAudience} that moves the deal forward, based on what you know from ALL parties.
        
        ${communicationContract}
        
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
        const result = await callLLMWithMetadata(modelName, finalPrompt, undefined, {
            jsonMode: true,
            locationId: dealContext.location.id,
        });
        const text = result.text;

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
