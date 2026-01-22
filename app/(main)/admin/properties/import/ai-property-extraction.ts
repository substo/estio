"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import fs from "fs";
import path from "path";
import { FEATURE_CATEGORIES } from "@/lib/properties/filter-constants";
import { PROPERTY_TYPES, RENTAL_PERIODS } from "@/lib/properties/constants";
import { DEFAULT_MODEL } from "@/lib/ai/pricing";


// --- INTERFACES ---

export interface AIPropertyData {
    // Details
    title: string;
    description: string;
    category: string;
    type: string;
    bedrooms?: number;
    bathrooms?: number;
    areaSqm?: number;           // Total Covered
    coveredAreaSqm?: number;    // Indoor
    coveredVerandaSqm?: number;
    uncoveredVerandaSqm?: number;
    plotAreaSqm?: number;
    basementSqm?: number;
    buildYear?: number;
    condition?: string;

    // Pricing
    price?: number;
    currency?: string;
    communalFees?: number;
    priceIncludesCommunalFees?: boolean;
    deposit?: string;
    depositValue?: number;
    commission?: string;
    agreementNotes?: string;
    billsTransferable?: boolean;

    // Location
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    propertyLocation?: string; // District
    propertyArea?: string;     // Village/Area
    latitude?: number;
    longitude?: number;

    metadata?: any;
    mapUrl?: string;
    shortMapLink?: string;
    appliedRules?: string[];

    // Specs
    features: string[];
    // Legacy / Extra fields
    pool?: string;
    furniture?: string;
    petsAllowed?: string;
    utilities?: string;

    // Publish
    status: string; // ACTIVE
    publicationStatus: string; // DRAFT
    goal: "SALE" | "RENT";
    rentalPeriod?: string;
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string;

    // Notes / Contact
    viewingContact?: string;
    viewingNotes?: string;
    agentRef?: string;
    internalNotes?: string;

    // Media & System
    images: string[];
    rawExtracted: Record<string, any>;
}

// --- MAIN EXTRACTION FUNCTION ---

export async function extractPropertyDataWithAI(
    htmlContent: string = "",
    locationId?: string,
    modelOverride?: string,
    extractedImages: string[] = [],
    pageTitle: string = "",
    contentText: string = "",
    userHints: string = "", // Added userHints
    extractedProperties: Record<string, string> = {},
    screenshotBase64?: string,
    scrapedMapUrl?: string,
    scrapedLat?: number,
    scrapedLng?: number
): Promise<{ success: boolean; data?: AIPropertyData; error?: string }> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    // 1. Get API Key & Config
    let targetLocationId = locationId;
    if (!targetLocationId) {
        const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
        targetLocationId = user?.locations[0]?.id;
    }
    if (!targetLocationId) return { success: false, error: "No Location found." };

    const siteConfig = await db.siteConfig.findUnique({ where: { locationId: targetLocationId } });
    const configAny = siteConfig as any;
    if (!configAny?.googleAiApiKey) return { success: false, error: "Google AI API Key is not configured." };

    const apiKey = configAny.googleAiApiKey;
    const model = modelOverride || DEFAULT_MODEL;

    // --- STAGE 1: VISION (The "Eyes") ---
    console.log("[IMPORT][AI] --- STAGE 1: VISION EXTRACTION ---");
    let rawVisionData: any = {};

    if (screenshotBase64) {
        const visionResult = await runVisionExtraction(apiKey, model, screenshotBase64);
        if (visionResult.success) {
            rawVisionData = visionResult.data;
            console.log(`[IMPORT][AI] Vision extracted values.`);
        } else {
            console.error("Vision Step Failed:", visionResult.error);
        }
    }

    // --- CONTEXT PREPARATION ---
    const commonContext = {
        metadata: {
            pageTitle,
            scrapedMapUrl,
            scrapedCoords: scrapedLat ? `${scrapedLat}, ${scrapedLng}` : "N/A"
        },
        vision: rawVisionData,
        text: contentText.substring(0, 5000),
        userHints // Pass it to context
    };

    // --- STAGE 2: MULTI-TAB EXTRACTION (The "Brain") ---
    console.log("[IMPORT][AI] --- STAGE 2: MULTI-TAB EXTRACTION ---");

    // We run these in parallel to save time, unless there are hard dependencies.
    // Publish depends slightly on Details/Location for meta-generation, but we can pass the raw context.

    const results = await Promise.allSettled([
        runDetailsExtraction(apiKey, model, commonContext),
        runPricingExtraction(apiKey, model, commonContext),
        runLocationExtraction(apiKey, model, commonContext, scrapedMapUrl),
        runSpecsExtraction(apiKey, model, commonContext),
        runPublishExtraction(apiKey, model, commonContext),
        runCategoryExtraction(apiKey, model, commonContext)
    ]);

    const detailsParams = results[0].status === 'fulfilled' ? results[0].value : {};
    const pricingParams = results[1].status === 'fulfilled' ? results[1].value : {};
    const locationParams = results[2].status === 'fulfilled' ? results[2].value : {};
    const specsParams = results[3].status === 'fulfilled' ? results[3].value : {};
    const publishParams = results[4].status === 'fulfilled' ? results[4].value : {};
    const categoryParams = results[5].status === 'fulfilled' ? results[5].value : {};

    // Log failures
    results.forEach((res, idx) => {
        if (res.status === 'rejected') {
            console.error(`AI Task ${idx} Failed:`, res.reason);
        }
    });

    // --- ASSEMBLE ---
    const finalData: Partial<AIPropertyData> = {
        ...(detailsParams || {}),
        ...(pricingParams || {}),
        ...(locationParams || {}),
        ...(specsParams || {}),
        ...(publishParams || {}),
        ...(categoryParams || {}),

        // Overrides / System
        images: extractedImages,
        mapUrl: scrapedMapUrl,
        // If location extraction failed to find map but we scraped one:
        latitude: (locationParams && locationParams.latitude) || scrapedLat,
        longitude: (locationParams && locationParams.longitude) || scrapedLng,

        rawExtracted: {
            ...rawVisionData, // Spread vision data for compatibility
            vision: rawVisionData,
            details: detailsParams,
            pricing: pricingParams,
            location: locationParams,
            category: categoryParams,
        }
    };

    // Sanitize numbers
    const sanitized = sanitizeAIResponse(finalData);

    return { success: true, data: sanitized as AIPropertyData };

}

// --- SUB-ROUTINES ---

async function runVisionExtraction(apiKey: string, model: string, base64Image: string) {
    const prompt = `
    You are an Optical Character Recognition (OCR) engine. 
    Extract ALL text from this real estate listing screenshot.
    Return a flat JSON object with key-value pairs of every label and value you see.
    Do not summarize. Extract raw text exactly as it appears.
    `;
    return callGeminiJSON(apiKey, model, prompt, "VISION", base64Image);
}

async function runDetailsExtraction(apiKey: string, model: string, context: any) {
    const prompt = `
    ROLE: Senior Real Estate Copywriter & Data Analyst.
    TASK: Extract structured details AND write a high-converting marketing description.
    
    INPUT CONTEXT:
    - Page Title: ${context.metadata.pageTitle}
    - Vision Data: ${JSON.stringify(context.vision)}
    - Text Content (Snippet): ${context.text.substring(0, 2000)}
    - User/System Instructions: ${context.userHints || "None"}

    ### 1. EXTRACTION RULES (Structured Data):
    - 'areaSqm' is the TOTAL Covered Area.
    - 'coveredAreaSqm' is Internal/Indoor area.
    - 'coveredVerandaSqm' + 'uncoveredVerandaSqm' often separate.
    - 'buildYear': Extract if year number found near "Year Built" or "Construction Year".

    ### 2. MARKETING COPYWRITING (The "Description" Field):
    You are writing for a high-traffic marketplace (e.g., Bazaraki, Rightmove).
    
    **STRATEGY:**
    - **Tone**: Professional, enthusiastic, yet factual. Avoid flowery clichés like "Nestled in the heart of."
    - **Structure**: Use short paragraphs and bullet points. Online readers scan; they don't read walls of text.
    - **Feature-Benefit Logic**: Don't just list features; explain the *benefit*. 
      - *Bad:* "Has double glazing." 
      - *Good:* "Double-glazed windows for sound insulation and energy efficiency."
    
    **DRAFTING INSTRUCTIONS for 'description' (HTML FORMAT ONLY):**
    - **IMPORTANT**: Return valid HTML string. Do NOT use Markdown (no **, #, -). 
    - Use tags: <p>, <ul>, <li>, <strong>, <br>.
    - Do NOT wrap the entire content in <html> or <body> tags. Just the fragment.

    1. **The Hook (Opening)**: Start with the Property Type, Location, and the #1 Unique Selling Point (USP). Wrapped in <p>.
    2. **The Vibe**: Write 2-3 sentences about the lifestyle. Wrapped in <p>.
    3. **Key Features**: 
       - Extract top 5-7 features.
       - Use an unordered list (<ul>) with list items (<li>).
       - Use <strong> for key amenities.
    4. **Location**: Mention proximity to amenities. Wrapped in <p>.
    5. **Terms**: Clearly state what is included. Wrapped in <p>.
    6. **Call to Action**: End with a nudge to book a viewing. Wrapped in <p>.
    
    **CONSTRAINTS:**
    - NO internal codes or phone numbers in the body.
    - NEVER invent features.

    ### 3. TITLE GENERATION:
    - **CRITICAL**: If the 'Page Title' is generic (e.g., "Pasted Confirmation", "WhatsApp Image", "Import"), you MUST ignore it.
    - **GENERATE**: Create a high-value title based on {Type} + {Location} + {Key Feature}.
    - *Example*: "Modern 3-Bedroom Villa in Paphos with Sea Views"
    - Keep it under 60 characters if possible.

    OUTPUT JSON:
    {
        "title": "String (catchy title)",
        "description": "String (The rich HTML description generated above)",
        "type": "String (e.g. Apartment, Villa, House)",
        "bedrooms": "Number",
        "bathrooms": "Number",
        "areaSqm": "Number (Total Covered)",
        "coveredAreaSqm": "Number (Internal)",
        "coveredVerandaSqm": "Number",
        "uncoveredVerandaSqm": "Number",
        "plotAreaSqm": "Number",
        "basementSqm": "Number",
        "buildYear": "Number"
    }
    `;
    const res = await callGeminiJSON(apiKey, model, prompt, "DETAILS");
    return res.success ? res.data : {};
}

async function runCategoryExtraction(apiKey: string, model: string, context: any) {
    // Generate reference list
    const typeReference = PROPERTY_TYPES.map(cat =>
        `CATEGORY: "${cat.category_label}" (Key: "${cat.category_key}")\n` +
        `   SUBTYPES:\n` +
        cat.subtypes.map(sub => `      - "${sub.subtype_label}" (Key: "${sub.subtype_key}")`).join("\n")
    ).join("\n\n");

    const prompt = `
    ROLE: Real Estate Classifier.
    TASK: Classify the property into exactly ONE Category and ONE Subtype.

    INPUT CONTEXT:
    - Page Title: ${context.metadata.pageTitle}
    - Vision Data: ${JSON.stringify(context.vision)}
    - Text Content: ${context.text.substring(0, 2000)}

    ### AVAILABLE CATEGORIES & SUBTYPES
    You must ONLY use the 'Key' values from this list:
    
    ${typeReference}

    ### RULES:
    1. Analyze the text and vision to find the most accurate classification.
    2. If it's a "House" (or Villa, Bungalow, etc.), category is "house".
    3. If it's an "Apartment" (or Studio, Penthouse), category is "apartment".
    4. If it's "Commercial" (Office, Shop), category is "commercial".
    5. If it's "Land" (Plot, Field), category is "land".
    6. Select the specific subtype key (e.g., "detached_villa", "penthouse", "residential_land").
    
    OUTPUT JSON:
    {
        "category": "String (category_key)",
        "type": "String (subtype_key)"
    }
    `;
    const res = await callGeminiJSON(apiKey, model, prompt, "CATEGORY");
    return res.success ? res.data : { category: "house", type: "detached_villa" };
}

async function runPricingExtraction(apiKey: string, model: string, context: any) {
    const prompt = `
    ROLE: Real Estate Data Entry Clerk - "Pricing" Tab.
    TASK: Extract "Pricing" tab information.
    
    INPUT CONTEXT:
    - Vision Data: ${JSON.stringify(context.vision)}
    - Text Content: ${context.text.substring(0, 2000)}

    RULES:
    1. **Price & Currency**:
       - Extract main price.
       - 'currency': Default to "EUR".
    2. **Communal Fees** (CRITICAL):
       - CHECK VISION DATA: Look for keys like "price_extra", "extra", "fees", or "+ €XX". 
       - If Vision has "price_extra": "€50", then communalFees = 50.
       - **PRIORITY**: CHECK Page in Input Context (NOT just Vision) for patterns like "€1,500+ €50" or "€XXXX + XX", YOU MUST extract the second number (50) as 'communalFees'. This overrides empty keys in Vision.
       - CHECK TEXT: Look for "plus common expenses", "+ communal fees".
    3. **Includes Fees**:
       - Set 'priceIncludesCommunalFees' to true ONLY if text explicitly says "including common expenses". otherwise false.
    4. **Deposit & Agreement**:
       - 'deposit': Text description like "1 rent + 1 deposit".
       - 'depositValue': Calculate total numeric value of deposit.
       - 'agreementNotes': Extract CONTRACT terms only (e.g. "min 1 year", "2 months up front"). DO NOT include viewing info.
    5. **Viewing**:
       - 'viewingContact': Phone numbers.
       - 'viewingNotes': Extract notes about viewing (e.g. "Tenants must be notified", "Mask required", " Keys in lockbox").
    6. **Other**:
       - 'petsAllowed': "Yes", "No", or "Negotiable".
       - 'billsTransferable': If text says "utilities can be transferred", set true.

    OUTPUT JSON:
    {
        "price": "Number",
        "currency": "EUR",
        "communalFees": "Number",
        "priceIncludesCommunalFees": "Boolean",
        "deposit": "String",
        "depositValue": "Number",
        "commission": "String",
        "petsAllowed": "String",
        "agreementNotes": "String",
        "billsTransferable": "Boolean",
        "viewingContact": "String",
        "viewingNotes": "String"
    }
    `;
    const res = await callGeminiJSON(apiKey, model, prompt, "PRICING");
    return res.success ? res.data : {};
}

async function runLocationExtraction(apiKey: string, model: string, context: any, mapUrl?: string) {
    const prompt = `
    ROLE: Real Estate Data Entry Clerk - "Location" Tab.
    TASK: Extract Address and Location Hierarchy.
    
    INPUT CONTEXT:
    - Page Title: ${context.metadata.pageTitle}
    - Map URL: ${mapUrl || "N/A"}
    - Vision Data: ${JSON.stringify(context.vision)}
    - Text Content: ${context.text.substring(0, 2000)}
    - User Instructions: ${context.userHints || "None"}

    RULES (Cyprus Geography):
    - city: Major District (Paphos, Limassol, Nicosia, Larnaca, Famagusta).
    - propertyLocation: Usually same as City.
    - propertyArea: Village or Suburb (e.g. Peyia, Chloraka, Germasogeia, Kato Paphos, Mesogi).
    - addressLine1: Street name/number (or Building Name) if visible.
    - COORDS: Look for "GPS", "Coordinates", "Lat/Lon" strings in text (e.g. "34.123, 32.123").

    OUTPUT JSON:
    {
        "addressLine1": "String",
        "addressLine2": "String",
        "city": "String",
        "postalCode": "String",
        "country": "String (Default: Cyprus)",
        "propertyLocation": "String",
        "propertyArea": "String",
        "latitude": "Number",
        "longitude": "Number"
    }
    `;
    const res = await callGeminiJSON(apiKey, model, prompt, "LOCATION");
    return res.success ? res.data : {};
}

async function runSpecsExtraction(apiKey: string, model: string, context: any) {
    // Generate a reference list of valid features
    const featureReference = FEATURE_CATEGORIES.map(cat =>
        `CATEGORY: ${cat.label}\n` +
        cat.items.map(item => `   - "${item.label}" -> Key: "${item.key}"`).join("\n")
    ).join("\n\n");

    const prompt = `
    ROLE: Real Estate Data Entry Clerk - "Specs" Tab.
    TASK: Extract Features and Amenities and map them to strict system keys.
    
    INPUT CONTEXT:
    - Vision Data: ${JSON.stringify(context.vision)}
    - Text Content: ${context.text.substring(0, 2000)}

    ### AVAILABLE FEATURES REFERENCE
    You must ONLY use the 'Key' values from the list below. Do not invent new keys. Do not return keys that are not in this list.
    
    ${featureReference}

    ### RULES:
    1. Analyze the text and vision data to identify features.
    2. detailed matching:
       - If text says "A/C" or "Air Con", map to "air_conditioning".
       - If text says "Sea View", map to "sea_views".
       - If text says "Pool" or "Swimming Pool", check if it's "private" or "communal". If unspecified, use "swimming_pool_private".
    3. **CRITICAL**: The output 'features' array must contain ONLY the "Key" strings (e.g. "air_conditioning", "guest_toilet"). Do NOT return the human labels.

    OUTPUT JSON:
    {
        "features": ["String (key1)", "String (key2)"]
    }
    `;
    const res = await callGeminiJSON(apiKey, model, prompt, "SPECS");
    return res.success ? res.data : { features: [] };
}


async function runPublishExtraction(apiKey: string, model: string, context: any) {
    const prompt = `
    ROLE: Marketing Manager - "Publish" Tab.
    TASK: Determine Goal and SEO Metadata.
    
    INPUT CONTEXT:
    - Page Title: ${context.metadata.pageTitle}
    - Vision Data: ${JSON.stringify(context.vision)}
    - Text Content: ${context.text.substring(0, 2000)}

    RULES:
    1. **Goal Detection**: 
       - "RENT" if text mentions "per month", "long term", "deposit", or "monthly". 
       - "SALE" otherwise.
    2. **Rental Period**:
       - IF Goal is RENT, select strictly from: ${RENTAL_PERIODS.map(p => `"${p}"`).join(", ")}.
       - Default to "/month" if unclear.
    3. **SEO Metadata**:
       - Ignore generic terms like "Images", "Gallery", "View".
       - FOCUS on the Property Details found in Vision Data (e.g., "3 Bed Villa in Paphos", "Sea View Apartment").
       - metaTitle: Catchy SEO title (<60 chars) including Type + Location.
       - metaDescription: Key highlights (<160 chars) including USP.
       - metaKeywords: Specific terms (e.g. "Paphos Villa", "Luxury Apartment", "Pool").

    OUTPUT JSON:
    {
        "goal": "SALE | RENT",
        "rentalPeriod": "String",
        "metaTitle": "String",
        "metaDescription": "String",
        "metaKeywords": "String"
    }
    `;
    const res = await callGeminiJSON(apiKey, model, prompt, "PUBLISH");
    return res.success ? res.data : { goal: "SALE" };
}


// --- HELPERS ---

async function callGeminiJSON(apiKey: string, model: string, promptText: string, stage: string, imageBase664?: string): Promise<{ success: boolean; data?: any; error?: string }> {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    console.log(`[AI][${stage}] >>> SENDING PROMPT (${promptText.length} chars)`);
    // Debug: Log first 500 chars of prompt to see context
    console.log(`[AI][${stage}] PROMPT SNIPPET: ${promptText.substring(0, 500)}...`);

    const parts: any[] = [{ text: promptText }];
    if (imageBase664) {
        parts.push({
            inline_data: {
                mime_type: "image/jpeg",
                data: imageBase664
            }
        });
    }

    try {
        const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts }] })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AI][${stage}] ERROR: ${errorText}`);
            return { success: false, error: errorText };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            console.error(`[AI][${stage}] NO TEXT RETURNED`);
            return { success: false, error: "No text returned" };
        }

        console.log(`[AI][${stage}] <<< RECEIVED RESPONSE:`);
        console.log(text); // Log full response for debugging
        console.log(`[AI][${stage}] ----------------------`);

        const parsed = parseAIJson(text);
        return { success: true, data: parsed };

    } catch (e: any) {
        console.error(`[AI][${stage}] EXCEPTION: ${e.message}`);
        return { success: false, error: e.message };
    }
}

function parseAIJson(text: string): any {
    try {
        let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const first = clean.indexOf("{");
        const last = clean.lastIndexOf("}");
        if (first !== -1 && last !== -1) {
            clean = clean.substring(first, last + 1);
        }
        return JSON.parse(clean);
    } catch (e) {
        console.error("JSON Parse Error on text:", text);
        return null;
    }
}

function sanitizeAIResponse(data: any): any {
    if (!data) return {};

    const toNumber = (val: any) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const num = parseFloat(val.replace(/[^0-9.]/g, ''));
            return isNaN(num) ? undefined : num;
        }
        return undefined;
    };

    // Apply sanitization to known numeric fields
    const numericFields = ['price', 'communalFees', 'depositValue', 'bedrooms', 'bathrooms',
        'areaSqm', 'coveredAreaSqm', 'coveredVerandaSqm', 'uncoveredVerandaSqm',
        'plotAreaSqm', 'basementSqm', 'buildYear'];

    for (const key of numericFields) {
        if (data[key] !== undefined) data[key] = toNumber(data[key]);
    }

    return data;
}
