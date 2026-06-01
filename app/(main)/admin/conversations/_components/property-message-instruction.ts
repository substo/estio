export type PropertyMessagePurpose = "follow_up" | "new_listing";
export type PropertyMessageLength = "short" | "medium" | "detailed";

export type PropertyMessageInstructionInput = {
    propertyUrl?: string;
    propertyText?: string;
    purpose?: PropertyMessagePurpose;
    length?: PropertyMessageLength;
    importantDetails?: string;
};

const PURPOSE_COPY: Record<PropertyMessagePurpose, string> = {
    follow_up: "Write a natural follow-up message about this property.",
    new_listing: "Write a natural new-listing notification message about this property.",
};

const LENGTH_COPY: Record<PropertyMessageLength, string> = {
    short: "Keep it brief enough for WhatsApp/SMS, around 1-3 short sentences.",
    medium: "Use a conversational medium length, around 3-5 short sentences.",
    detailed: "Include the useful property details while still sounding like a human chat message.",
};

function normalizeInstructionField(value: string | undefined, maxLength: number): string {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim()
        .slice(0, maxLength)
        .trim();
}

export function buildPropertyMessageInstruction(input: PropertyMessageInstructionInput): string {
    const purpose = input.purpose || "new_listing";
    const length = input.length || "medium";
    const propertyUrl = normalizeInstructionField(input.propertyUrl, 600);
    const propertyText = normalizeInstructionField(input.propertyText, 6000);
    const importantDetails = normalizeInstructionField(input.importantDetails, 1200);

    const sourceLines = [
        propertyUrl ? `Property URL: ${propertyUrl}` : null,
        propertyText ? `Property text:\n${propertyText}` : null,
        importantDetails ? `Agent priority details:\n${importantDetails}` : null,
    ].filter(Boolean);

    return [
        "Use the property information below to draft the exact next message the agent should send.",
        PURPOSE_COPY[purpose],
        LENGTH_COPY[length],
        "Use the existing conversation, contact requirements, language, channel, and recent context to decide what matters.",
        "If the property appears to match the lead's requirements, mention the strongest matching details conversationally.",
        "If the match is uncertain, phrase it softly and invite them to confirm interest.",
        "Do not use bullets, headings, Markdown, or a structured property summary.",
        "Do not invent missing facts, availability, prices, locations, viewings, or promises.",
        "If a URL is provided and useful, include it naturally, on its own line.",
        "",
        "Property source:",
        sourceLines.join("\n\n") || "[No property source text provided]",
    ].join("\n");
}
