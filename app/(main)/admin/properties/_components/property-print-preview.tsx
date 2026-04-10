import { getPaperDimensions, getPaperPageCss } from "@/lib/properties/print-designer";
import { PrintScaleWrapper } from "./print-scale-wrapper";

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
        .filter((block: any) => draft.languages.includes(block.language))
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

            <div className={embedded ? "w-full" : "print-shell px-6 py-8 print:px-0 print:py-0 w-full flex-1"}>
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

function renderTemplate(
    draft: any,
    branding: any,
    property: any,
    heroImage: any,
    supportingImages: any[],
    primaryColor: string,
    languageBlocks: any[],
) {
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
                    {draft.designSettings.showLogo && branding.logoUrl ? (
                        <div className="mb-[8mm] flex justify-center">
                            <img src={branding.logoUrl} alt={branding.brandName} className="max-h-20 max-w-[260px] object-contain" />
                        </div>
                    ) : null}

                    {/* Price */}
                    {draft.designSettings.showPrice !== false ? (
                        <div className="mb-[4mm] font-bold" style={{ color: primaryColor, fontSize: draft.templateId === "a3-poster-split" ? '34pt' : '24pt' }}>
                            {property.priceText}
                        </div>
                    ) : null}

                    {/* Title */}
                    <div className="mb-[6mm] font-bold leading-tight text-slate-900" style={{ fontSize: draft.templateId === "a3-poster-split" ? '22pt' : '18pt' }}>
                        {draft.generatedContent.title || property.title}
                    </div>

                    {/* Facts */}
                    {draft.designSettings.showFacts ? (
                        <div className="mb-[8mm] flex flex-wrap gap-5 font-bold text-slate-600" style={{ fontSize: draft.templateId === "a3-poster-split" ? '16pt' : '12pt' }}>
                            {property.facts.map((fact: any) => (
                                <span key={fact.label}>{fact.value} {fact.label}</span>
                            ))}
                        </div>
                    ) : null}

                    {/* Language blocks */}
                    {draft.designSettings.showLanguages ? (
                        <div className="flex flex-1 flex-col gap-[6mm] overflow-hidden min-h-0">
                            {languageBlocks.map((block: any) => (
                                <div key={block.language} className="overflow-hidden min-h-0 flex flex-col">
                                    <h4
                                        className="mb-[2mm] font-semibold uppercase shrink-0"
                                        style={{
                                            color: primaryColor,
                                            fontSize: draft.templateId === "a3-poster-split" ? '12pt' : '10pt',
                                            letterSpacing: '1px',
                                        }}
                                    >
                                        {block.label}
                                    </h4>
                                    <div
                                        className="text-slate-700 text-justify overflow-hidden text-ellipsis"
                                        style={{
                                            fontSize: draft.templateId === "a3-poster-split" ? '13pt' : '11pt',
                                            lineHeight: 1.5,
                                        }}
                                    >
                                        {block.body}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {/* Footer / Contact */}
                    {(draft.designSettings.showFooter || draft.designSettings.showContact) ? (
                        <div className="mt-auto shrink-0 flex items-end justify-between border-t-2 border-slate-200 pt-[5mm] bg-stone-50 relative z-10">
                            <div style={{ fontSize: '14pt', lineHeight: 1.6, color: '#333' }}>
                                {draft.generatedContent.contactCta ? (
                                    <div className="mb-1 font-medium">{draft.generatedContent.contactCta}</div>
                                ) : null}
                                {draft.designSettings.showContact ? (
                                    <>
                                        {property.reference ? <div><strong style={{ color: primaryColor }}>Ref:</strong> {property.reference}</div> : null}
                                        {branding.contact.landline ? <div><strong style={{ color: primaryColor }}>Tel:</strong> {branding.contact.landline}</div> : null}
                                        {branding.contact.mobile ? <div><strong style={{ color: primaryColor }}>Mob:</strong> {branding.contact.mobile}</div> : null}
                                        {branding.contact.email ? <div>{branding.contact.email}</div> : null}
                                        {branding.publicUrl ? <div>{branding.publicUrl.replace(/^https?:\/\//, '')}</div> : null}
                                    </>
                                ) : null}
                            </div>
                            {draft.designSettings.showQr && branding.publicUrl ? (
                                <div>
                                    <img
                                        src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(branding.publicUrl)}`}
                                        alt="QR"
                                        className="border-2 p-0.5 bg-white"
                                        style={{ width: '100px', height: '100px', borderColor: primaryColor }}
                                    />
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    /* A4 Property Sheet — column layout (hero top, details beside, footer bottom) */
    return (
        <div className="flex h-full flex-col">
            <div className="grid grid-cols-[1.05fr_0.95fr]">
                <div className="min-h-[56vh] bg-stone-200">
                    {heroImage ? <img src={heroImage.url} alt={heroImage.alt} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="flex flex-col p-8">
                    {draft.designSettings.showLogo && branding.logoUrl ? (
                        <div className="mb-6">
                            <img src={branding.logoUrl} alt={branding.brandName} className="max-h-16 max-w-[220px] object-contain" />
                        </div>
                    ) : null}
                    {draft.designSettings.showPrice !== false ? (
                        <div className="mb-4 text-3xl font-semibold" style={{ color: primaryColor }}>{property.priceText}</div>
                    ) : null}
                    <div className="mb-2 text-2xl font-bold text-slate-900">{draft.generatedContent.title || property.title}</div>
                    <div className="mb-4 text-sm text-slate-600">{draft.generatedContent.subtitle || property.locationLine}</div>
                    {draft.designSettings.showFacts ? (
                        <div className="mb-4 flex flex-wrap gap-2">
                            {property.facts.map((fact: any) => (
                                <div key={fact.label} className="rounded-md border px-3 py-1 text-sm">
                                    <strong>{fact.value}</strong> {fact.label}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {draft.designSettings.showFeatures ? (
                        <div className="mb-4">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: primaryColor }}>
                                Highlights
                            </div>
                            <ul className="space-y-1 text-sm text-slate-700">
                                {property.featureBullets.slice(0, 5).map((bullet: string) => (
                                    <li key={bullet}>• {bullet}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {draft.designSettings.showLanguages ? (
                        <div className="flex-1 space-y-4">
                            {languageBlocks.map((block: any) => (
                                <div key={block.language}>
                                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: primaryColor }}>
                                        {block.label}
                                    </div>
                                    <div className="text-sm leading-6 text-slate-700">{block.body}</div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
            {supportingImages.length > 0 ? (
                <div className="grid flex-1 grid-cols-2 gap-1 bg-white p-1">
                    {supportingImages.map((image: any) => (
                        <div key={image.id} className="min-h-[160px] bg-stone-200">
                            <img src={image.url} alt={image.alt} className="h-full w-full object-cover" />
                        </div>
                    ))}
                </div>
            ) : null}
            <div className="grid grid-cols-[1fr_auto] items-start gap-6 border-t px-8 py-5">
                <div>
                    {draft.designSettings.showFooter ? (
                        <div className="text-sm text-slate-600">{draft.generatedContent.footerNote}</div>
                    ) : null}
                    {draft.designSettings.showContact ? (
                        <div className="mt-3 space-y-1 text-sm text-slate-700">
                            {branding.contact.mobile ? <div>{branding.contact.mobile}</div> : null}
                            {branding.contact.landline ? <div>{branding.contact.landline}</div> : null}
                            {branding.contact.email ? <div>{branding.contact.email}</div> : null}
                        </div>
                    ) : null}
                </div>
                {draft.designSettings.showQr && branding.publicUrl ? (
                    <div className="text-right">
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(branding.publicUrl)}`}
                            alt="QR code"
                            className="h-24 w-24 border p-1"
                        />
                        <div className="mt-2 text-xs text-slate-500">{property.reference}</div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
