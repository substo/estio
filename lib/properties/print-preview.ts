import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
    buildPropertyFactItems,
    buildPropertyFeatureBullets,
    clampSelectedMediaIds,
    formatPropertyPrice,
    getPropertyPrintTemplate,
    normalizePropertyPrintDesignSettings,
    normalizePropertyPrintGeneratedContent,
    normalizePropertyPrintPromptSettings,
    normalizePropertyPrintLanguages,
    resolvePrintImageUrl,
} from "@/lib/properties/print-designer";

export async function getLocationPrintBranding(locationId: string) {
    const [settingsDoc, siteConfig, location] = await Promise.all([
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
        }),
        db.siteConfig.findUnique({
            where: { locationId },
            select: { theme: true, contactInfo: true, domain: true },
        }),
        db.location.findUnique({
            where: { id: locationId },
            select: { domain: true, name: true },
        }),
    ]);

    const payload = settingsDoc?.payload || {};
    const theme = (payload.theme || siteConfig?.theme || {}) as Record<string, any>;
    const contactInfo = (payload.contactInfo || siteConfig?.contactInfo || {}) as Record<string, any>;
    const domain = String(payload.domain || siteConfig?.domain || location?.domain || "").trim() || null;

    return {
        domain,
        locationName: String(payload.locationName || location?.name || "").trim() || null,
        theme,
        contactInfo,
    };
}

export function buildPropertyPublicUrl(domain: string | null | undefined, slug: string | null | undefined) {
    const normalizedDomain = String(domain || "").trim();
    const normalizedSlug = String(slug || "").trim();
    if (!normalizedDomain || !normalizedSlug) return null;
    return `https://${normalizedDomain}/properties/${normalizedSlug}`;
}

export function buildPropertyPrintPreviewData({
    property,
    draft,
    branding,
}: {
    property: any;
    draft: any;
    branding: Awaited<ReturnType<typeof getLocationPrintBranding>>;
}) {
    const template = getPropertyPrintTemplate(draft?.templateId);
    const designSettings = normalizePropertyPrintDesignSettings(draft?.designSettings);
    const promptSettings = normalizePropertyPrintPromptSettings(draft?.promptSettings);
    const generatedContent = normalizePropertyPrintGeneratedContent(draft?.generatedContent);
    const languages = normalizePropertyPrintLanguages(draft?.languages);
    const availableImages = Array.isArray(property?.media)
        ? property.media.filter((media: any) => media.kind === "IMAGE")
        : [];

    const selectedIds = clampSelectedMediaIds(
        draft?.selectedMediaIds,
        availableImages.map((image: any) => image.id),
        template.imageSlots
    );

    const selectedImages = [
        ...selectedIds.map((id) => availableImages.find((image: any) => image.id === id)).filter(Boolean),
        ...availableImages.filter((image: any) => !selectedIds.includes(image.id)),
    ].slice(0, template.imageSlots).map((image: any) => ({
        id: image.id,
        alt: property.title || "Property photo",
        url: resolvePrintImageUrl(image),
    }));

    const publicUrl = buildPropertyPublicUrl(branding.domain, property.slug);

    return {
        draft: {
            id: draft.id,
            name: draft.name,
            templateId: template.id,
            templateLabel: template.label,
            paperSize: draft.paperSize,
            orientation: draft.orientation,
            languages,
            designSettings,
            promptSettings,
            generatedContent,
        },
        branding: {
            logoUrl: branding.theme?.logo?.url || null,
            brandName: branding.theme?.logo?.textTop || branding.locationName || "Estio",
            brandTagline: branding.theme?.logo?.textBottom || null,
            primaryColor: designSettings.accentColor || branding.theme?.primaryColor || "#9d0917",
            contact: {
                mobile: branding.contactInfo?.mobile || null,
                landline: branding.contactInfo?.landline || null,
                email: branding.contactInfo?.email || null,
                address: branding.contactInfo?.address || null,
            },
            publicUrl,
        },
        property: {
            id: property.id,
            title: property.title || "",
            reference: property.reference || property.slug || "",
            locationLine: [property.city, property.propertyArea, property.country].filter(Boolean).join(", "),
            priceText: formatPropertyPrice(property),
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms,
            areaSqm: property.areaSqm,
            features: property.features || [],
            facts: buildPropertyFactItems(property),
            featureBullets: generatedContent.featureBullets.length > 0
                ? generatedContent.featureBullets
                : buildPropertyFeatureBullets(property),
            descriptionHtml: property.description || "",
        },
        images: selectedImages,
    };
}
