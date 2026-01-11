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
}

export async function generateDraft(context: CoordinationContext) {
    try {
        // 0. Fetch Config
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId: context.locationId }
        });
        const configAny = siteConfig as any;
        const apiKey = configAny?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        const modelName = configAny?.googleAiModel || "gemini-1.5-flash";

        if (!apiKey) {
            return {
                draft: "Error: No AI API Key configured.",
                reasoning: "Please configure Google AI in Settings."
            };
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        // 1. Fetch Conversation History & Details
        const [messagesData, conversationData] = await Promise.all([
            getMessages(context.accessToken, context.conversationId),
            getConversation(context.accessToken, context.conversationId)
        ]);

        const messages = Array.isArray(messagesData?.messages?.messages)
            ? [...messagesData.messages.messages].reverse() // Oldest first for context
            : [];

        // Determine Channel
        const channelType = (conversationData?.conversation?.lastMessageType || conversationData?.conversation?.type || 'SMS').toUpperCase();
        const isEmail = channelType.includes('EMAIL');
        const channelName = isEmail ? 'Email' : 'SMS';

        // 2. Fetch Contact & Property Data from Local DB (Context Enrichment)
        // We need to find the local Contact linked to this GHL Contact ID
        const contact = await db.contact.findFirst({
            where: { ghlContactId: context.contactId },
            include: {
                viewings: true,
                propertyRoles: {
                    include: {
                        property: true
                    }
                }
            }
        });

        // 3. Construct Prompt
        let systemPrompt = `You are an expert Real Estate Coordinator for an agency. 
        Your goal is to assist agents by drafting professional, concise, and helpful replies to leads and clients.
        
        Context:
        - Role: Intermediary between connecting leads, owners, and agents.
        - Tone: ${isEmail ? 'Professional, detailed, polite.' : 'Concise, direct, friendly.'}
        - Channel: ${channelName}.
        
        IMPORTANT FORMATTING RULES:
        ${isEmail
                ? '- Output MUST be in HTML format (e.g. use <br> for line breaks, <b> for emphasis).'
                : '- Output MUST be in Plain Text.'}
        - Do NOT use Markdown (no **bold** asterisks, no headers #).
        ${!isEmail ? '- Do NOT use HTML tags.' : ''}
        `;

        if (contact) {
            const isSeeker = !['Owner', 'Agent', 'Partner'].includes(contact.contactType);

            if (isSeeker) {
                systemPrompt += `\n\nContact Information:
                - Name: ${contact.name}
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
        If the contact is asking about a property, try to answer based on general knowledge or suggest booking a viewing.
        ${isEmail ? 'Include a subject line suggestion if a new topic is started.' : 'Keep it under 160 chars if possible.'}
        
        Output Format:
        Just the draft message text.
        `;

        // 4. Call Gemini
        const result = await model.generateContent(fullPrompt);
        const response = result.response;
        const text = response.text();

        return {
            draft: text,
            reasoning: "Generated based on conversation history and contact interest."
        };

    } catch (error) {
        console.error("AI Coordinator Error:", error);
        return {
            draft: "Error generating draft.",
            reasoning: "Failed to call AI service."
        };
    }
}
