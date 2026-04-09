import { getPaperDimensions, getPaperPageCss } from "@/lib/properties/print-designer";

export function PropertyPrintPreview({ data }: { data: any }) {
    const { draft, branding, property, images } = data;
    const { widthMm, heightMm } = getPaperDimensions(draft.paperSize, draft.orientation);
    const pageCss = getPaperPageCss(draft.paperSize, draft.orientation);
    const heroImage = images[0];
    const supportingImages = images.slice(1);
    const primaryColor = branding.primaryColor || "#9d0917";

    const languageBlocks = draft.generatedContent.languages
        .filter((block: any) => draft.languages.includes(block.language))
        .slice(0, 2);

    return (
        <>
            <style>{`
                @page { size: ${pageCss}; margin: 0; }
                body { background: #e7e5e4; }
                @media print {
                    body { background: #fff; }
                    .print-shell { padding: 0 !important; }
                    .print-page { box-shadow: none !important; }
                }
            `}</style>

            <div className="print-shell px-6 py-8 print:px-0 print:py-0 overflow-x-auto">
                <div
                    className="print-page mx-auto overflow-hidden bg-white shadow-2xl shrink-0"
                    style={{
                        width: `${widthMm}mm`,
                        minHeight: `${heightMm}mm`,
                    }}
                >
                    {draft.templateId === "a4-photo-heavy" ? (
                        <div className="grid min-h-full grid-cols-1 md:grid-cols-[1.15fr_0.85fr]">
                            <div className="flex min-h-full flex-col bg-stone-100">
                                <div className="relative min-h-[52vh] bg-stone-200">
                                    {heroImage ? <img src={heroImage.url} alt={heroImage.alt} className="h-full w-full object-cover" /> : null}
                                </div>
                                {supportingImages.length > 0 ? (
                                    <div className="grid flex-1 grid-cols-3 gap-1 bg-white p-1">
                                        {supportingImages.map((image: any) => (
                                            <div key={image.id} className="min-h-[120px] bg-stone-200">
                                                <img src={image.url} alt={image.alt} className="h-full w-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            <div className="flex flex-col p-8">
                                {draft.designSettings.showLogo && branding.logoUrl ? (
                                    <div className="mb-6 flex justify-center">
                                        <img src={branding.logoUrl} alt={branding.brandName} className="max-h-20 max-w-[240px] object-contain" />
                                    </div>
                                ) : null}
                                <div className="mb-4 text-3xl font-semibold" style={{ color: primaryColor }}>{property.priceText}</div>
                                <div className="mb-2 text-2xl font-bold text-slate-900">{draft.generatedContent.title || property.title}</div>
                                <div className="mb-4 text-sm uppercase tracking-[0.2em] text-slate-500">{draft.generatedContent.subtitle || property.locationLine}</div>
                                {draft.designSettings.showFacts ? (
                                    <div className="mb-5 flex flex-wrap gap-2">
                                        {property.facts.map((fact: any) => (
                                            <div key={fact.label} className="rounded-full border px-3 py-1 text-sm text-slate-700">
                                                <strong>{fact.value}</strong> {fact.label}
                                            </div>
                                        ))}
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
                                {draft.designSettings.showFooter ? (
                                    <div className="mt-6 border-t pt-4 text-sm text-slate-600">
                                        {draft.generatedContent.footerNote}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : draft.templateId === "a3-poster-split" ? (
                        <div className="grid min-h-full grid-cols-[1.15fr_0.85fr]">
                            <div className="flex min-h-full flex-col">
                                <div className="flex-1 bg-stone-200">
                                    {heroImage ? <img src={heroImage.url} alt={heroImage.alt} className="h-full w-full object-cover" /> : null}
                                </div>
                                {supportingImages.length > 0 ? (
                                    <div className="grid h-[24%] grid-cols-2 gap-1 bg-white p-1">
                                        {supportingImages.slice(0, 2).map((image: any) => (
                                            <div key={image.id} className="bg-stone-200">
                                                <img src={image.url} alt={image.alt} className="h-full w-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            <div className="flex flex-col bg-stone-50 p-10">
                                {draft.designSettings.showLogo && branding.logoUrl ? (
                                    <div className="mb-8 flex justify-center">
                                        <img src={branding.logoUrl} alt={branding.brandName} className="max-h-20 max-w-[260px] object-contain" />
                                    </div>
                                ) : null}
                                {draft.designSettings.showPrice ? (
                                    <div className="mb-5 text-4xl font-semibold" style={{ color: primaryColor }}>
                                        {property.priceText}
                                    </div>
                                ) : null}
                                <div className="mb-3 text-3xl font-bold text-slate-900">{draft.generatedContent.title || property.title}</div>
                                <div className="mb-5 text-lg text-slate-600">{draft.generatedContent.subtitle || property.locationLine}</div>
                                {draft.designSettings.showFacts ? (
                                    <div className="mb-6 grid grid-cols-2 gap-3">
                                        {property.facts.map((fact: any) => (
                                            <div key={fact.label} className="rounded-lg border bg-white px-4 py-3">
                                                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{fact.label}</div>
                                                <div className="text-lg font-semibold text-slate-900">{fact.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {draft.designSettings.showLanguages ? (
                                    <div className="flex-1 space-y-6">
                                        {languageBlocks.map((block: any) => (
                                            <div key={block.language}>
                                                <div className="mb-2 text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: primaryColor }}>
                                                    {block.label}
                                                </div>
                                                <div className="text-[15px] leading-7 text-slate-700">{block.body}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                <div className="mt-8 border-t pt-5">
                                    <div className="text-sm font-medium text-slate-800">{draft.generatedContent.contactCta}</div>
                                    {draft.designSettings.showContact ? (
                                        <div className="mt-3 space-y-1 text-sm text-slate-600">
                                            {branding.contact.mobile ? <div>{branding.contact.mobile}</div> : null}
                                            {branding.contact.landline ? <div>{branding.contact.landline}</div> : null}
                                            {branding.contact.email ? <div>{branding.contact.email}</div> : null}
                                            {branding.publicUrl ? <div>{branding.publicUrl}</div> : null}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex min-h-full flex-col">
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
                                    {draft.designSettings.showPrice ? (
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
                    )}
                </div>
            </div>
        </>
    );
}
