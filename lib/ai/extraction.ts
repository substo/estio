
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { DEFAULT_MODEL } from "@/lib/ai/pricing";

interface ExtractionResult {
    phoneContactEntry: {
        firstName: string;
        lastName: string; // The "Visual ID" info
    };
    requirements: {
        status?: string;
        district?: string;
        bedrooms?: string;
        minPrice?: string;
        maxPrice?: string;
        condition?: string;
        propertyTypes?: string[];
        otherDetails?: string;
    };
    drafts: {
        icebreaker: string;
        qualifier: string;
    };
    crmSummary: string;
}

export async function analyzeContactRequirements(
    locationId: string,
    contactId: string,
    conversationHistory: string,
    inputNotes: string = ""
): Promise<ExtractionResult | null> {
    try {
        // 1. Fetch Config
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId }
        });

        const outreachConfig = (siteConfig?.outreachConfig as any) || {};

        // If disabled, return null (or should we strictly enforce this? Maybe caller checks.)
        if (!outreachConfig.enabled) {
            console.log("Outreach Assistant is disabled.");
            return null;
        }

        const apiKey = siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        const modelName = siteConfig?.googleAiModel || DEFAULT_MODEL;

        if (!apiKey) {
            console.error("No AI API Key found.");
            return null;
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 2. Fetch Contact Details
        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: { propertyRoles: { include: { property: true } } }
        });

        if (!contact) return null;

        // 3. Construct Prompts
        const visionPrompt = outreachConfig.visionIdPrompt || "Analyze lead context and generate phone contact entry and requirements.";
        const icebreakerPrompt = outreachConfig.icebreakerPrompt || "Draft icebreaker WhatsApp.";
        const qualifierPrompt = outreachConfig.qualifierPrompt || "Draft qualifier WhatsApp.";

        const prompt = `
        You are Martin's Outreach Assistant.
        
        INPUT DATA:
        - Contact Name: ${contact.name}
        - Phone: ${contact.phone}
        - Email: ${contact.email}
        - Raw Input / Notes: ${inputNotes}
        - Conversation History: ${conversationHistory}
        - Related Properties: ${contact.propertyRoles.map(r => `${r.property.reference} (${r.property.title})`).join(", ")}
        
        TASK 1: VISION ID & REQUIREMENTS (${visionPrompt})
        TASK 2: DRAFT ICEBREAKER (${icebreakerPrompt})
        TASK 3: DRAFT QUALIFIER (${qualifierPrompt})
        
        OUTPUT FORMAT (JSON):
        {
            "phoneContactEntry": {
                "firstName": "Full Name",
                "lastName": "Lead Rent [Ref] ..."
            },
            "requirements": {
                "status": "For Sale" | "For Rent",
                "district": "Paphos" | "Limassol" | "Any District",
                "bedrooms": "Any Bedrooms" | "1+ Bedrooms" ...,
                "minPrice": "Any" | "€...",
                "maxPrice": "Any" | "€...",
                "condition": "Any Condition" | "Resale" ...,
                "propertyTypes": ["Apartment", "Villa"...],
                "otherDetails": "String summary of other needs"
            },
            "drafts": {
                "icebreaker": "Message Text...",
                "qualifier": "Message Text..."
            },
            "crmSummary": "Short concise bullet point for CRM (e.g. 'Looking for 2bdr rent Paphos')"
        }
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        try {
            const data = JSON.parse(responseText) as ExtractionResult;
            return data;
        } catch (e) {
            console.error("Failed to parse AI response JSON", e);
            console.log("Raw Response:", responseText);
            return null;
        }

    } catch (error) {
        console.error("analyzeContactRequirements error:", error);
        return null;
    }
}
