export type PropertyMessagePurpose = "follow_up" | "new_listing";
export type PropertyMessageLength = "short" | "medium" | "detailed";

export type PropertyMessageInstructionInput = {
    propertyUrl?: string;
    propertyUrls?: string[];
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
    short: "Keep it brief enough for WhatsApp/SMS: 2-3 short chat lines.",
    medium: "Use a conversational medium length: 3-4 short chat lines, not one paragraph.",
    detailed: "Include the useful property details while still using short chat lines instead of a bulky paragraph.",
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
    const length = input.length || "short";
    const propertyUrls = [
        ...(input.propertyUrls || []),
        input.propertyUrl || "",
    ]
        .map((url) => normalizeInstructionField(url, 600))
        .filter(Boolean)
        .filter((url, index, urls) => urls.indexOf(url) === index);
    const propertyText = normalizeInstructionField(input.propertyText, 10000);
    const importantDetails = normalizeInstructionField(input.importantDetails, 1200);
    const isOptionsMessage = propertyUrls.length > 1;

    const sourceLines = [
        propertyUrls.length === 1 ? `Property URL: ${propertyUrls[0]}` : null,
        propertyUrls.length > 1 ? `Property URLs:\n${propertyUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")}` : null,
        propertyText ? `Property text:\n${propertyText}` : null,
        importantDetails ? `Agent priority details:\n${importantDetails}` : null,
    ].filter(Boolean);

    return [
        "Use the property information below to draft the exact next message the agent should send.",
        PURPOSE_COPY[purpose],
        LENGTH_COPY[length],
        "Use the existing conversation, contact requirements, language, channel, and recent context to decide what matters.",
        isOptionsMessage ? "When there are multiple properties, write one natural options message that helps the client compare them without sounding like a report." : null,
        "If the property appears to match the lead's requirements, mention the strongest matching details conversationally.",
        "If the match is uncertain, phrase it softly and invite them to confirm interest.",
        "Write in WhatsApp/SMS style: each idea on its own short line, with natural line breaks between the hook, key details, next step, and link.",
        "Never return one bulky paragraph. Do not put more than 1-2 short sentences on the same line or paragraph.",
        "For a new-listing message, use this mini-story shape: quick personal hook, 2-3 key facts, one light benefit only if useful, then a clear CTA and the URL on its own line.",
        "State property facts first and benefits lightly. Avoid brochure language, over-explaining investment logic, or salesy claims.",
        "Use natural texting phrasing where it fits, such as thought you might like this, worth a look, interested in this one, or fancy a look.",
        "Use at most one simple emoji only if it fits the current conversation tone.",
        "Do not use bullets, headings, Markdown, numbered lists, or a structured property summary.",
        "Do not invent missing facts, availability, prices, locations, viewings, or promises.",
        "If a URL is provided and useful, include it naturally, on its own line after a blank line.",
        "",
        "Property source:",
        sourceLines.join("\n\n") || "[No property source text provided]",
    ].join("\n");
}
