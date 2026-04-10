import { z } from "zod";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";

export const PROPERTY_PRINT_TEMPLATE_IDS = [
    "a4-property-sheet",
    "a4-photo-heavy",
    "a3-poster-split",
] as const;

export type PropertyPrintTemplateId = typeof PROPERTY_PRINT_TEMPLATE_IDS[number];
export type PropertyPrintPaperSize = "A4" | "A3";
export type PropertyPrintOrientation = "portrait" | "landscape";

export const PROPERTY_PRINT_TEMPLATES: Array<{
    id: PropertyPrintTemplateId;
    label: string;
    description: string;
    paperSizes: PropertyPrintPaperSize[];
    defaultPaperSize: PropertyPrintPaperSize;
    defaultOrientation: PropertyPrintOrientation;
    imageSlots: number;
  }> = [
    {
        id: "a4-property-sheet",
        label: "A4 Property Sheet",
        description: "Balanced A4 brochure with one hero image and supporting facts.",
        paperSizes: ["A4"],
        defaultPaperSize: "A4",
        defaultOrientation: "portrait",
        imageSlots: 3,
    },
    {
        id: "a4-photo-heavy",
        label: "A4 Photo Heavy",
        description: "A4 design with a larger photo area and compact text blocks.",
        paperSizes: ["A4"],
        defaultPaperSize: "A4",
        defaultOrientation: "landscape",
        imageSlots: 4,
    },
    {
        id: "a3-poster-split",
        label: "A3 Poster Split",
        description: "Large-format split layout for window or viewing poster prints.",
        paperSizes: ["A3", "A4"],
        defaultPaperSize: "A3",
        defaultOrientation: "landscape",
        imageSlots: 3,
    },
];

export const PROPERTY_PRINT_LANGUAGE_LIMIT = 2;

export const propertyPrintDesignSettingsSchema = z.object({
    accentColor: z.string().trim().nullish().transform((value) => value || null),
    showLogo: z.boolean().default(true),
    showContact: z.boolean().default(true),
    showQr: z.boolean().default(true),
    showPrice: z.boolean().default(true),
    showFacts: z.boolean().default(true),
    showFeatures: z.boolean().default(true),
    showLanguages: z.boolean().default(true),
    showFooter: z.boolean().default(true),
    visibleFacts: z.array(z.string()).default(["bedrooms", "bathrooms", "areaSqm", "parking"]),
}).strict();

export const propertyPrintPromptSettingsSchema = z.object({
    toneInstructions: z.string().trim().nullish().transform((value) => value || null),
    modelOverride: z.string().trim().nullish().transform((value) => value || null),
}).strict();

export const propertyPrintGeneratedLanguageSchema = z.object({
    language: z.string().trim().min(2),
    label: z.string().trim().min(1),
    title: z.string().trim().default(""),
    subtitle: z.string().trim().default(""),
    body: z.string().trim().default(""),
}).strict();

export const propertyPrintGeneratedContentSchema = z.object({
    title: z.string().trim().default(""),
    subtitle: z.string().trim().default(""),
    featureBullets: z.array(z.string().trim()).default([]),
    footerNote: z.string().trim().default(""),
    contactCta: z.string().trim().default(""),
    languages: z.array(propertyPrintGeneratedLanguageSchema).max(PROPERTY_PRINT_LANGUAGE_LIMIT).default([]),
}).strict();

export const propertyPrintGenerationMetadataSchema = z.object({
    provider: z.string().trim().default("google_gemini"),
    model: z.string().trim().default(""),
    generatedAt: z.string().trim().default(""),
    inputTokens: z.number().int().min(0).default(0),
    outputTokens: z.number().int().min(0).default(0),
    totalTokens: z.number().int().min(0).default(0),
}).strict();

export type PropertyPrintDesignSettings = z.infer<typeof propertyPrintDesignSettingsSchema>;
export type PropertyPrintPromptSettings = z.infer<typeof propertyPrintPromptSettingsSchema>;
export type PropertyPrintGeneratedContent = z.infer<typeof propertyPrintGeneratedContentSchema>;
export type PropertyPrintGenerationMetadata = z.infer<typeof propertyPrintGenerationMetadataSchema>;

export const DEFAULT_PROPERTY_PRINT_DESIGN_SETTINGS: PropertyPrintDesignSettings = {
    accentColor: null,
    showLogo: true,
    showContact: true,
    showQr: true,
    showPrice: true,
    showFacts: true,
    showFeatures: true,
    showLanguages: true,
    showFooter: true,
    visibleFacts: ["bedrooms", "bathrooms", "areaSqm", "parking"],
};

export const DEFAULT_PROPERTY_PRINT_PROMPT_SETTINGS: PropertyPrintPromptSettings = {
    toneInstructions: null,
    modelOverride: null,
};

export const DEFAULT_PROPERTY_PRINT_GENERATED_CONTENT: PropertyPrintGeneratedContent = {
    title: "",
    subtitle: "",
    featureBullets: [],
    footerNote: "",
    contactCta: "",
    languages: [],
};

export function getPropertyPrintTemplate(templateId: string | null | undefined) {
    return PROPERTY_PRINT_TEMPLATES.find((template) => template.id === templateId)
        || PROPERTY_PRINT_TEMPLATES[0];
}

export function normalizePropertyPrintLanguages(languages: string[] | null | undefined): string[] {
    const deduped = Array.from(
        new Set((languages || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))
    );
    return deduped.slice(0, PROPERTY_PRINT_LANGUAGE_LIMIT);
}

export function normalizePropertyPrintDesignSettings(value: unknown): PropertyPrintDesignSettings {
    return propertyPrintDesignSettingsSchema.parse({
        ...DEFAULT_PROPERTY_PRINT_DESIGN_SETTINGS,
        ...(value && typeof value === "object" ? value : {}),
    });
}

export function normalizePropertyPrintPromptSettings(value: unknown): PropertyPrintPromptSettings {
    return propertyPrintPromptSettingsSchema.parse({
        ...DEFAULT_PROPERTY_PRINT_PROMPT_SETTINGS,
        ...(value && typeof value === "object" ? value : {}),
    });
}

export function normalizePropertyPrintGeneratedContent(value: unknown): PropertyPrintGeneratedContent {
    return propertyPrintGeneratedContentSchema.parse({
        ...DEFAULT_PROPERTY_PRINT_GENERATED_CONTENT,
        ...(value && typeof value === "object" ? value : {}),
    });
}

export function normalizePropertyPrintGenerationMetadata(value: unknown): PropertyPrintGenerationMetadata | null {
    if (!value || typeof value !== "object") return null;
    return propertyPrintGenerationMetadataSchema.parse(value);
}

export function createDefaultPropertyPrintDraftInput() {
    const template = PROPERTY_PRINT_TEMPLATES[0];
    return {
        name: "Default Print Draft",
        templateId: template.id,
        paperSize: template.defaultPaperSize,
        orientation: template.defaultOrientation,
        languages: ["en"],
        selectedMediaIds: [] as string[],
        isDefault: true,
        designSettings: DEFAULT_PROPERTY_PRINT_DESIGN_SETTINGS,
        promptSettings: DEFAULT_PROPERTY_PRINT_PROMPT_SETTINGS,
        generatedContent: DEFAULT_PROPERTY_PRINT_GENERATED_CONTENT,
        generationMetadata: null,
    };
}

export function resolvePrintImageUrl(image: { cloudflareImageId?: string | null; url?: string | null }) {
    if (image.cloudflareImageId) {
        return getImageDeliveryUrl(image.cloudflareImageId, "public");
    }
    return String(image.url || "");
}

export function formatPropertyPrice(property: {
    price?: number | null;
    currency?: string | null;
    goal?: string | null;
    rentalPeriod?: string | null;
}) {
    if (!property.price) return "Price on request";
    const formatted = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
    }).format(property.price);
    const currency = String(property.currency || "EUR").toUpperCase();
    const symbol = currency === "EUR" ? "EUR" : currency;
    const suffix = property.goal === "RENT" && property.rentalPeriod ? ` / ${property.rentalPeriod}` : "";
    return `${symbol} ${formatted}${suffix}`;
}

export function buildPropertyFactItems(property: any) {
    const facts = [
        property.bedrooms ? { label: "Beds", value: String(property.bedrooms) } : null,
        property.bathrooms ? { label: "Baths", value: String(property.bathrooms) } : null,
        property.coveredAreaSqm || property.areaSqm
            ? { label: "Covered", value: `${property.coveredAreaSqm || property.areaSqm} m2` }
            : null,
        property.plotAreaSqm ? { label: "Plot", value: `${property.plotAreaSqm} m2` } : null,
        property.reference ? { label: "Ref", value: String(property.reference) } : null,
    ];
    return facts.filter(Boolean) as Array<{ label: string; value: string }>;
}

export function buildPropertyFeatureBullets(property: any) {
    const bullets = [
        property.city ? `Located in ${property.city}` : null,
        property.propertyArea ? `Area: ${property.propertyArea}` : null,
        property.condition ? `Condition: ${property.condition}` : null,
        property.goal ? `For ${String(property.goal).toLowerCase()}` : null,
    ];
    return bullets.filter(Boolean) as string[];
}

export function getPaperDimensions(size: PropertyPrintPaperSize, orientation: PropertyPrintOrientation) {
    const dimensions = size === "A3"
        ? { widthMm: 297, heightMm: 420 }
        : { widthMm: 210, heightMm: 297 };

    if (orientation === "landscape") {
        return { widthMm: dimensions.heightMm, heightMm: dimensions.widthMm };
    }

    return dimensions;
}

export function getPaperPageCss(size: PropertyPrintPaperSize, orientation: PropertyPrintOrientation) {
    return `${size} ${orientation}`;
}

export function clampSelectedMediaIds(
    mediaIds: string[] | null | undefined,
    availableMediaIds: string[],
    limit: number
) {
    const allowed = new Set(availableMediaIds);
    return (mediaIds || []).filter((id) => allowed.has(id)).slice(0, limit);
}

export type PrintLayoutPreviewDescriptor = {
    widthMm: number;
    heightMm: number;
    orientation: PropertyPrintOrientation;
    templateId: string;
    templateLabel: string;
    imageSlots: number;
    hasHeroImage: boolean;
    languageCount: number;
    visibleSections: string[];
};

export function buildPrintLayoutPreviewDescriptor(
    templateId: string,
    paperSize: PropertyPrintPaperSize,
    orientation: PropertyPrintOrientation,
    designSettings: PropertyPrintDesignSettings,
    languages: string[],
    selectedImageCount: number,
): PrintLayoutPreviewDescriptor {
    const template = getPropertyPrintTemplate(templateId);
    const { widthMm, heightMm } = getPaperDimensions(
        paperSize as PropertyPrintPaperSize,
        orientation,
    );
    const visibleSections: string[] = [];
    if (designSettings.showLogo) visibleSections.push("logo");
    if (designSettings.showContact) visibleSections.push("contact");
    if (designSettings.showQr) visibleSections.push("qr");
    if (designSettings.showPrice) visibleSections.push("price");
    if (designSettings.showFacts) visibleSections.push("facts");
    if (designSettings.showFeatures) visibleSections.push("features");
    if (designSettings.showLanguages) visibleSections.push("languages");
    if (designSettings.showFooter) visibleSections.push("footer");

    return {
        widthMm,
        heightMm,
        orientation,
        templateId: template.id,
        templateLabel: template.label,
        imageSlots: template.imageSlots,
        hasHeroImage: selectedImageCount > 0,
        languageCount: normalizePropertyPrintLanguages(languages).length,
        visibleSections,
    };
}
