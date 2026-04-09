import assert from "node:assert/strict";
import test from "node:test";
import {
    createDefaultPropertyPrintDraftInput,
    getPropertyPrintTemplate,
    normalizePropertyPrintDesignSettings,
    normalizePropertyPrintGeneratedContent,
    normalizePropertyPrintLanguages,
    normalizePropertyPrintPromptSettings,
    getPaperDimensions,
    buildPrintLayoutPreviewDescriptor,
} from "@/lib/properties/print-designer";
import { buildPropertyPrintPreviewData } from "@/lib/properties/print-preview";

test("default property print draft uses the primary A4 template", () => {
    const draft = createDefaultPropertyPrintDraftInput();
    assert.equal(draft.templateId, "a4-property-sheet");
    assert.equal(draft.paperSize, "A4");
    assert.equal(draft.orientation, "portrait");
    assert.deepEqual(draft.languages, ["en"]);
});

test("language normalization dedupes and enforces the two-language cap", () => {
    assert.deepEqual(
        normalizePropertyPrintLanguages(["EN", "pl", "en", "ru"]),
        ["en", "pl"]
    );
});

test("preview data prefers selected media ids and generated brochure blocks", () => {
    const data = buildPropertyPrintPreviewData({
        property: {
            id: "prop1",
            title: "Sea View Villa",
            slug: "sea-view-villa",
            reference: "DT4505",
            city: "Paphos",
            propertyArea: "Sea Caves",
            country: "Cyprus",
            price: 1400000,
            currency: "EUR",
            bedrooms: 4,
            bathrooms: 3,
            areaSqm: 211,
            plotAreaSqm: 350,
            goal: "SALE",
            media: [
                { id: "img1", kind: "IMAGE", url: "https://example.com/1.jpg" },
                { id: "img2", kind: "IMAGE", url: "https://example.com/2.jpg" },
                { id: "img3", kind: "IMAGE", url: "https://example.com/3.jpg" },
            ],
        },
        draft: {
            id: "draft1",
            name: "Draft",
            templateId: "a4-property-sheet",
            paperSize: "A4",
            orientation: "portrait",
            languages: ["en", "pl"],
            selectedMediaIds: ["img2", "img3"],
            designSettings: normalizePropertyPrintDesignSettings({ showQr: false }),
            promptSettings: {},
            generatedContent: normalizePropertyPrintGeneratedContent({
                title: "Luxury Sea View Villa",
                subtitle: "Detached villa for sale",
                featureBullets: ["Private pool", "Sea views"],
                footerNote: "Viewing by appointment.",
                contactCta: "Call our team to book a viewing.",
                languages: [
                    { language: "en", label: "English", title: "", subtitle: "", body: "English body" },
                    { language: "pl", label: "Polish", title: "", subtitle: "", body: "Polish body" },
                ],
            }),
        },
        branding: {
            domain: "example.com",
            locationName: "Example Realty",
            theme: { primaryColor: "#9d0917", logo: { textTop: "Example Realty" } },
            contactInfo: { mobile: "+357 26 000000", email: "info@example.com" },
        },
    });

    assert.equal(getPropertyPrintTemplate(data.draft.templateId).imageSlots, 3);
    assert.deepEqual(
        data.images.map((image: any) => image.id),
        ["img2", "img3", "img1"]
    );
    assert.equal(data.property.priceText, "EUR 1,400,000");
    assert.equal(data.draft.generatedContent.languages.length, 2);
    assert.equal(data.branding.publicUrl, "https://example.com/properties/sea-view-villa");
});

test("paper dimensions: A4 portrait is 210x297", () => {
    const dims = getPaperDimensions("A4", "portrait");
    assert.equal(dims.widthMm, 210);
    assert.equal(dims.heightMm, 297);
});

test("paper dimensions: A4 landscape is 297x210", () => {
    const dims = getPaperDimensions("A4", "landscape");
    assert.equal(dims.widthMm, 297);
    assert.equal(dims.heightMm, 210);
});

test("paper dimensions: A3 portrait is 297x420", () => {
    const dims = getPaperDimensions("A3", "portrait");
    assert.equal(dims.widthMm, 297);
    assert.equal(dims.heightMm, 420);
});

test("paper dimensions: A3 landscape is 420x297", () => {
    const dims = getPaperDimensions("A3", "landscape");
    assert.equal(dims.widthMm, 420);
    assert.equal(dims.heightMm, 297);
});

test("inline preview descriptor updates with orientation and template changes", () => {
    const settings = normalizePropertyPrintDesignSettings({ showQr: false, showFooter: false });
    const descriptor = buildPrintLayoutPreviewDescriptor(
        "a4-photo-heavy", "A4", "landscape", settings, ["en", "pl"], 3,
    );
    assert.equal(descriptor.widthMm, 297);
    assert.equal(descriptor.heightMm, 210);
    assert.equal(descriptor.orientation, "landscape");
    assert.equal(descriptor.templateId, "a4-photo-heavy");
    assert.equal(descriptor.imageSlots, 4);
    assert.equal(descriptor.hasHeroImage, true);
    assert.equal(descriptor.languageCount, 2);
    assert.ok(!descriptor.visibleSections.includes("qr"));
    assert.ok(!descriptor.visibleSections.includes("footer"));
    assert.ok(descriptor.visibleSections.includes("logo"));
});

test("prompt settings normalization preserves modelOverride", () => {
    const settings = normalizePropertyPrintPromptSettings({
        toneInstructions: "Keep it premium",
        modelOverride: "gemini-2.5-flash",
    });
    assert.equal(settings.toneInstructions, "Keep it premium");
    assert.equal(settings.modelOverride, "gemini-2.5-flash");
});

test("prompt settings normalization defaults modelOverride to null", () => {
    const settings = normalizePropertyPrintPromptSettings({});
    assert.equal(settings.modelOverride, null);
});

test("draft normalization preserves explicit landscape orientation", () => {
    const settings = normalizePropertyPrintDesignSettings({});
    const descriptor = buildPrintLayoutPreviewDescriptor(
        "a3-poster-split", "A3", "landscape", settings, ["en"], 2,
    );
    assert.equal(descriptor.orientation, "landscape");
    assert.equal(descriptor.widthMm, 420);
    assert.equal(descriptor.heightMm, 297);
});

