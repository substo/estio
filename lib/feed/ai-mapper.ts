
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface FeedMappingConfig {
    rootPath?: string; // Path to the array of items (e.g. "listings.listing")
    fields: {
        externalId: string;
        title: string;
        description: string;
        price: string;
        currency: string;
        images: string; // Path to image array or single image
        // Address checks
        city?: string;
        country?: string;
        addressLine1?: string;
        // Details
        bedrooms?: string;
        bathrooms?: string;
        areaSqm?: string;
    };
}

import { DEFAULT_MODEL } from "@/lib/ai/pricing";

export class AiFeedMapper {
    static async analyzeFeedStructure(xmlSnippet: string, apiKey: string, modelName: string = DEFAULT_MODEL): Promise<FeedMappingConfig> {
        if (!apiKey) throw new Error("Google AI API Key is required");

        console.log(`[AiFeedMapper] Initializing ${modelName}...`);
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log(`[AiFeedMapper] Analyzing XML snippet length: ${xmlSnippet.length} chars`);

        const prompt = `
      You are an expert XML parser and Real Estate data specialist. 
      Analyze the following XML snippet from a property feed and suggest a mapping configuration to extract standard real estate data.
      
      The target output structure is a JSON object with JSON paths (dot notation) to the relevant fields. 
      For example:
      - "item.price"
      - "properties.property.details.bedrooms"
      - "listings.listing.images.image" (if it's a list, point to the list itself or the repeated tag)
      
      XML Snippet:
      \`\`\`xml
      ${xmlSnippet.slice(0, 10000)} 
      \`\`\`
      
      Return ONLY valid JSON corresponding to the following interface:
      {
        "rootPath": "path.to.the.list.of.items",
        "fields": {
          "externalId": "path.to.unique.id",
          "title": "path.to.title",
          "description": "path.to.description",
          "price": "path.to.price",
          "currency": "path.to.currency",
          "images": "path.to.image.list",
          "city": "path.to.city",
          "country": "path.to.country",
          "bedrooms": "path.to.bedrooms",
          "bathrooms": "path.to.bathrooms",
          "areaSqm": "path.to.area"
        }
      }
      
      If a field is not found, leave it as empty string or null.
      For "rootPath", find the repeating element that represents a single property listing. 
      Result must be valid JSON, no markdown formatting.
    `;

        try {
            console.log("[AiFeedMapper] Sending prompt to Gemini...");
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let text = response.text();

            console.log("[AiFeedMapper] Raw AI Response:", text.substring(0, 500) + "..."); // Log first 500 chars

            // Cleanup markdown if present
            text = text.replace(/```json/g, "").replace(/```/g, "").trim();

            const mapping = JSON.parse(text);
            console.log("[AiFeedMapper] Parsed Mapping:", JSON.stringify(mapping, null, 2));

            return mapping as FeedMappingConfig;
        } catch (error) {
            console.error("[AiFeedMapper] Analysis failed:", error);
            // Fallback or throw
            throw new Error("Failed to analyze feed structure.");
        }
    }
}
