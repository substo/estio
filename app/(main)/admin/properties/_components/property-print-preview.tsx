import { getPaperDimensions, getPaperPageCss } from "@/lib/properties/print-designer";
import { PrintScaleWrapper } from "@/app/(main)/admin/properties/_components/print-scale-wrapper";
import { AutoFitText } from "@/app/(main)/admin/properties/_components/auto-fit-text";
import { Bed, Bath, Maximize, Car } from "lucide-react";
import { FEATURE_CATEGORIES } from "@/lib/properties/filter-constants";

/**
 * Property Print Preview — renders a true-to-scale paper preview.
 *
 * KEY DESIGN DECISIONS (matching the proven original static HTML):
 *   1. The container uses FIXED width + height (not minHeight) so the paper
 *      never grows beyond its physical dimensions regardless of content length.
 *   2. The orientation flag ONLY controls paper dimensions (width/height swap).
 *      The template layout (left images, right text) stays the SAME in both
 *      portrait and landscape — exactly like the original HTML poster.
 *   3. Content that doesn't fit is clipped by overflow:hidden on the container.
 *
 * When `embedded` is true the @page style and body background are omitted
 * so the component can render inline inside the designer dialog, and a CSS
 * transform is applied to scale the paper down to fit the available width.
 */
export function PropertyPrintPreview({ 
    data, 
    embedded,
    fitMode = 'width',
    zoomScale = 1,
}: { 
    data: any; 
    embedded?: boolean;
    fitMode?: 'width' | 'both';
    zoomScale?: number;
}) {
    const { draft, branding, property, images } = data;
    const { widthMm, heightMm } = getPaperDimensions(draft.paperSize, draft.orientation);
    const pageCss = getPaperPageCss(draft.paperSize, draft.orientation);
    const heroImage = images[0] || null;
    const supportingImages = images.slice(1);
    const primaryColor = branding.primaryColor || "#9d0917";

    const languageBlocks = draft.generatedContent.languages
        .filter((block: any) => draft.languages.map((l: string) => l.toLowerCase()).includes(block.language?.toLowerCase()))
        .slice(0, 2);

    /*
     * For the standalone preview page, large paper (A3 landscape = 420mm ≈ 1587px)
     * doesn't fit on most screens. We use a CSS scale transform so the preview
     * fits inside the viewport. On print, we remove the scale.
     *
     * For embedded mode (inside the dialog), we always scale to fit the container
     * width, which is typically ~1100px.
     */
    const needsScaling = !embedded && (widthMm > 297 || heightMm > 420);

    return (
        <>
            {/* Only inject @page / body styles on the standalone preview page */}
            {!embedded ? (
                <style>{`
                    @page { size: ${pageCss}; margin: 0; }
                    body { background: #e7e5e4; }
                    @media print {
                        body { background: #fff; }
                        .print-shell { padding: 0 !important; }
                        .print-page { box-shadow: none !important; transform: none !important; }
                        .print-scale-wrapper { transform: none !important; width: auto !important; height: auto !important; }
                    }
                    .print-scale-wrapper {
                        transform-origin: top center;
                    }
                `}</style>
            ) : null}

            <div className={embedded ? "w-full h-full" : "print-shell px-6 py-8 print:px-0 print:py-0 w-full flex-1"}>
                <PrintScaleWrapper 
                    widthMm={widthMm} 
                    heightMm={heightMm} 
                    fitMode={fitMode} 
                    zoomScale={zoomScale}
                >
                    <div
                        className="print-page mx-auto overflow-hidden bg-white shadow-2xl shrink-0"
                        style={{
                            width: `${widthMm}mm`,
                            height: `${heightMm}mm`,
                        }}
                    >
                        {renderTemplate(draft, branding, property, heroImage, supportingImages, primaryColor, languageBlocks)}
                    </div>
                </PrintScaleWrapper>
            </div>
        </>
    );
}

const LANGUAGE_FLAGS: Record<string, string> = {
    en: "🇬🇧",
    el: "🇬🇷",
    es: "🇪🇸",
    fr: "🇫🇷",
    de: "🇩🇪",
    it: "🇮🇹",
    pt: "🇵🇹",
    tr: "🇹🇷",
    ru: "🇷🇺",
    uk: "🇺🇦",
    ro: "🇷🇴",
    pl: "🇵🇱",
    bg: "🇧🇬",
    ar: "🇸🇦",
    he: "🇮🇱",
    zh: "🇨🇳",
    ja: "🇯🇵",
    ko: "🇰🇷",
    sv: "🇸🇪",
    no: "🇳🇴",
    nl: "🇳🇱",
    cs: "🇨🇿",
    fa: "🇮🇷",
};

function getLanguageFlag(language: string): string {
    return LANGUAGE_FLAGS[language.toLowerCase()] || "🌐";
}

/** Resolve a feature key to its human-readable label via FEATURE_CATEGORIES.
 *  Canonical keys are snake_case (e.g. "air_conditioning") and map to catalog labels.
 *  Non-catalog values are already human-readable strings from scraped imports
 *  (e.g. "Parking: Covered", "Sea View") and are returned as-is. */
function getFeatureLabel(key: string): string {
    for (const category of FEATURE_CATEGORIES) {
        const found = category.items.find(item => item.key === key);
        if (found) return found.label;
    }
    return key;
}

function renderTemplate(
    draft: any,
    branding: any,
    property: any,
    heroImage: any,
    supportingImages: any[],
    primaryColor: string,
    languageBlocks: any[],
) {
    const g = draft.generatedContent || {};
    const activeLogo = g.logoUrlOverride || branding.logoUrl;
    const activePrice = g.priceOverride || property.priceText;
    const activeTitle = g.title || property.title;
    const activeRef = g.referenceOverride || property.reference;
    const activeTel = g.telOverride || branding.contact.landline;
    const activeMob = g.mobOverride || branding.contact.mobile;
    const activeEmail = g.emailOverride || branding.contact.email;
    const activeWebsite = g.websiteOverride || branding.publicUrl;
    const activeSubtitle = g.subtitle || property.locationLine;
    const fontScale = draft.designSettings.fontScale ?? 1;

    if (draft.templateId === "a4-photo-heavy" || draft.templateId === "a3-poster-split") {
        /*
         * Both poster templates use the same structural layout:
         *   Left 55% = images (hero + thumbnails)
         *   Right 45% = text content
         *
         * This matches the original static HTML exactly:
         *   .poster-container { display: flex; width: 420mm; height: 297mm; }
         *   .left-col { width: 55%; height: 100%; }
         *   .right-col { width: 45%; height: 100%; }
         */
        return (
            <div className="flex h-full">
                {/* LEFT COLUMN: Images */}
                <div className="flex h-full w-[55%] flex-col">
                    {/* Hero image — takes remaining space above thumbnails */}
                    <div className="relative flex-1 bg-stone-200">
                        {heroImage ? (
                            <img
                                src={heroImage.url}
                                alt={heroImage.alt}
                                className="h-full w-full object-cover block"
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-stone-400 text-lg">
                                No image selected
                            </div>
                        )}
                    </div>

                    {/* Thumbnail strip — 25% height, side by side */}
                    {supportingImages.length > 0 ? (
                        <div className="flex" style={{ height: '25%' }}>
                            {supportingImages.map((image: any, idx: number) => (
                                <div
                                    key={image.id || idx}
                                    className="flex-1 bg-stone-200"
                                    style={{
                                        borderTop: '5px solid #ffffff',
                                        borderLeft: idx > 0 ? '5px solid #ffffff' : 'none',
                                    }}
                                >
                                    <img
                                        src={image.url}
                                        alt={image.alt}
                                        className="h-full w-full object-cover block"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                {/* RIGHT COLUMN: Text */}
                <div className="flex h-full w-[45%] flex-col overflow-hidden bg-stone-50 p-[15mm]">
                    {/* Logo */}
                    {draft.designSettings.showLogo && activeLogo ? (
                        <div className="mb-[8mm] flex justify-center">
                            <img src={activeLogo} alt={branding.brandName} className="max-h-20 max-w-[260px] object-contain" />
                        </div>
                    ) : null}

                    {/* Price */}
                    {draft.designSettings.showPrice !== false && activePrice ? (
                        <div className="mb-[4mm] font-bold" style={{ color: primaryColor, fontSize: draft.templateId === "a3-poster-split" ? `calc(34pt * ${fontScale})` : `calc(24pt * ${fontScale})` }}>
                            {activePrice}
                            {draft.generatedContent.vatText ? <span style={{ fontSize: '0.6em', opacity: 0.8, marginLeft: '0.1em' }} className="font-semibold">{draft.generatedContent.vatText}</span> : null}
                        </div>
                    ) : null}

                    {/* Title */}
                    <div className="mb-[6mm] font-bold leading-tight text-slate-900" style={{ fontSize: draft.templateId === "a3-poster-split" ? `calc(22pt * ${fontScale})` : `calc(18pt * ${fontScale})` }}>
                        {activeTitle}
                    </div>

                    {/* Subtitle */}
                    {activeSubtitle ? (
                        <div className="mb-[6mm] text-slate-600" style={{ fontSize: draft.templateId === "a3-poster-split" ? `calc(16pt * ${fontScale})` : `calc(12pt * ${fontScale})`, marginTop: '-4mm' }}>
                            {activeSubtitle}
                        </div>
                    ) : null}

                    {/* Facts */}
                    {draft.designSettings.showFacts ? (
                        <div className="mb-[8mm] flex w-full gap-[2mm]" style={{ fontSize: draft.templateId === "a3-poster-split" ? `calc(13pt * ${fontScale})` : `calc(9pt * ${fontScale})` }}>
                            {(!draft.designSettings.visibleFacts || draft.designSettings.visibleFacts.includes("bedrooms")) && (
                                <div className="flex-1 min-w-0 flex items-center justify-center gap-[4px] py-[2mm] px-[1mm] rounded-md bg-black/5 border border-black/10 whitespace-nowrap overflow-hidden">
                                    <Bed className="shrink-0" style={{ width: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', height: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', color: primaryColor }} />
                                    <span className="font-bold text-slate-800 leading-none">{property.bedrooms || "-"}</span>
                                    <span className="uppercase text-slate-500 tracking-wider font-semibold leading-none" style={{ fontSize: '0.75em' }}>Beds</span>
                                </div>
                            )}
                            {(!draft.designSettings.visibleFacts || draft.designSettings.visibleFacts.includes("bathrooms")) && (
                                <div className="flex-1 min-w-0 flex items-center justify-center gap-[4px] py-[2mm] px-[1mm] rounded-md bg-black/5 border border-black/10 whitespace-nowrap overflow-hidden">
                                    <Bath className="shrink-0" style={{ width: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', height: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', color: primaryColor }} />
                                    <span className="font-bold text-slate-800 leading-none">{property.bathrooms || "-"}</span>
                                    <span className="uppercase text-slate-500 tracking-wider font-semibold leading-none" style={{ fontSize: '0.75em' }}>Baths</span>
                                </div>
                            )}
                            {(!draft.designSettings.visibleFacts || draft.designSettings.visibleFacts.includes("areaSqm")) && (
                                <div className="flex-1 min-w-0 flex items-center justify-center gap-[4px] py-[2mm] px-[1mm] rounded-md bg-black/5 border border-black/10 whitespace-nowrap overflow-hidden">
                                    <Maximize className="shrink-0" style={{ width: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', height: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', color: primaryColor }} />
                                    <span className="font-bold text-slate-800 leading-none">{property.areaSqm || "-"} m&sup2;</span>
                                </div>
                            )}
                            {(!draft.designSettings.visibleFacts || draft.designSettings.visibleFacts.includes("parking")) && (
                                <div className="flex-1 min-w-0 flex items-center justify-center gap-[4px] py-[2mm] px-[1mm] rounded-md bg-black/5 border border-black/10 whitespace-nowrap overflow-hidden">
                                    <Car className="shrink-0" style={{ width: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', height: draft.templateId === "a3-poster-split" ? '24pt' : '16pt', color: primaryColor }} />
                                    <span className="font-bold text-slate-800 leading-none">
                                        {(property.features || []).some((f: string) => typeof f === 'string' && f.toLowerCase().includes('parking')) ? "Yes" : "-"}
                                    </span>
                                    <span className="uppercase text-slate-500 tracking-wider font-semibold leading-none" style={{ fontSize: '0.75em' }}>Parking</span>
                                </div>
                            )}
                        </div>
                    ) : null}

                    {/* Feature Bullets */}
                    {draft.designSettings.showFeatures && property.featureBullets?.length > 0 ? (
                        <div className="mb-[6mm]">
                            <div className="mb-[2mm] font-semibold uppercase tracking-[0.2em]" style={{ color: primaryColor, fontSize: draft.templateId === "a3-poster-split" ? `calc(14pt * ${fontScale})` : `calc(10pt * ${fontScale})` }}>
                                Highlights
                            </div>
                            <ul className="space-y-[1.5mm] text-slate-700" style={{ fontSize: draft.templateId === "a3-poster-split" ? `calc(14pt * ${fontScale})` : `calc(10pt * ${fontScale})` }}>
                                {property.featureBullets.slice(0, 5).map((bullet: string) => (
                                    <li key={bullet}>• {bullet}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    {/* Language blocks */}
                    {draft.designSettings.showLanguages ? (
                        <div className="flex flex-1 flex-col gap-[6mm] overflow-hidden min-h-[100px]">
                            {languageBlocks.map((block: any) => (
                                <div key={block.language} className="flex-1 overflow-hidden min-h-[50px] flex flex-col">
                                    <div className="flex-1 min-h-[50px] relative">
                                        <div className="absolute inset-0">
                                            <AutoFitText
                                                maxFontSize={(draft.templateId === "a3-poster-split" ? 13 : 11) * fontScale}
                                                minFontSize={7}
                                                step={0.5}
                                                className="text-slate-700 text-justify"
                                                style={{ lineHeight: 1.5 }}
                                            >
                                                {block.title && (
                                                    <div className="font-semibold mb-[2mm]">
                                                        <span style={{ fontSize: '1.15em' }}>{getLanguageFlag(block.language)}</span>{" "}
                                                        {block.title}
                                                    </div>
                                                )}
                                                {!block.title && (
                                                    <div className="font-semibold mb-[2mm]">
                                                        <span style={{ fontSize: '1.15em' }}>{getLanguageFlag(block.language)}</span>
                                                    </div>
                                                )}
                                                {block.subtitle && <div className="italic mb-[2mm]">{block.subtitle}</div>}
                                                <div className="whitespace-pre-wrap">{block.body}</div>
                                            </AutoFitText>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {/* Footer / Contact */}
                    {(draft.designSettings.showFooter || draft.designSettings.showContact) ? (
                        <div className="mt-auto shrink-0 bg-stone-50 relative z-10">
                            <div className="border-t-2 border-slate-200 mb-[3mm]" />
                            <div className="flex items-end justify-between gap-[4mm]">
                                <div style={{ fontSize: `calc(12pt * ${fontScale})`, lineHeight: 1.5, color: '#333' }}>
                                    {(draft.designSettings.showFooter && draft.generatedContent.footerNote) ? (
                                        <div className="mb-[2mm] text-slate-600">{draft.generatedContent.footerNote}</div>
                                    ) : null}
                                    {draft.generatedContent.contactCta ? (
                                        <div className="mb-[1mm] font-medium">{draft.generatedContent.contactCta}</div>
                                    ) : null}
                                    {draft.designSettings.showContact ? (
                                        <div className="space-y-[0.5mm]">
                                            {(activeTel || activeMob) ? (
                                                <div className="flex flex-wrap gap-x-[4mm]">
                                                    {activeTel ? <span><strong style={{ color: primaryColor }}>Tel:</strong> {activeTel}</span> : null}
                                                    {activeMob ? <span><strong style={{ color: primaryColor }}>Mob:</strong> {activeMob}</span> : null}
                                                </div>
                                            ) : null}
                                            {(activeEmail && draft.designSettings.showEmail) ? <div>{activeEmail}</div> : null}
                                            {(activeWebsite && draft.designSettings.showWebsite !== false) ? <div><strong style={{ color: primaryColor }}>Web:</strong> {activeWebsite.replace(/^https?:\/\//, '')}</div> : null}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-[1.5mm] text-right" style={{ width: '80px' }}>
                                    {activeRef ? (
                                        <div className="w-full text-right truncate" style={{ fontSize: `calc(9pt * ${fontScale})`, lineHeight: 1.2, color: '#333' }}>
                                            <strong style={{ color: primaryColor }}>Ref:</strong> {activeRef}
                                        </div>
                                    ) : null}
                                    {draft.designSettings.showQr && activeWebsite ? (
                                        <div className="shrink-0">
                                            <img
                                                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(activeWebsite)}`}
                                                alt="QR"
                                                className="border-2 p-0.5 bg-white"
                                                style={{ width: '80px', height: '80px', aspectRatio: '1', borderColor: primaryColor }}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    /* ──────────────────────────────────────────────────────────────────────
     * A4 PROPERTY SHEET — Reference-style three-row layout
     *
     * Structure:
     *   ┌─────────────────────────────────────────────┐
     *   │  [Logo]       For Sale €X           [QR]    │  Header
     *   ├────────────┬────────────────────────────────┤
     *   │ Hero Image │  Property Ref. XXXX            │  Row 1
     *   │   (45%)    │  detail lines …                │
     *   ├────────────┼────────────────────────────────┤
     *   │ Image 2    │  Property Features             │  Row 2
     *   │   (45%)    │  ✔ feature …                   │
     *   ├────────────┼────────────────────────────────┤
     *   │ Image 3    │  Description                   │  Row 3
     *   │   (45%)    │  body text …                   │
     *   ├────────────┴────────────────────────────────┤
     *   │  email · website · company info             │  Footer
     *   └─────────────────────────────────────────────┘
     * ──────────────────────────────────────────────────────────────────── */

    // Helper: extract feature value from features array by keyword
    const findFeature = (keyword: string) =>
        (property.features || []).find((f: string) => typeof f === 'string' && f.toLowerCase().includes(keyword.toLowerCase()));
    const parkingFeature = findFeature('parking');
    const titleDeedFeature = findFeature('title deed');
    const beachFeature = findFeature('beach');

    // Determine description text: first language block body, or stripped HTML description
    const descriptionText = (() => {
        if (draft.designSettings.showLanguages && languageBlocks.length > 0) {
            return languageBlocks[0].body || '';
        }
        // Strip HTML tags from description
        const raw = property.descriptionHtml || '';
        return raw.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
    })();

    // All three images for the three rows
    const rowImages = [heroImage, supportingImages[0] || null, supportingImages[1] || null];

    // Detail lines for Row 1 (icon + label, conditionally rendered)
    const detailLines: Array<{ icon: string; text: string }> = [];
    if (draft.designSettings.showPrice !== false && activePrice) {
        detailLines.push({ icon: '💰', text: `${activePrice}${draft.generatedContent.vatText ? ' ' + draft.generatedContent.vatText : ''}` });
    }
    if (property.propertyArea || property.city) {
        detailLines.push({ icon: '📍', text: [property.propertyArea, property.city].filter(Boolean).join(', ') });
    }
    if (property.type) {
        detailLines.push({ icon: '🏠', text: property.type });
    }
    if (property.buildYear) {
        detailLines.push({ icon: '📅', text: `Year Built ${property.buildYear}` });
    }
    if (draft.designSettings.showFacts) {
        if (property.bedrooms || property.bathrooms) {
            const parts = [];
            if (property.bedrooms) parts.push(`${property.bedrooms} Bedrooms`);
            if (property.bathrooms) parts.push(`${property.bathrooms} Bathrooms`);
            detailLines.push({ icon: '🛏️', text: parts.join(' ') });
        }
        if (property.coveredAreaSqm || property.areaSqm) {
            detailLines.push({ icon: '📐', text: `${property.coveredAreaSqm || property.areaSqm}m² Covered` });
        }
        if (property.plotAreaSqm) {
            detailLines.push({ icon: '✂️', text: `${property.plotAreaSqm}m² Plot` });
        }
    }
    if (titleDeedFeature) {
        detailLines.push({ icon: '📜', text: getFeatureLabel(titleDeedFeature) });
    }
    if (parkingFeature) {
        detailLines.push({ icon: '🅿️', text: getFeatureLabel(parkingFeature) });
    }
    if (beachFeature) {
        detailLines.push({ icon: '🏖️', text: getFeatureLabel(beachFeature) });
    }

    const baseFontSize = `calc(0.8rem * ${fontScale})`;
    const headingFontSize = `calc(1.35rem * ${fontScale})`;
    const sectionHeadingSize = `calc(1.15rem * ${fontScale})`;

    return (
        <div className="flex h-full flex-col bg-white">
            {/* ── HEADER BAR ── */}
            <div className="shrink-0 border-b-2" style={{ borderColor: primaryColor }}>
                <div className="flex items-center justify-between px-[8mm] py-[4mm]">
                    {/* Logo */}
                    <div className="flex-1">
                        {draft.designSettings.showLogo && activeLogo ? (
                            <img src={activeLogo} alt={branding.brandName} className="max-h-[14mm] max-w-[50mm] object-contain" />
                        ) : null}
                    </div>
                    {/* Sale badge + price */}
                    <div className="flex-1 text-center">
                        {draft.designSettings.showPrice !== false && activePrice ? (
                            <div className="font-bold" style={{ color: primaryColor, fontSize: `calc(1.1rem * ${fontScale})` }}>
                                {property.goal === 'RENT' ? 'For Rent' : 'For Sale'} {activePrice}
                                {draft.generatedContent.vatText ? <span style={{ fontSize: '0.7em', opacity: 0.8, marginLeft: '0.2em' }}>{draft.generatedContent.vatText}</span> : null}
                            </div>
                        ) : null}
                    </div>
                    {/* QR code */}
                    <div className="flex-1 flex justify-end">
                        {draft.designSettings.showQr && activeWebsite ? (
                            <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(activeWebsite)}`}
                                alt="QR"
                                className="border p-0.5"
                                style={{ width: '18mm', height: '18mm', borderColor: '#ddd' }}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            {/* ── BODY: Three content rows ── */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-x" style={{ borderColor: '#e5e5e5', margin: '0 3mm' }}>

                {/* ROW 1: Hero Image + Property Details */}
                <div className="flex flex-1 min-h-0 border-b" style={{ borderColor: '#e5e5e5' }}>
                    {/* Image */}
                    <div className="w-[45%] shrink-0 bg-stone-200 overflow-hidden">
                        {rowImages[0] ? (
                            <img src={rowImages[0].url} alt={rowImages[0].alt} className="h-full w-full object-cover block" />
                        ) : (
                            <div className="flex h-full items-center justify-center text-stone-400" style={{ fontSize: baseFontSize }}>No image</div>
                        )}
                    </div>
                    {/* Details */}
                    <div className="flex-1 p-[5mm] flex flex-col justify-center overflow-hidden">
                        {/* Property Ref heading */}
                        <div className="font-bold mb-[3mm]" style={{ color: primaryColor, fontSize: headingFontSize }}>
                            Property Ref. {activeRef || '—'}
                        </div>
                        {/* Detail lines */}
                        <div className="space-y-[1.5mm]">
                            {detailLines.map((line, idx) => (
                                <div key={idx} className="flex items-start gap-[2mm] text-slate-800" style={{ fontSize: baseFontSize, lineHeight: 1.5 }}>
                                    <span className="shrink-0 w-[5mm] text-center" style={{ fontSize: `calc(0.85rem * ${fontScale})` }}>{line.icon}</span>
                                    <span>{line.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ROW 2: Image 2 + Property Features */}
                {draft.designSettings.showFeatures ? (
                    <div className="flex flex-1 min-h-0 border-b" style={{ borderColor: '#e5e5e5' }}>
                        {/* Image */}
                        <div className="w-[45%] shrink-0 bg-stone-200 overflow-hidden">
                            {rowImages[1] ? (
                                <img src={rowImages[1].url} alt={rowImages[1].alt} className="h-full w-full object-cover block" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-stone-400" style={{ fontSize: baseFontSize }}>No image</div>
                            )}
                        </div>
                        {/* Features checklist */}
                        <div className="flex-1 p-[5mm] flex flex-col overflow-hidden">
                            <div className="font-bold mb-[3mm]" style={{ color: primaryColor, fontSize: sectionHeadingSize }}>
                                Property Features
                            </div>
                            <div className="flex-1 overflow-hidden" style={{ fontSize: baseFontSize, lineHeight: 1.6 }}>
                                <div className="columns-1 gap-[4mm]" style={{ columnCount: (property.features || []).length > 8 ? 2 : 1 }}>
                                    {(property.features || []).map((feature: string, idx: number) => (
                                        <div key={idx} className="flex items-start gap-[1.5mm] break-inside-avoid text-slate-800" style={{ marginBottom: '1mm' }}>
                                            <span className="shrink-0 font-bold" style={{ color: primaryColor }}>✔</span>
                                            <span>{getFeatureLabel(feature)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {/* ROW 3: Image 3 + Description */}
                {draft.designSettings.showLanguages ? (
                    <div className="flex flex-1 min-h-0">
                        {/* Image */}
                        <div className="w-[45%] shrink-0 bg-stone-200 overflow-hidden">
                            {rowImages[draft.designSettings.showFeatures ? 2 : 1] ? (
                                <img src={rowImages[draft.designSettings.showFeatures ? 2 : 1]!.url} alt={rowImages[draft.designSettings.showFeatures ? 2 : 1]!.alt} className="h-full w-full object-cover block" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-stone-400" style={{ fontSize: baseFontSize }}>No image</div>
                            )}
                        </div>
                        {/* Description */}
                        <div className="flex-1 p-[5mm] flex flex-col overflow-hidden">
                            <div className="font-bold mb-[3mm]" style={{ color: primaryColor, fontSize: sectionHeadingSize }}>
                                Description
                            </div>
                            <div className="flex-1 overflow-hidden text-slate-700 text-justify" style={{ fontSize: baseFontSize, lineHeight: 1.6 }}>
                                <div className="whitespace-pre-wrap">{descriptionText}</div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* ── FOOTER ── */}
            {(draft.designSettings.showFooter || draft.designSettings.showContact) ? (
                <div className="shrink-0 border-t-2 px-[8mm] py-[3mm] text-center" style={{ borderColor: primaryColor }}>
                    <div className="space-y-[0.5mm]" style={{ fontSize: `calc(0.65rem * ${fontScale})`, lineHeight: 1.5, color: '#555' }}>
                        {draft.designSettings.showContact ? (
                            <div className="flex items-center justify-center gap-[2mm] flex-wrap">
                                {(activeEmail && draft.designSettings.showEmail) ? <span>{activeEmail}</span> : null}
                                {(activeEmail && draft.designSettings.showEmail && activeWebsite && draft.designSettings.showWebsite !== false) ? <span>-</span> : null}
                                {(activeWebsite && draft.designSettings.showWebsite !== false) ? <span>{activeWebsite.replace(/^https?:\/\//, '')}</span> : null}
                            </div>
                        ) : null}
                        {draft.designSettings.showFooter && draft.generatedContent.footerNote ? (
                            <div className="text-slate-500">{draft.generatedContent.footerNote}</div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
