'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { callLLM } from '@/lib/ai/llm';
import { getModelForTask } from '@/lib/ai/model-router';

/**
 * Analyze a contact's conversation history and extract outreach details.
 */
export async function analyzeContactAction(contactId: string, locationId: string) {
    try {
        const user = await currentUser();
        if (!user) return { success: false, message: "Unauthorized" };

        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: {
                conversations: {
                    include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } }
                },
                history: { orderBy: { createdAt: 'desc' }, take: 10 }
            }
        });

        if (!contact) return { success: false, message: "Contact not found" };

        // Build conversation context
        const conversationText = contact.conversations
            .flatMap(c => c.messages)
            .map(m => `[${m.direction}] ${m.body || ''}`)
            .join('\n');

        if (!conversationText.trim()) {
            return { success: false, message: "No conversation history to analyze" };
        }

        const model = getModelForTask("qualification");
        const prompt = `You are an AI assistant analyzing a real estate lead's conversation history.

Contact: ${contact.firstName || contact.name || 'Unknown'} ${contact.lastName || ''}
Email: ${contact.email || 'N/A'}
Phone: ${contact.phone || 'N/A'}

Conversation History:
${conversationText}

Analyze this conversation and return a JSON object with:
1. "phoneContactEntry": { "firstName": string, "lastName": string } - Best name to save
2. "drafts": { "icebreaker": string, "qualifier": string } - Outreach message drafts
3. "crmSummary": string - A one-line CRM note summarizing the lead's intent
4. "requirements": { "budget": string, "location": string, "type": string, "bedrooms": string } - Extracted requirements

Return valid JSON only.`;

        const response = await callLLM(model, prompt, undefined, { jsonMode: true });
        const data = JSON.parse(response);

        // Update contact requirements if extracted
        if (data.requirements) {
            await db.contact.update({
                where: { id: contactId },
                data: {
                    requirementMinPrice: data.requirements.budget?.split('-')[0]?.trim() || undefined,
                    requirementMaxPrice: data.requirements.budget?.split('-')[1]?.trim() || undefined,
                    requirementDistrict: data.requirements.location || undefined,
                }
            });
        }

        revalidatePath(`/admin/contacts/${contactId}`);

        return { success: true, data };
    } catch (error: any) {
        console.error("[analyzeContactAction] Error:", error);
        return { success: false, message: error.message };
    }
}
