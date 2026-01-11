"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

import { COMPONENT_SCHEMA } from "@/lib/ai/component-schema";
import { DESIGN_SYSTEM_PROMPT, RECOMPOSITION_PROMPT } from "@/lib/ai/prompts/design-system";

import { load } from "cheerio";

interface GenerateContentResult {
    success: boolean;
    content?: string; // Legacy support
    blocks?: any[];   // New structured blocks
    title?: string;
    slug?: string;
    error?: string;
}

export async function generateContentFromUrl(url: string, locationId?: string, brandVoiceOverride?: string, extractionModelOverride?: string): Promise<GenerateContentResult> {
    console.log("--- START AI IMPORT ---");
    console.log(`URL: ${url}`);

    const { userId } = await auth();
    if (!userId) {
        console.log("Error: Unauthorized");
        return { success: false, error: "Unauthorized" };
    }

    try {
        let targetLocationId = locationId;

        // If no locationId provided, resolve from user (simplistic single-tenant logic per existing patterns)
        if (!targetLocationId) {
            const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
            targetLocationId = user?.locations[0]?.id;
            console.log(`Resolved Location ID: ${targetLocationId}`);
        }

        if (!targetLocationId) {
            console.log("Error: No Location Found");
            return { success: false, error: "No Location found for user." };
        }

        // 1. Fetch Site Config for API Key
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId: targetLocationId },
        });

        // Cast to any for new props
        const configAny = siteConfig as any;

        if (!configAny?.googleAiApiKey) {
            console.log("Error: No API Key");
            return { success: false, error: "Google AI API Key is not configured in AI Settings." };
        }

        // 2. Scrape URL
        console.log("Step 2: Scraping URL...");
        // Note: In a real prod env, we might need a proxy or headless browser for some sites.
        // For now, we use simple fetch.
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            next: { revalidate: 0 } // No cache
        });

        if (!response.ok) {
            console.log(`Error: Fetch failed ${response.status}`);
            return { success: false, error: `Failed to fetch URL: ${response.statusText}` };
        }

        const html = await response.text();
        console.log(`Scraped HTML Length: ${html.length} chars`);

        // Use Cheerio for robust parsing and cleaning
        const $ = load(html);

        // Remove clutter elements that distract the AI
        $('script').remove();
        $('style').remove();
        $('noscript').remove();
        $('svg').remove();
        $('header').remove();
        $('footer').remove();
        $('nav').remove();
        $('[role="banner"]').remove(); // Common for headers
        $('[role="navigation"]').remove();
        $('[role="contentinfo"]').remove(); // Common for footers

        // Remove common classes/IDs often used for headers/footers if semantic tags weren't used
        $('.header').remove();
        $('.footer').remove();
        $('.nav').remove();
        $('.navigation').remove();
        $('.menu').remove();
        $('#header').remove();
        $('#footer').remove();
        $('#nav').remove();
        $('#navigation').remove();
        $('.cookie-consent').remove();
        $('.popup').remove();
        $('.modal').remove();

        // Get the cleaned body content
        // distinct from simply getting text(), we want the HTML structure so the AI can infer headings, lists, etc.
        let cleanContent = $('body').html() || "";

        // Fallback if body extraction failed or was empty (e.g. if the whole page was in a div)
        if (!cleanContent || cleanContent.trim().length === 0) {
            cleanContent = $.html();
        }

        // Additional cleanup of comments and excessive whitespace (optional, but good for token saving)
        cleanContent = cleanContent.replace(/<!--[\s\S]*?-->/g, "");

        // Truncate if still too large, but 100k chars is a generous limit usually
        cleanContent = cleanContent.slice(0, 100000);

        console.log(`Cleaned Content Length: ${cleanContent.length} chars`);

        // 3. Prepare Prompt
        const theme = (configAny.theme as any) || {};
        const brandName = theme.logo?.textTop || "Our Agency";
        const brandTagline = theme.logo?.textBottom || "";
        const primaryColor = theme.primaryColor || "#000000";
        // Infer a palette description based on primary color (rudimentary heuristic)
        // In a real app we might have a specific "mood" field
        const designMood = "Modern & Professional";

        // 4. Call Gemini API
        // STAGE 1 CHOICE: Extraction Model (Default to Flash for speed if not set)
        const model = extractionModelOverride || configAny.googleAiModelExtraction || configAny.googleAiModel || "gemini-2.5-flash";

        // Use brand voice from settings, or fallback to default
        const globalBrandVoice = configAny.brandVoice || "Professional, Trustworthy, Modern";

        // Allow per-request override if we implement that UI later, otherwise use global
        const finalBrandVoice = brandVoiceOverride || globalBrandVoice;

        console.log(`Extraction Model: ${model}`);
        console.log(`Design Target Model: ${configAny.googleAiModelDesign || "default"}`);

        // ... (Rest of scraping prompt logic, but we might want to split design? 
        // For now, let's keep the "Import" as a "One Shot" that uses the Extraction model to get the structure, 
        // but maybe we should use the Design model if it is a full rebuild?
        // actually, the USER requested "First import text... second rebuild".
        // So for "generateContentFromUrl", we should probably use the DESIGN model if we want the result to look good immediately.
        // OR, we use the Extraction model to get the data, then pass it to the Design model.
        // Let's implement the "One Shot" to use the DESIGN model for the prompt generation to ensure quality on first try,
        // BUT respecting the user's wish to split, we can create the second action below.)

        // REVISION: The prompt below is the "Design Director" prompt. 
        // To strictly follow "Stage 1 extraction", we might use a cheaper model here. 
        // But for "One Click Import", using the better model is usually preferred. 
        // Let's stick to the high-quality prompt but let the user override the model via the "Design" setting if they want.

        // Actually, let's use the DESIGN model for this main function because it outputs the final blocks.
        // The "Extraction" model is theoretically for just Raw Text -> JSON, but we are skipping that step in this single function.
        // Let's use the Design Link.
        const activeModel = extractionModelOverride || configAny.googleAiModelDesign || "gemini-2.5-flash";

        console.log(`Active Model: ${activeModel}`);
        console.log(`Brand Voice: ${finalBrandVoice}`);
        console.log(`Design System: ${primaryColor}, ${brandName}`);

        const prompt = `
        You are an expert web developer AND **High-End UI/UX Designer** using the ${activeModel}.
        
        GOAL: Analyze the Source URL content and rebuild it using our Component Blocks.
        **DESIGN GOAL:** The output must not just be structured, it must be **Visually Stunning** and match our Brand Identity.
        
        CONTEXT:
        Brand Name: "${brandName}"
        Tagline: "${brandTagline}"
        Brand Voice: "${finalBrandVoice}"
        Source URL: ${url}
        
        DESIGN SYSTEM:
        - Primary Color: ${primaryColor}
        - Mood: ${designMood}

        ${DESIGN_SYSTEM_PROMPT}
        
        - Strategy: Use the "theme" property to complement this primary color.
          - If the content is "heavy" or "exclusive", use "dark" theme.
          - If the content is "informative" or "trust", use "light".
          - If trying to highlight the brand, use "brand-solid".
        
        ${COMPONENT_SCHEMA}

        SOURCE CONTENT (Scraped HTML snippet):
        ${cleanContent.substring(0, 30000)} ... [truncated]

        INSTRUCTIONS:
        1. **Analyze Structure:** Look at the source content's layout.
        2. **Map to Blocks:** Select the most appropriate component.
        3. **Design & animate:** 
           - Assign an **"animation"** property (e.g., "fade-up") to EVERY block.
           - Assign a **"theme"** property to vary visual interest.
        4. **Content Engineering (CRITICAL):**
           - **Badges:** Use the "badge" property for short, uppercase "kickers" above headlines (e.g., "WHY CHOOSE US", "EXPERIENCE LUXURY").
           - **Highlights:** In "headline" or "title" fields, wrap key emphasis words in \`<span class="text-primary">\` marks. (e.g., "Sell With <span class='text-primary'>Confidence</span>").
           - **Copy:** Rewrite distinct blocks to be PUNCHY and PREMIUM. Avoid walls of text.
        
        OUTPUT FORMAT:
        Return ONLY a valid JSON object. Do not include markdown code blocks.
        `;

        console.log("--- AI IMPORT PROMPT ---");
        console.log("Model:", activeModel);
        console.log(prompt);
        console.log("------------------------");

        console.log("Sending Prompt to Gemini...");

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${configAny.googleAiApiKey}`;

        const aiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.log(`Gemini API Error: ${errorText}`);
            // Fallback: If Flash/Pro fails, strict error
            return { success: false, error: `Gemini API Error: ${errorText}` };
        }

        const aiData = await aiResponse.json();
        const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) {
            console.log("Error: No generated text found.");
            return { success: false, error: "No content generated from AI." };
        }

        console.log("Gemini Response Received. Length: " + generatedText.length);
        console.log("--- AI IMPORT RAW RESPONSE ---");
        console.log(generatedText);
        console.log("------------------------------");

        // ... (Parsing logic remains the same) ...
        // 5. Robust Parsing Logic
        let jsonString = generatedText;

        // A. Try extracting from custom markers
        const markersMatch = generatedText.match(/___JSON_START___([\s\S]*?)___JSON_END___/);
        if (markersMatch && markersMatch[1]) {
            jsonString = markersMatch[1];
        }
        // B. Try extracting from Markdown block
        else {
            const markdownMatch = generatedText.match(/```json([\s\S]*?)```/);
            if (markdownMatch && markdownMatch[1]) {
                jsonString = markdownMatch[1];
            } else {
                // C. Last resort: Try finding the first '{' and last '}'
                const firstBrace = generatedText.indexOf('{');
                const lastBrace = generatedText.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    jsonString = generatedText.substring(firstBrace, lastBrace + 1);
                }
            }
        }

        try {
            const parsed = JSON.parse(jsonString);
            console.log("JSON Parsed Successfully.");

            // 6. Normalize Blocks (Flatten 'properties' if present)
            const normalizedBlocks = parsed.blocks?.map((block: any) => {
                if (block.properties) {
                    return {
                        ...block.properties,
                        type: block.type,
                        animation: block.animation || block.properties.animation,
                        theme: block.theme || block.properties.theme
                    };
                }
                return block;
            }) || [];

            console.log(`Title: ${parsed.title}`);
            console.log(`Blocks Found: ${normalizedBlocks.length}`);

            // 7. Process Images (Upload to Cloudflare) - This is mostly "Stage 1" data gathering
            console.log("Step 7: Processing & Uploading Images...");
            const processedBlocks = await processBlockImages(normalizedBlocks);

            return {
                success: true,
                blocks: processedBlocks,
                title: parsed.title,
                slug: parsed.slug,
                content: ""
            };
        } catch (e) {
            console.error("JSON Parse Error", e);
            console.log("Raw Text was: ", generatedText);
            return { success: false, error: "Failed to parse AI response." };
        }

    } catch (error: any) {
        console.error("AI Import Error:", error);
        return { success: false, error: error.message || "Unknown error occurred" };
    }
}

// STAGE 2: Rebuild / Visual Engine
export async function regeneratePageDesign(currentBlocks: any[], locationId: string, brandVoiceOverride?: string, designModelOverride?: string, promptOverride?: string): Promise<{ success: boolean; blocks?: any[]; error?: string }> {
    console.log("--- START STAGE 2: DESIGN REGEN ---");
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const configAny = siteConfig as any;
        if (!configAny?.googleAiApiKey) return { success: false, error: "No API Key" };

        const model = designModelOverride || configAny.googleAiModelDesign || "gemini-2.5-flash";
        const theme = (configAny.theme as any) || {};
        const brandName = theme.logo?.textTop || "Brand";
        const brandTagline = theme.logo?.textBottom || "";
        const primaryColor = theme.primaryColor || "#000000";
        const finalBrandVoice = brandVoiceOverride || configAny.brandVoice || "Professional, Trustworthy";

        console.log(`Design Model: ${model}`);

        // Construct a simplified content representation to save tokens but keep info
        // We strip out existing style props to force a redesign
        const contentForAi = currentBlocks.map(b => {
            const { animation, theme, styles, ...content } = b;
            return content;
        });

        const prompt = `
        You are an expert **High-End UI/UX Designer** and Content Strategist.
        
        GOAL: Tak the PROVIDED JSON BLOCKS (Content) and redesign them into a **Visually Stunning** experience using our Component Schema.
        
        CONTEXT:
        Brand: ${brandName} (${brandTagline})
        Voice: ${finalBrandVoice}
        Primary Color: ${primaryColor}

        ${DESIGN_SYSTEM_PROMPT}

        ${RECOMPOSITION_PROMPT}
        
        ${COMPONENT_SCHEMA}

        EXISTING CONTENT (JSON):
        ${JSON.stringify(contentForAi, null, 2)}

        INSTRUCTIONS (VISUAL ENGINE):
        1. **Retain Information:** Keep the core meaning (titles, prices, counts) of the provided blocks, but you MAY split or merge them if it improves layout.
        2. **Upgrade Components:** 
           - If a "Rich Text" block looks like a list, convert it to "Features".
           - If a block is a "Hero", make sure it has a "Badge".
        3. **Apply Premium Styling:**
           - **Badges:** Add "badge" properties (uppercase kickers) to Heros and Categories.
           - **Highlights:** Add \`<span class="text-primary">\` to key words in headlines.
           - **Layouts:** Use "split-left" / "split-right" for alternating sections.
           - **Animations:** Ensure every block has an entrance animation.

        ${promptOverride ? `
        4. **USER OVERRIDE INSTRUCTIONS (PRIORITY):**
           "${promptOverride}"
           (Follow these instructions above all others.)
        ` : ""}
        
        OUTPUT FORMAT:
        Return ONLY valid JSON with the new "blocks" array.
        { "blocks": [ ... ] }
        `;

        console.log("--- AI DESIGN REGEN PROMPT ---");
        console.log("Model:", model);
        console.log(prompt);
        console.log("------------------------------");

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configAny.googleAiApiKey}`;

        const aiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!aiResponse.ok) {
            return { success: false, error: await aiResponse.text() };
        }

        const aiData = await aiResponse.json();
        const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log("--- AI DESIGN REGEN RAW RESPONSE ---");
        console.log(generatedText);
        console.log("------------------------------------");

        if (!generatedText) return { success: false, error: "No design generated." };

        let jsonString = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
        // A. Try extracting from custom markers
        const markersMatch = generatedText.match(/___JSON_START___([\s\S]*?)___JSON_END___/);
        if (markersMatch && markersMatch[1]) {
            jsonString = markersMatch[1];
        }
        // Basic cleanup if pure json wasn't returned
        if (jsonString.startsWith("json")) jsonString = jsonString.slice(4).trim();
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(jsonString);

        // Flatten properties if nested (hallucination check)
        const normalizedBlocks = (parsed.blocks || []).map((block: any) => {
            if (block.properties) return { ...block.properties, type: block.type };
            return block;
        });

        // We do typically process images again to ensure any new placeholders are handled, 
        // though usually we just preserved URLs.
        // Let's run it just in case the AI added a placeholder.
        const processedBlocks = await processBlockImages(normalizedBlocks);

        console.log(`--- DESIGN REGEN SUCCESS ---`);
        console.log(`Original Blocks: ${currentBlocks.length}`);
        console.log(`New Blocks: ${processedBlocks.length}`);
        console.log(`----------------------------`);

        return { success: true, blocks: processedBlocks };

    } catch (e: any) {
        console.error("Design Regen Error:", e);
        return { success: false, error: e.message };
    }
}

// Helper to iterate blocks and upload images
async function processBlockImages(blocks: any[]): Promise<any[]> {
    const { uploadToCloudflare, getImageDeliveryUrl } = await import("@/lib/cloudflareImages");

    // Recursive function to find and replace image URLs
    const processObject = async (obj: any): Promise<any> => {
        if (!obj || typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
            return Promise.all(obj.map(item => processObject(item)));
        }

        const newObj = { ...obj };

        // Define fields that contain image URLs per block type or generic convention
        // Common fields: 'image', 'avatarUrl', 'icon' (if url), 'images' (array)
        const imageFields = ['image', 'avatarUrl', 'backgroundImage']; // Added backgroundImage just in case

        for (const key of Object.keys(newObj)) {
            const value = newObj[key];

            // Handle specific fields known to be images
            if (imageFields.includes(key) && typeof value === 'string' && value.startsWith('http')) {
                const cloudflareUrl = await handleImageUpload(value, uploadToCloudflare, getImageDeliveryUrl);
                if (cloudflareUrl) newObj[key] = cloudflareUrl;
            }
            // Handle 'images' array (Gallery)
            else if (key === 'images' && Array.isArray(value)) {
                newObj[key] = await Promise.all(value.map(async (url: any) => {
                    if (typeof url === 'string' && url.startsWith('http')) {
                        return (await handleImageUpload(url, uploadToCloudflare, getImageDeliveryUrl)) || url;
                    }
                    return url;
                }));
            }
            // Handle Features 'icon' - could be URL or string. simplistic check.
            else if (key === 'icon' && typeof value === 'string' && value.startsWith('http')) {
                const cloudflareUrl = await handleImageUpload(value, uploadToCloudflare, getImageDeliveryUrl);
                if (cloudflareUrl) newObj[key] = cloudflareUrl;
            }
            // Recurse for nested objects (like items array)
            else if (typeof value === 'object') {
                newObj[key] = await processObject(value);
            }
        }
        return newObj;
    };

    return Promise.all(blocks.map(block => processObject(block)));
}

async function handleImageUpload(
    url: string,
    uploader: (file: File | Blob) => Promise<{ uploadURL: string; imageId: string }>,
    urlGenerator: (id: string, variant?: string) => string
): Promise<string | null> {
    try {
        console.log(`Fetching image: ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);

        const blob = await res.blob();
        console.log(`Uploading to Cloudflare (${blob.size} bytes)...`);

        const { imageId } = await uploader(blob);
        const deliveryUrl = urlGenerator(imageId);
        console.log(`Generated Cloudflare URL: ${deliveryUrl}`);
        return deliveryUrl;

    } catch (error) {
        console.error(`Failed to process image ${url}:`, error);
        return null; // Keep original URL on error
    }
}

export async function generateBrandVoiceFromSite(locationId: string, websiteUrl?: string): Promise<{ success: boolean; voice?: string; error?: string }> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    try {
        // 1. Fetch Site Config
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId },
        });

        const configAny = siteConfig as any;

        if (!configAny?.googleAiApiKey) {
            return { success: false, error: "Google AI API Key is not configured." };
        }

        const targetUrl = websiteUrl || (configAny.domain ? `https://${configAny.domain}` : null);

        if (!targetUrl) {
            return { success: false, error: "No URL provided or Domain configured." };
        }

        // 2. AI Research & Generation (Using Google Search Grounding)
        const model = configAny.googleAiModel || "gemini-2.5-flash";

        // Use provided URL or domain as the search anchor
        const searchQuery = targetUrl || configAny.domain || "Brand Name";

        const prompt = `
        ROLE: You are an expert Brand Strategist.
        
        TASK: Research the company associated with: "${searchQuery}".
        1. "Browse" the web (using your tools) to understand who they are, what they do, their reputation, and their market positioning (Luxury? Affordable? Corporate? Friendly?).
        2. Based on this research, write a PRECISE "System Instruction" that captures their specific Brand Voice.
        
        GOAL: The output will be used to instruct an AI Assistant to write content for this company.
        
        {
          "instruction": "You are the voice of [Brand Name]..."
        }
        `;

        console.log("--- AI BRAND VOICE PROMPT ---");
        console.log("Model:", model);
        console.log(prompt);
        console.log("-----------------------------");

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configAny.googleAiApiKey}`;

        const aiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                tools: [{ google_search: {} }] // Use modern tool syntax
            })
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            return { success: false, error: `Gemini API Error: ${errorText}` };
        }

        const aiData = await aiResponse.json();
        const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log("--- AI BRAND VOICE RAW RESPONSE ---");
        console.log(generatedText);
        console.log("-----------------------------------");

        // Parse JSON output
        if (generatedText) {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.instruction) {
                        return { success: true, voice: parsed.instruction };
                    }
                } catch (e) {
                    console.error("JSON Parse Error", e);
                }
            }
            // Fallback if JSON parsing fails but text exists
            return { success: true, voice: generatedText.replace(/```json/g, "").replace(/```/g, "").trim() };
        }

        return { success: false, error: "No voice generated." };

    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function refineBlockContent(currentBlock: any, instruction: string, locationId: string): Promise<{ success: boolean; block?: any; error?: string }> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const configAny = siteConfig as any;

        if (!configAny?.googleAiApiKey) return { success: false, error: "Google AI API Key not configured." };

        const model = configAny.googleAiModel || "gemini-2.5-flash";

        const theme = (configAny.theme as any) || {};
        const primaryColor = theme.primaryColor || "#000000";
        const brandName = theme.logo?.textTop || configAny.domain || "Brand";

        const prompt = `
        ROLE: JSON Content Editor.

        TASK: Update the JSON block below based on the USER INSTRUCTION. 
        
        CONTEXT:
        - Brand: "${brandName}" (Primary Color: ${primaryColor})
        - Brand Voice: "${configAny.brandVoice || "Professional"}"

        USER INSTRUCTION:
        "${instruction}"

        CURRENT JSON:
        ${JSON.stringify(currentBlock, null, 2)}

        RULES:
        1. RETURN ONLY VALID JSON. No markdown, no explanations.
        2. Do NOT change the structure or 'type' unless explicitly asked.
        3. Edit text/values to match the instruction.
        4. Use '\\n' for line breaks in text fields.
        5. If asked for colors, prefer the Primary Color: ${primaryColor}.
        6. **CUSTOM COLORS:** If the user asks for a specific color (e.g. "make bg red", "use hex #123"), SET the 'styles' property:
           Example: "styles": { "backgroundColor": "#ff0000" } (Do not rely on 'theme' for custom colors).

        RESPONSE FORMAT:
        { ...updated block json... }
        `;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configAny.googleAiApiKey}`;

        console.log("--- AI REFINEMENT REQUEST ---");
        console.log("Instruction:", instruction);
        console.log("Block Type:", currentBlock.type);
        console.log("FULL PROMPT:\n", prompt);
        console.log("----------------------------");

        const aiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!aiResponse.ok) {
            const err = await aiResponse.text();
            console.log("AI API ERROR:", err);
            return { success: false, error: `AI Error: ${err}` };
        }

        const aiData = await aiResponse.json();
        const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log("--- AI REFINEMENT RESPONSE ---");
        console.log("Raw Output Length:", generatedText?.length);
        console.log("RAW OUTPUT:\n", generatedText);
        console.log("------------------------------");

        if (!generatedText) return { success: false, error: "No response from AI." };

        // Clean JSON
        let jsonString = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
        if (jsonString.startsWith("json")) jsonString = jsonString.slice(4).trim();

        try {
            const newBlock = JSON.parse(jsonString);
            return { success: true, block: newBlock };
        } catch (e) {
            console.error("JSON Parse Error", e);
            return { success: false, error: "Failed to parse AI response." };
        }

    } catch (error: any) {
        console.error("Refine Block Error:", error);
        return { success: false, error: error.message };
    }
}

export async function generateSiteTheme(
    locationId: string,
    instruction: string,
    currentConfig: any,
    researchUrl?: string
): Promise<{ success: boolean; theme?: any; error?: string }> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        // Cast to any to access new fields if types aren't updated
        const configAny = siteConfig as any;

        if (!configAny?.googleAiApiKey) return { success: false, error: "Google AI API Key not configured." };

        const model = configAny.googleAiModel || "gemini-2.5-flash";

        let scrapedContext = "";
        if (researchUrl) {
            console.log(`Researching Theme from: ${researchUrl}`);
            try {
                const response = await fetch(researchUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0' },
                    next: { revalidate: 0 }
                });
                if (response.ok) {
                    const html = await response.text();
                    const bodyContent = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
                    scrapedContext = bodyContent
                        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gmi, "")
                        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gmi, "")
                        .replace(/<!--[\s\S]*?-->/g, "")
                        .slice(0, 15000); // Limit context
                }
            } catch (e) {
                console.warn("Theme Research Scrape Failed:", e);
            }
        }

        const prompt = `
        ROLE: Expert Brand Designer & Web Architect.
        
        TASK: Generate a website theme configuration.
        ${researchUrl ? `
        SOURCE MATERIAL:
        Analyze the style, colors, and branding of the provided website content below.
        EXTRACT the key visual identity (Brand Name, Tagline, Primary Color, Hero Copy) from this source.
        ` : `
        BASIS: Generate based on the USER INSTRUCTION.
        `}
        
        USER INSTRUCTION:
        "${instruction}"
        
        CURRENT CONFIG (For Context):
        ${JSON.stringify({
            brandName: currentConfig.brandName,
            brandTagline: currentConfig.brandTagline,
            primaryColor: currentConfig.primaryColor,
            heroHeadline: currentConfig.heroHeadline,
            heroSubheadline: currentConfig.heroSubheadline,
            brandVoice: configAny.brandVoice
        }, null, 2)}

        ${scrapedContext ? `
        SCRAPED SITE CONTENT (Source of Truth for "Research"):
        ${scrapedContext}
        ` : ""}
        
        GUIDELINES:
        1.  ${researchUrl ? "Prioritize the SCRAPED CONTENT for Brand Name, Tagline, and Colors." : "Analyze the user's request."}
        2.  Suggest:
            -   **Brand Name** (if found in source or compatible with request).
            -   **Tagline** (catchy, relevant).
            -   **Primary Color** (Hex code. If researching, find the dominant brand color).
            -   **Hero Headline** (Engaging H1).
            -   **Hero Subheadline** (Compelling value prop).
        3.  Reflect the "Brand Voice" if available.
        
        OUTPUT FORMAT (Strict JSON):
        {
          "brandName": "String",
          "brandTagline": "String",
          "primaryColor": "Hex String (e.g. #ff0000)",
          "heroHeadline": "String",
          "heroSubheadline": "String"
        }
        
        RETURN ONLY VALID JSON. No markdown.
        `;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configAny.googleAiApiKey}`;

        console.log("--- AI THEME GENERATION REQUEST ---");
        console.log("Instruction:", instruction);
        console.log("Research URL:", researchUrl);
        console.log("FULL PROMPT:\n", prompt);
        console.log("-----------------------------------");

        const aiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!aiResponse.ok) {
            const err = await aiResponse.text();
            console.error("AI Theme Error:", err);
            return { success: false, error: `AI Error: ${err}` };
        }

        const aiData = await aiResponse.json();
        const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log("--- AI THEME RESPONSE ---");
        console.log("RAW OUTPUT:\n", generatedText);
        console.log("-------------------------");

        if (!generatedText) return { success: false, error: "No response from AI." };

        let jsonString = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
        if (jsonString.startsWith("json")) jsonString = jsonString.slice(4).trim();

        try {
            const theme = JSON.parse(jsonString);
            return { success: true, theme };
        } catch (e) {
            console.error("JSON Parse Error", e);
            return { success: false, error: "Failed to parse AI response." };
        }

    } catch (error: any) {
        console.error("Theme Gen Error:", error);
        return { success: false, error: error.message };
    }
}
// STAGE 3: AI Section Generator
export async function generateSectionFromPrompt(
    locationId: string,
    prompt: string,
    imageUrl?: string,
    brandVoiceOverride?: string,
    modelOverride?: string
): Promise<{ success: boolean; blocks?: any[]; error?: string }> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    try {
        const siteConfig = await db.siteConfig.findUnique({ where: { locationId } });
        const configAny = siteConfig as any;

        if (!configAny?.googleAiApiKey) return { success: false, error: "Google AI API Key not configured." };

        const model = modelOverride || configAny.googleAiModelDesign || "gemini-2.5-flash";

        const theme = (configAny.theme as any) || {};
        const primaryColor = theme.primaryColor || "#000000";
        const brandName = theme.logo?.textTop || "Our Brand";
        const finalBrandVoice = brandVoiceOverride || configAny.brandVoice || "Professional, Trustworthy";

        console.log(`Generating Section with Model: ${model}`);
        console.log(`Prompt: ${prompt}`);

        const systemPrompt = `
        You are an expert **Web Designer & Developer**.
        
        GOAL: Generate a VALID JSON array of website blocks based on the USER PROMPT.
        
        CONTEXT:
        Brand: "${brandName}"
        Voice: "${finalBrandVoice}"
        Primary Color: ${primaryColor}

        ${DESIGN_SYSTEM_PROMPT}
        
        ${COMPONENT_SCHEMA}

        USER REQUEST:
        "${prompt}"
        ${imageUrl ? `\nREFERENCE IMAGE URL: ${imageUrl}\n(Use this image as visual inspiration for layout and tone if accessible, otherwise infer from context)` : ""}

        INSTRUCTIONS:
        1. Select the BEST component type (hero, features, testimonials, etc.) for the request.
        2. Create the JSON Structure.
        3. Fill with **High-Quality, Engaging Copy** matching the Brand Voice.
        4. Apply Styling:
           - Use 'theme' property (light, dark, brand-solid).
           - Add 'animation' property (fade-up, fade-in).
           - Add 'badge' if appropriate (e.g. for a Hero or Special Feature).
        5. If the user asks for a specific layout (e.g. "split"), use the 'layout' property.
        
        OUTPUT FORMAT:
        Return ONLY valid JSON.
        {
          "blocks": [ ... ]
        }
        `;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configAny.googleAiApiKey}`;

        // Prepare content parts. If we had the image bytes we could send inline_data, 
        // but for now we just pass the prompt text. 
        // Note: For true image analysis, we'd need to fetch the image and send base64, 
        // or use a model with tools enabled. 
        // For this iteration, we treat the URL as text context.

        const requestBody = {
            contents: [{
                parts: [{ text: systemPrompt }]
            }]
        };

        const aiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        if (!aiResponse.ok) {
            return { success: false, error: await aiResponse.text() };
        }

        const aiData = await aiResponse.json();
        const generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) return { success: false, error: "No content generated." };

        // Clean JSON
        let jsonString = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(jsonString);

        // Normalize
        const normalizedBlocks = (parsed.blocks || []).map((block: any) => {
            const baseBlock = block.properties ? { ...block.properties, type: block.type } : block;
            return {
                ...baseBlock,
                id: crypto.randomUUID()
            };
        });

        // Process Images (if AI hallucinated placeholders)
        const processedBlocks = await processBlockImages(normalizedBlocks);

        return { success: true, blocks: processedBlocks };

    } catch (e: any) {
        console.error("Generate Section Error:", e);
        return { success: false, error: e.message };
    }
}
