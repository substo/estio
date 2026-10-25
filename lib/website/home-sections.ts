/** The existing homepage storage schema, shared by both editions' editor and generic renderer. */
export function homeSectionBlocks(config: any, realEstateEnabled = true): any[] {
    const fallback = [
        { id: "hero", type: "hero", enabled: true, order: 0 },
        ...(realEstateEnabled ? [{ id: "featured", type: "featured-properties", enabled: true, order: 1 }, { id: "partners", type: "trusted-partners", enabled: true, order: 2 }] : []),
    ];
    const sections = Array.isArray(config?.homeSections) ? config.homeSections : fallback;
    return [...sections].sort((a, b) => a.order - b.order).filter((section) => section.enabled && (realEstateEnabled || !["featured-properties", "trusted-partners", "categories"].includes(section.type))).map((section) => section.type === "hero" ? { type: "hero", ...config?.heroContent, layout: config?.heroContent?.layout || "full-width" } : { ...section, enabled: true });
}
