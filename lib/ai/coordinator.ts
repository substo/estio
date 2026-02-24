import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { getMessages, getConversation } from "@/lib/ghl/conversations";

// Remove global init
// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

interface CoordinationContext {
    conversationId: string;
    locationId: string;
    contactId: string;
    accessToken: string;
    agentName?: string;
    businessName?: string;
    instruction?: string;
    model?: string;
}

import { calculateRunCost, DEFAULT_MODEL } from "@/lib/ai/pricing";

export async function generateDraft(context: CoordinationContext) {
    let modelName = DEFAULT_MODEL; // Modern default
    let promptTokens = 0;
    let completionTokens = 0;

    try {
        // 0. Fetch Config
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId: context.locationId }
        });
        const configAny = siteConfig as any;
        const apiKey = configAny?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        const brandVoice = typeof configAny?.brandVoice === "string" ? configAny.brandVoice.trim() : "";
        const websiteDomain = typeof configAny?.domain === "string" && configAny.domain.trim()
            ? configAny.domain.trim()
            : null;

        // Use config model if present, otherwise default
        if (configAny?.googleAiModel) {
            modelName = configAny.googleAiModel;
        }

        // Override with explicit request
        if (context.model) {
            modelName = context.model;
        }

        if (!apiKey) {
            return {
                draft: "Error: No AI API Key configured.",
                reasoning: "Please configure Google AI in Settings."
            };
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log(`[AI Draft] Starting generation for Conversation: ${context.conversationId}, Model: ${modelName}`);

        // 1. Fetch Conversation History & Details
        // STRATEGY: Local Database is the PRIMARY source of truth.
        // We only fetch from GHL if the conversation is missing locally or explicitly designated as GHL-sourced but empty.

        let messages: any[] = [];
        let conversationType = 'SMS';
        let foundLocally = false;

        // Step 1: Try Local Lookup (Primary)
        try {
            let localConversation = await db.conversation.findUnique({
                where: { id: context.conversationId },
                include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
            });

            if (!localConversation) {
                // Try looking up by GHL ID (as UI often passes this)
                localConversation = await db.conversation.findUnique({
                    where: { ghlConversationId: context.conversationId },
                    include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
                });
            }

            if (localConversation) {
                console.log(`[AI Draft] Local DB Fetch Success. Found ${localConversation.messages.length} messages.`);
                messages = localConversation.messages.reverse().map(m => ({
                    direction: m.direction,
                    body: m.body
                }));
                conversationType = localConversation.lastMessageType || 'SMS';
                foundLocally = true;
            } else {
                console.log(`[AI Draft] Conversation not found locally (ID: ${context.conversationId}).`);
            }
        } catch (dbError) {
            console.error("[AI Draft] Local DB Error:", dbError);
        }

        // Step 2: GHL Fallback (Secondary)
        // Used only if local lookup failed OR yielded no messages (and we suspect there might be history in GHL)
        if (!foundLocally || messages.length === 0) {
            console.log(`[AI Draft] Local context empty/missing. Attempting GHL Fallback...`);

            let ghlIdToUse = context.conversationId;

            // If we found it locally (but empty messages), try to find a linked GHL ID
            if (foundLocally) {
                const localRef = await db.conversation.findUnique({
                    where: { id: context.conversationId },
                    select: { ghlConversationId: true }
                });
                if (localRef?.ghlConversationId) {
                    ghlIdToUse = localRef.ghlConversationId;
                }
            }

            // Only attempt GHL if the ID looks valid (length check) 
            // and is essentially distinct/valid compared to raw input if that was internal
            if (ghlIdToUse && ghlIdToUse.length > 15) {
                try {
                    console.log(`[AI Draft] Fetching from GHL (ID: ${ghlIdToUse})...`);
                    const [messagesData, conversationData] = await Promise.all([
                        getMessages(context.accessToken, ghlIdToUse),
                        getConversation(context.accessToken, ghlIdToUse)
                    ]);

                    const ghlMessages = Array.isArray(messagesData?.messages?.messages)
                        ? [...messagesData.messages.messages].reverse()
                        : [];

                    if (ghlMessages.length > 0) {
                        messages = ghlMessages;
                        conversationType = conversationData?.conversation?.lastMessageType || conversationData?.conversation?.type || 'SMS';
                        console.log(`[AI Draft] GHL Fallback Success. Found ${messages.length} messages.`);
                    } else {
                        console.log(`[AI Draft] GHL returned no messages.`);
                    }
                } catch (ghlError) {
                    console.warn(`[AI Draft] GHL Fallback Failed:`, (ghlError as any).message);
                }
            } else {
                console.log(`[AI Draft] Skipping GHL fallback (ID likely internal/invalid: ${ghlIdToUse})`);
            }
        }

        // Determine Channel
        const channelType = conversationType.toUpperCase();
        const isEmail = channelType.includes('EMAIL');
        const channelName = isEmail ? 'Email' : 'WhatsApp/SMS';
        const agentName = (context.agentName || "").trim();
        const businessName = (context.businessName || configAny?.name || "the agency").trim();

        // 2. Fetch Contact & Property Data from Local DB (Context Enrichment)
        // Support both local Contact.id and external ghlContactId (UI can pass either).
        const contact = await db.contact.findFirst({
            where: {
                locationId: context.locationId,
                OR: [
                    { id: context.contactId },
                    { ghlContactId: context.contactId }
                ]
            },
            include: {
                viewings: true,
                propertyRoles: {
                    include: {
                        property: true
                    }
                }
            }
        });
        const contactFirstName = (contact?.firstName || contact?.name || "").trim().split(/\s+/)[0] || null;

        // 3. Construct Prompt
        let systemPrompt = `You are an expert real estate message drafter for a live agent.
        Write the exact outbound message the agent should send next (not analysis).

        Agent Identity:
        - Agent Name: ${agentName || "Unknown"}
        - Business Name: ${businessName}
        ${websiteDomain ? `- Website: https://${websiteDomain}` : "- Website: Unknown"}
        ${brandVoice ? `- Brand Voice: ${brandVoice}` : "- Brand Voice: Not provided"}

        Context:
        - Role: Intermediary connecting leads, owners, and agents.
        - Tone: ${isEmail ? 'Professional, clear, polite, human.' : 'Natural, concise, friendly, human.'}
        - Channel: ${channelName}.

        HIGH-PRIORITY DRAFTING RULES:
        - Personalize the greeting with the contact's first name when available.
        - If this appears to be a first outreach or imported lead enquiry (notes/listing details but no real typed message), write a proactive first response.
        - If agent name and business name are available, introduce the agent naturally in first outreach (e.g. "It's ${agentName || "the agent"} at ${businessName} here.").
        - If a property is marked rented/sold/unavailable in the context, say that clearly early in the message.
        - Reference the specific property title/ref/location/listing URL when present.
        - Offer a next step (e.g. suggest similar properties / ask preferences) when the requested property is unavailable.
        - Avoid generic canned openings like "Hello! Thank you for your inquiry." unless the user specifically asks for that tone.
        - Sound like a real agent typed this manually. Do not sound like customer support automation.

        IMPORTANT FORMATTING RULES:
        ${isEmail
                ? '- Output MUST be in HTML format (e.g. use <br> for line breaks, <b> for emphasis).'
                : '- Output MUST be in Plain Text.'}
        - Do NOT use Markdown (no **bold** asterisks, no headers #).
        ${!isEmail ? '- Do NOT use HTML tags.' : ''}
        - Output ONLY the message body (no analysis, no JSON, no labels).
        `;

        if (contact) {
            const isSeeker = !['Owner', 'Agent', 'Partner'].includes(contact.contactType);

            if (isSeeker) {
                systemPrompt += `\n\nContact Information:
                - Name: ${contact.name}
                - First Name (preferred for greeting): ${contactFirstName}
                - Phone: ${contact.phone}
                
                Requirements:
                - Status: ${contact.requirementStatus}
                - District: ${contact.requirementDistrict}
                - Bedrooms: ${contact.requirementBedrooms}
                - Budget: ${contact.requirementMinPrice} - ${contact.requirementMaxPrice}
                - Condition: ${contact.requirementCondition}
                - Types: ${contact.requirementPropertyTypes.join(", ")}
                
                Property Activity:
                - Interested Properties: ${contact.propertyRoles.filter(r => r.role === 'buyer' || r.role === 'tenant' || r.role === 'viewer').map(r => r.property.title).join(", ")}
                - Inspected Properties: ${(contact.propertiesInspected || []).join(", ")}
                - Emailed Properties: ${(contact.propertiesEmailed || []).join(", ")}
                - Matched Properties: ${(contact.propertiesMatched || []).join(", ")}
                - Viewings: ${contact.viewings.map(v => `${v.date.toDateString()} at ${v.propertyId}`).join(", ")}
                `;
            } else {
                // For Owners/Agents/Partners - Focus on their roles
                systemPrompt += `\n\nContact Information (Type: ${contact.contactType}):
                - Name: ${contact.name}
                - First Name (preferred for greeting): ${contactFirstName}
                - Phone: ${contact.phone}
                
                Associated Properties (as ${contact.contactType}):
                ${contact.propertyRoles.filter(r => r.role.toLowerCase() === contact.contactType.toLowerCase()).map(r => `- ${r.property.title} (Role: ${r.role})`).join("\n")}
                
                Note: This contact is an ${contact.contactType}, not a lead looking to buy/rent. Focus on their associated properties.
                `;
            }
        }

        let conversationText = "";
        messages.forEach(m => {
            const sender = m.direction === 'outbound' ? 'Agent' : 'Contact';
            conversationText += `${sender}: ${m.body}\n`;
        });

        const fullPrompt = `${systemPrompt}

        Recent Conversation History:
        ${conversationText}

        Task:
        Draft a suggested reply for the Agent to send back to the Contact via ${channelName}.
        Analyze the conversation to understand the intent (booking a viewing, asking price, etc.).
        Use the Contact's Requirements and Property Activity to personalize the response.
        If they are asking about a property they've already seen or been emailed, acknowledge that context.
        If the contact is asking about a property, answer directly when the status/details are present in the context.
        If the property is unavailable, explain briefly and offer help finding alternatives.
        ${isEmail ? 'Include a subject line suggestion only if a new topic is started and it reads naturally.' : 'Keep it concise (typically 2-5 short lines), but do not force an overly short reply if clarity requires more.'}
        
        Output Format:
        Just the draft message text the agent should send next.
        `;

        // Add specific user instruction if provided
        // Add specific user instruction if provided
        let finalPrompt = fullPrompt;
        if (context.instruction) {
            finalPrompt += `\n\nSPECIFIC USER INSTRUCTION:\nThe user has provided a sketch/instruction for this reply: "${context.instruction}"\n\nYour Draft MUST:\n1. Follow this instruction precisely.\n2. Expand it into a full, polished message suitable for the channel.\n3. Do NOT just repeat the instruction; write the actual message the agent would send.`;
        }

        console.log("--- [AI Draft] FULL PROMPT START ---");
        console.log(finalPrompt);
        console.log("--- [AI Draft] FULL PROMPT END ---");

        // 4. Call Gemini
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();

        // 5. Track Costs & Usage
        if (response.usageMetadata) {
            promptTokens = response.usageMetadata.promptTokenCount;
            completionTokens = response.usageMetadata.candidatesTokenCount;
        } else {
            // Fallback estimate if API doesn't return usage
            promptTokens = Math.ceil(fullPrompt.length / 4);
            completionTokens = Math.ceil(text.length / 4);
        }

        const cost = calculateRunCost(modelName, promptTokens, completionTokens);

        // 6. Persist to DB
        // Determine DB conversation ID (internal)
        const dbConversation = await db.conversation.findUnique({
            where: { ghlConversationId: context.conversationId },
            select: { id: true }
        });

        if (dbConversation) {
            // Log Execution
            await db.agentExecution.create({
                data: {
                    conversationId: dbConversation.id,
                    taskId: "quick-draft",
                    taskTitle: "Quick AI Draft",
                    taskStatus: "done",
                    thoughtSummary: "Generated draft reply based on conversation context.",
                    draftReply: text,
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    model: modelName,
                    cost
                }
            });

            // Update Conversation Totals
            await db.conversation.update({
                where: { id: dbConversation.id },
                data: {
                    promptTokens: { increment: promptTokens },
                    completionTokens: { increment: completionTokens },
                    totalTokens: { increment: promptTokens + completionTokens },
                    totalCost: { increment: cost }
                }
            });
        }

        return {
            draft: text,
            reasoning: "Generated based on conversation history and contact interest."
        };

    } catch (error: any) {
        console.error("AI Coordinator Error:", error);

        // Return clearer error message to UI
        let message = "Error generating draft.";
        if (error.message?.includes("API key")) message = "Invalid or missing API Key.";
        if (error.message?.includes("429")) message = "AI Rate limit exceeded. Try again later.";

        return {
            draft: message,
            reasoning: `Technical Error: ${error.message || "Unknown error"}`
        };
    }
}
