export type WhatsAppTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export type TemplateComponentInput = {
    headerText?: string | null;
    bodyText: string;
    footerText?: string | null;
    buttons?: Array<{ type: string; text: string; url?: string; phoneNumber?: string }>;
    examples?: Record<string, string>;
};

export type TemplateValidationResult = {
    ok: boolean;
    errors: string[];
    warnings: string[];
    variables: string[];
};

const BODY_LIMIT = 1024;
const FOOTER_LIMIT = 60;
const HEADER_TEXT_LIMIT = 60;
const PROMOTIONAL_WORDS = [
    "discount",
    "offer",
    "sale",
    "deal",
    "limited time",
    "promotion",
    "newsletter",
    "new listing",
    "exclusive",
];

export function normalizeTemplateName(value: string) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_{2,}/g, "_");
}

export function extractTemplateVariables(text: string) {
    const matches = Array.from(String(text || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g));
    return Array.from(new Set(matches.map((match) => match[1]))).sort((a, b) => Number(a) - Number(b));
}

export function renderTemplatePreview(bodyText: string, examples?: Record<string, string> | null) {
    return String(bodyText || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, index) => {
        const value = examples?.[String(index)];
        return value ? String(value) : `{{${index}}}`;
    });
}

export function validateWhatsAppTemplate(input: {
    name: string;
    category: string;
    language: string;
    bodyText: string;
    headerText?: string | null;
    footerText?: string | null;
    examples?: Record<string, string> | null;
}): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = normalizeTemplateName(input.name);
    const bodyText = String(input.bodyText || "").trim();
    const headerText = String(input.headerText || "").trim();
    const footerText = String(input.footerText || "").trim();
    const category = String(input.category || "UTILITY").toUpperCase();
    const variables = extractTemplateVariables(bodyText);

    if (!name) errors.push("Template name is required.");
    if (name && !/^[a-z0-9_]+$/.test(name)) errors.push("Template name can only use lowercase letters, numbers, and underscores.");
    if (!String(input.language || "").trim()) errors.push("Language is required.");
    if (!bodyText) errors.push("Body text is required.");
    if (bodyText.length > BODY_LIMIT) errors.push(`Body text must be ${BODY_LIMIT} characters or less.`);
    if (headerText.length > HEADER_TEXT_LIMIT) errors.push(`Header text must be ${HEADER_TEXT_LIMIT} characters or less.`);
    if (footerText.length > FOOTER_LIMIT) errors.push(`Footer text must be ${FOOTER_LIMIT} characters or less.`);

    variables.forEach((variable, index) => {
        const expected = String(index + 1);
        if (variable !== expected) {
            errors.push("Template variables must be sequential, starting at {{1}}.");
        }
    });

    const examples = input.examples || {};
    variables.forEach((variable) => {
        if (!String(examples[variable] || "").trim()) {
            errors.push(`Sample value is required for {{${variable}}}.`);
        }
    });

    if (category === "UTILITY") {
        const lowerBody = bodyText.toLowerCase();
        if (PROMOTIONAL_WORDS.some((word) => lowerBody.includes(word))) {
            warnings.push("This may be classified as Marketing because it contains promotional wording.");
        }
    }

    if (category === "MARKETING" && !footerText.toLowerCase().includes("stop")) {
        warnings.push("Marketing templates should usually include an opt-out footer such as Reply STOP to opt out.");
    }

    return { ok: errors.length === 0, errors, warnings, variables };
}

export function buildWhatsAppTemplateComponents(input: TemplateComponentInput) {
    const components: any[] = [];
    const headerText = String(input.headerText || "").trim();
    const bodyText = String(input.bodyText || "").trim();
    const footerText = String(input.footerText || "").trim();
    const examples = input.examples || {};
    const variables = extractTemplateVariables(bodyText);

    if (headerText) {
        components.push({ type: "HEADER", format: "TEXT", text: headerText });
    }

    const body: any = { type: "BODY", text: bodyText };
    if (variables.length) {
        body.example = {
            body_text: [variables.map((variable) => String(examples[variable] || `Sample ${variable}`))],
        };
    }
    components.push(body);

    if (footerText) {
        components.push({ type: "FOOTER", text: footerText });
    }

    const buttons = Array.isArray(input.buttons) ? input.buttons.filter((button) => String(button?.text || "").trim()) : [];
    if (buttons.length) {
        components.push({
            type: "BUTTONS",
            buttons: buttons.map((button) => {
                const type = String(button.type || "QUICK_REPLY").toUpperCase();
                if (type === "URL") return { type, text: button.text, url: button.url || "" };
                if (type === "PHONE_NUMBER") return { type, text: button.text, phone_number: button.phoneNumber || "" };
                return { type: "QUICK_REPLY", text: button.text };
            }),
        });
    }

    return components;
}

export function extractTemplateBodyText(components: any[] | null | undefined) {
    const body = Array.isArray(components) ? components.find((component) => String(component?.type || "").toUpperCase() === "BODY") : null;
    return String(body?.text || "");
}
