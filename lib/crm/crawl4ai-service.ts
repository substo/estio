import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { AIPropertyData } from '@/app/(main)/admin/properties/import/ai-property-extraction';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PROPERTY_TYPES } from '@/lib/properties/constants';
import { FEATURE_CATEGORIES, PROPERTY_CONDITIONS } from '@/lib/properties/filter-constants';

const execPromise = util.promisify(exec);

export interface CrawlResult {
    success: boolean;
    markdown?: string;
    html?: string;
    metadata?: any;
    media?: any;
    error?: string;
}

export async function crawlPropertyWithPython(url: string, interactionSelector?: string | null): Promise<CrawlResult> {
    const scriptPath = path.join(process.cwd(), 'lib/crm/crawler/main.py');
    try {
        const selectorArg = interactionSelector ? interactionSelector : "null";
        const command = `python3 "${scriptPath}" "${url}" "${selectorArg}"`;
        const { stdout, stderr } = await execPromise(command, { maxBuffer: 1024 * 1024 * 10 });
        if (stderr && stderr.length > 0) console.log("[Crawl4AI] Stderr:", stderr);

        // Log RAW output for debugging (Increased limit to see full execution logs)
        console.log("[Crawl4AI] Raw Python Stdout (Snippet):", stdout.substring(0, 20000) + "...");

        // Extract JSON from potential stdout noise
        const start = stdout.indexOf('{');
        const end = stdout.lastIndexOf('}');
        if (start === -1 || end === -1) {
            throw new Error("No JSON object found in Python output: " + stdout.slice(0, 100));
        }
        const jsonStr = stdout.substring(start, end + 1);
        return JSON.parse(jsonStr);
    } catch (error: any) {
        console.error("Crawl4AI Execution Error:", error);
        return { success: false, error: error.message };
    }
}

import { DEFAULT_MODEL } from "@/lib/ai/pricing";

export async function scrapePropertyWithCrawl4AI(
    url: string,
    apiKey: string,
    modelName: string = DEFAULT_MODEL,
    userHints?: string,
    interactionSelector?: string | null
): Promise<AIPropertyData> {
    console.log('[Crawl4AI] Scraping ' + url + '...');

    // 1. Crawl
    const crawlResult = await crawlPropertyWithPython(url, interactionSelector);
    if (!crawlResult.success || !crawlResult.markdown) {
        throw new Error('Crawl failed: ' + (crawlResult.error || "No output"));
    }

    // Prepare Dynamic Prompt Data
    const featureKeys = FEATURE_CATEGORIES.flatMap(c => c.items.map(i => i.key));
    const featureHints = FEATURE_CATEGORIES.flatMap(c => c.items.map(i => `- ${i.key}: ${i.label}`)).join('\n');

    const subtypeHints = PROPERTY_TYPES.flatMap(c => c.subtypes.map(s => `- ${s.subtype_key}: ${s.subtype_label} (Category: ${c.category_key})`)).join('\n');

    const conditionHints = PROPERTY_CONDITIONS.map(c => `- ${c.key}`).join(', ');

    // 2. Parse with Gemini
    console.log(`[Crawl4AI] Parsing markdown with AI (Model: ${modelName})...`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });

    // Construct Prompt with constants
    let prompt = 'You are a real estate data extraction assistant.\n' +
        'Extract the following fields from the property listing markdown below.\n' +
        'Return ONLY a valid JSON object matching the scheme.\n\n' +
        'Fields:\n' +
        '- title (string)\n' +
        '- price (number)\n' +
        '- currency (string, default EUR)\n' +
        '- description (string, html is fine)\n' +
        '- buildYear (number)\n' +
        '- bedrooms (number)\n' +
        '- bathrooms (number)\n' +
        '- coveredAreaSqm (number)\n' +
        '- coveredVerandaSqm (number)\n' +
        '- uncoveredVerandaSqm (number)\n' +
        '- basementSqm (number)\n' +
        '- plotAreaSqm (number)\n' +
        '- communalFees (number)\n' +
        '- rentalPeriod (string, e.g. /month, /year)\n' +
        '- other_attributes (object): Key-value pairs of ANY other specific property details found on the page that do not fit standard fields (e.g. { "pool_depth": "2m", "solar_panels": true, "energy_class": "A", "renovation_year": 2020 }).\n' +
        '- propertyLocation (string, district)\n' +
        '- propertyArea (string, specific area)\n' +
        '- latitude (number, e.g. 34.123456) - Look for "GPS", "Coordinates", "Lat/Long" in text.\n' +
        '- longitude (number, e.g. 32.123456)\n' +
        '- features (array of strings). Choose strictly from the provided list below.\n' +
        '- type (string). Choose strictly from the subtypes list below.\n' +
        '- condition (string). Choose from: ' + conditionHints + '\n\n' +
        'Valid Subtypes:\n' + subtypeHints + '\n\n' +
        'Valid Features:\n' + featureHints + '\n\n';

    if (userHints) {
        console.log("[Crawl4AI] User Hints provided:", userHints);
        prompt += `
--------------------------------------------------------------------------------
USER OVERRIDE INSTRUCTIONS (HIGHEST PRIORITY):
The user has provided specific corrections or context. You MUST follow these over any other data found.
If the user provides an HTML snippet (e.g. <div class="...">...</div>), scan the text for similar patterns or values.
The provided snippet proves a value exists even if the markdown conversion missed it. TRUST THE USER'S VALUE or PATTERN.
User's Instructions:
"""
${userHints}
"""
--------------------------------------------------------------------------------
\n\n`;
    } else {
        console.log("[Crawl4AI] No user hints provided.");
    }

    prompt += 'Markdown Content:\n' +
        crawlResult.markdown.slice(0, 40000); // Increased limit slightly

    console.log(`[Crawl4AI] Prompt constructed. Length: ${prompt.length}`);
    console.log("[Crawl4AI] FULL PROMPT:\n", prompt); // LOGGING ADDED

    if (userHints) console.log(`[Crawl4AI] Prompt includes User Hints block.`);

    console.log("[Crawl4AI] Calling Gemini generateContent...");

    let text = "";
    try {
        const result = await model.generateContent(prompt);
        console.log("[Crawl4AI] Gemini response received.");
        text = result.response.text();
        console.log(`[Crawl4AI] Response text length: ${text.length}`);
        console.log("[Crawl4AI] FULL RESPONSE:\n", text); // LOGGING ADDED
    } catch (aiError: any) {
        console.error("[Crawl4AI] Gemini Error:", aiError);
        throw new Error("AI Parsing Failed: " + aiError.message);
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse AI response", text);
        data = {};
    }

    // 3. Map Images - UNCONDITIONAL MERGE STRATEGY
    // We collect ALL possible images from all sources and deduplicate them.
    let imageSet = new Set<string>();

    // Strategy A: Crawl4AI Media (Primary)
    if (crawlResult.media && crawlResult.media.images) {
        console.log(`[Crawl4AI] Raw media.images count: ${crawlResult.media.images.length}`);
        const mediaImgs = crawlResult.media.images || [];
        mediaImgs.forEach((img: any) => {
            const src = img.src || img;
            if (typeof src === 'string' && src.startsWith('http')) imageSet.add(src);
        });
    }

    // Strategy B: Metadata (OG Image)
    if (crawlResult.metadata) {
        const meta = crawlResult.metadata;
        const possibleKeys = ['og:image', 'image', 'twitter:image'];
        for (const key of possibleKeys) {
            if (meta[key] && typeof meta[key] === 'string' && meta[key].startsWith('http')) {
                // console.log(`[Crawl4AI] Found metadata image: ${meta[key]}`);
                imageSet.add(meta[key]);
            }
        }
    }

    // Strategy C: HTML Regex Scan (Always Run)
    // This is crucial for galleries hidden in CSS background-images (like Altia)
    if (crawlResult.html) {
        console.log("[Crawl4AI] Running HTML regex scan for images (Unconditional)...");

        // Pattern: https://d1n097d7cl303k.cloudfront.net/[^"&'\s) ]+
        const cloudfrontRegex = /https:\/\/d1n097d7cl303k\.cloudfront\.net\/[^"&'\s) ]+/gi;
        const cfMatches = crawlResult.html.match(cloudfrontRegex) || [];

        if (cfMatches.length > 0) {
            console.log(`[Crawl4AI] Found ${cfMatches.length} Cloudfront URLs in HTML.`);
            cfMatches.forEach(url => {
                let clean = url.replace('&quot;', '').replace(')', '').split(' ')[0];
                clean = clean.split('?')[0];
                imageSet.add(clean);
            });
        }

        // Generic Regex to find http(s) followed by non-quote chars ending in image extension
        const imgRegex = /(https?:\/\/[^"'\s<>)]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?)/gi;
        const matches = crawlResult.html.match(imgRegex) || [];

        // Filter and add generic matches
        matches.forEach(url => {
            if (!url.includes('favicon') &&
                !url.includes('logo') &&
                !url.includes('icon') &&
                !url.includes('svg') &&
                // Exclude the cloudfront domain we just handled specifically
                !url.includes('d1n097d7cl303k.cloudfront.net') &&
                url.length > 20) {
                // Normalize: remove query params to avoid duplicates (size variants)
                const clean = url.split('?')[0];
                imageSet.add(clean);
            }
        });
    }

    // 4. Post-Processing: Smart Deduplication (Global)
    // Filter ALL candidates from ALL strategies (media, metadata, html)
    console.log(`[Crawl4AI] Post-Processing: Filtering ${imageSet.size} candidate images...`);
    const finalImageSet = new Set<string>();
    const cfUniqueMap = new Map<string, { url: string, width: number }>();

    // Helper to decode CF url
    const processCloudfrontUrl = (url: string) => {
        try {
            // format: https://domain/BASE64_PAYLOAD
            const parts = url.split('cloudfront.net/');
            if (parts.length === 2) {
                const payload = parts[1];
                const jsonStr = Buffer.from(payload, 'base64').toString('utf-8');
                const meta = JSON.parse(jsonStr);

                if (meta.key) {
                    const width = meta.edits?.resize?.width || 0;
                    const existing = cfUniqueMap.get(meta.key);
                    // Keep if new, or if bigger than existing
                    if (!existing || width > existing.width) {
                        cfUniqueMap.set(meta.key, { url: url, width: width });
                    }
                    return true; // It was a valid CF url
                }
            }
        } catch (e) {
            // ignore
        }
        return false;
    };

    imageSet.forEach(url => {
        if (url.includes('d1n097d7cl303k.cloudfront.net')) {
            const handled = processCloudfrontUrl(url);
            if (!handled) finalImageSet.add(url); // Add as normal if decoding failed
        } else {
            finalImageSet.add(url);
        }
    });

    // Merge best CF variants
    console.log(`[Crawl4AI] Deduplicated Cloudfront variants. Unique: ${cfUniqueMap.size}`);
    Array.from(cfUniqueMap.values()).forEach(item => finalImageSet.add(item.url));

    // Convert to array and log final count
    let images = Array.from(finalImageSet);
    console.log(`[Crawl4AI] Final unique images count: ${images.length}`);

    // Safety cap to avoid overloading (optional, but good for massive pages)
    if (images.length > 100) {
        console.log("[Crawl4AI] Capping images at 100.");
        images = images.slice(0, 100);
    }

    // infer category from type if AI returned it
    let category = "house"; // default
    if (data.type) {
        // Find category for subtype
        const match = PROPERTY_TYPES.find(c => c.subtypes.some(s => s.subtype_key === data.type));
        if (match) category = match.category_key;
    }

    return {
        title: data.title || "",
        description: data.description || "",
        price: data.price || 0,
        currency: data.currency || "EUR",
        bedrooms: data.bedrooms || 0,
        bathrooms: data.bathrooms || 0,
        coveredAreaSqm: data.coveredAreaSqm || 0,
        coveredVerandaSqm: data.coveredVerandaSqm || 0,
        uncoveredVerandaSqm: data.uncoveredVerandaSqm || 0,
        basementSqm: data.basementSqm || 0,
        plotAreaSqm: data.plotAreaSqm || 0,
        buildYear: data.buildYear || 0,
        communalFees: data.communalFees || 0,
        rentalPeriod: data.rentalPeriod || "",
        metadata: data.other_attributes || {},
        addressLine1: "",
        city: data.propertyLocation || "",
        propertyLocation: data.propertyLocation || "",
        propertyArea: data.propertyArea || "",
        latitude: data.latitude,
        longitude: data.longitude,
        images: images,
        status: "ACTIVE",
        publicationStatus: "DRAFT",
        type: data.type || "detached_villa",
        category: category,
        goal: "SALE",
        features: Array.isArray(data.features) ? data.features.filter((f: string) => featureKeys.includes(f)) : [],
        condition: data.condition || "resale",
        agentRef: "",
        rawExtracted: crawlResult
    };
}
