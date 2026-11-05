import type { BusinessView } from "@/lib/business-profile/view";
import { LOGO_BUSINESS_KEYS, THEME_BUSINESS_KEYS, WEBSITE_BUSINESS_KEYS, mergeWebsiteDocuments } from "./settings";

/**
 * Phase 5 plan for one Location (pure): fold the navigation and content documents into the website document, strip
 * business copies from the website and AI documents, and check each stripped value already lives in the Business
 * profile (or on Location). Values not found there are reported, never silently dropped unnoticed.
 */
type Doc = { payload: Record<string, any>; updatedAt: Date } | null;
export type MergePlan = {
    website: Record<string, any> | null;
    ai: Record<string, any> | null;
    deleteNavigation: boolean;
    deleteContent: boolean;
    conflicts: string[];
    stripped: { key: string; inProfile: boolean }[];
};
const present = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.values(v as object).some(present));

export function planWebsiteMerge(input: { publicSite: Doc; navigation: Doc; content: Doc; ai: Doc; business: BusinessView | null }): MergePlan {
    const { publicSite, navigation, content, ai, business: b } = input;
    const stripped: MergePlan["stripped"] = [];
    const check = (key: string, value: unknown, inProfile: boolean) => { if (present(value)) stripped.push({ key, inProfile }); };
    for (const [name, doc] of [["public_site", publicSite], ["navigation", navigation]] as const) {
        const p = doc?.payload ?? {};
        for (const key of WEBSITE_BUSINESS_KEYS) {
            const v = p[key];
            const ok = key === "domain" || key === "locationName" || key === "locationTimeZone" ? true // kept on Location / domain records
                : key === "contactInfo" ? !!b && (!present((v as any)?.email) || !!b.email) && (!present((v as any)?.address) || !!b.address) && (!present((v as any)?.mobile ?? (v as any)?.landline) || b.phones.length > 0)
                : key === "socialLinks" ? !!b && (!present(v) || b.socialLinks.length > 0)
                : key === "footerBio" ? !!b && !!b.summary
                : key === "marketProfile" ? !!b && [b.market.countryCode, b.market.currencyCode, b.market.locale].some(Boolean) || !present((v as any)?.countryCode)
                : false;
            check(`${name}.${key}`, v, ok);
        }
        const theme = p.theme ?? {};
        for (const key of THEME_BUSINESS_KEYS) check(`${name}.theme.${key}`, theme[key], !!b && !!b.colours[key.replace("Color", "") as "primary" | "secondary" | "accent"]);
        for (const key of LOGO_BUSINESS_KEYS) check(`${name}.theme.logo.${key}`, theme.logo?.[key], !!b && !!(b.logos as Record<string, string | null>)[({ url: "primary", lightUrl: "light", iconUrl: "icon", faviconUrl: "favicon" } as const)[key]]);
    }
    const merged = publicSite || navigation || content
        ? mergeWebsiteDocuments({ publicSite: publicSite?.payload, publicSiteAt: publicSite?.updatedAt, navigation: navigation?.payload, navigationAt: navigation?.updatedAt, content: content?.payload, contentAt: content?.updatedAt })
        : null;
    let aiPayload: Record<string, any> | null = null;
    if (ai && ("brandVoice" in ai.payload || "brandProfile" in ai.payload)) {
        check("ai.brandVoice", ai.payload.brandVoice, !!b && !!b.brandVoice);
        check("ai.brandProfile", ai.payload.brandProfile, !!b && !!b.summary);
        const { brandVoice: _v, brandProfile: _p, ...rest } = ai.payload;
        aiPayload = rest;
    }
    return {
        website: merged ? { theme: {}, ...merged.payload } : null,
        ai: aiPayload,
        deleteNavigation: !!navigation,
        deleteContent: !!content,
        conflicts: merged?.conflicts ?? [],
        stripped,
    };
}
