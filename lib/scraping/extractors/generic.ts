import { RawListing } from '../listing-scraper';
import { GoogleGenerativeAI } from '@google/generative-ai';
import db from '@/lib/db';

/**
 * Generic AI Extractor Strategy
 * Falls back to sending raw HTML/Text to Gemini to extract JSON matching RawListing.
 * We fetch the default site config for the model.
 */
export async function extractGenericAI(content: string, url: string, customInstructions: string): Promise<RawListing[]> {
    console.log(`[GenericAIExtractor] Processing with AI extraction...`);

    // Fetch site config for API Keys
    const siteConfig = await db.siteConfig.findFirst();
    if (!siteConfig || !siteConfig.googleAiApiKey) {
        throw new Error('Google AI API Key not configured in Site Settings.');
    }

    const genAI = new GoogleGenerativeAI(siteConfig.googleAiApiKey);
    const model = genAI.getGenerativeModel({ model: siteConfig.googleAiModelExtraction || 'gemini-1.5-flash' });

    // Strip HTML to reduce token footprint massively
    // Simple regex strip (cheerio is better but regex is faster for AI text prep)
    const strippedContent = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // remove styles
                                   .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // remove scripts
                                   .replace(/<[^>]+>/g, ' ')                        // remove tags
                                   .replace(/\s+/g, ' ')                            // collapse whitespace
                                   .substring(0, 50000);                            // Truncate to avoid massive payloads

    const systemPrompt = `
You are a Real Estate Data Extraction System.
I will provide you with the raw text of a property listing webpage.
Your job is to identify property listings on this page. If it is a search results page, there may be multiple. If it's a detail page, there is one.

Return ONLY a strictly formatted JSON array of listing objects matching this exact schema:
[
  {
    "externalId": "String (Unique ID from the page if visible, otherwise generate one)",
    "title": "String",
    "description": "String (Short summary)",
    "price": Number (integer),
    "currency": "String (EUR, USD, GBP)",
    "location": "String",
    "propertyType": "String",
    "listingType": "String (sale or rent)",
    "ownerName": "String (if found)",
    "ownerPhone": "String (if found)",
    "ownerEmail": "String (if found)"
  }
]

Custom instructions from the user to help locate elements:
${customInstructions}

Raw Page Content:
${strippedContent}
`;

    try {
        const result = await model.generateContent(systemPrompt);
        let textResult = result.response.text();
        
        // Strip markdown blocks if the AI returned them
        if (textResult.includes('```json')) {
            textResult = textResult.replace(/```json/g, '').replace(/```/g, '');
        }

        const parsedJson: RawListing[] = JSON.parse(textResult);
        
        // Embellish the array with the known base source URL 
        return parsedJson.map(listing => ({
            ...listing,
            url: url // we only have the index URL context here unless AI found hrefs
        }));

    } catch (e: any) {
        console.error(`[GenericAIExtractor] AI Extraction failed:`, e.message);
        return [];
    }
}
