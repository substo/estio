import { AI_CONFIG_KEYS, LOCATION_CONFIG_DEFAULTS, SEARCH_DEFAULT_KEYS } from "./model";

/**
 * What the one-time SiteConfig retirement writes for one Location (scripts/settings/retire-site-config.ts). Only values
 * missing from their new home are copied; a value already there wins and a different table value is reported. Values
 * equal to the old column defaults are not copied (the document's own defaults apply).
 */
type Row = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const empty = (v: unknown) => v === null || v === undefined || v === "";
const OLD_COLUMN_DEFAULTS: Row = {
    googleAiModel: "gemini-1.5-pro", googleAiModelExtraction: "gemini-1.5-flash", googleAiModelDesign: "gemini-1.5-pro",
    googleAiModelTranscription: "gemini-2.5-flash", googleAiModelTranslation: "gemini-flash-lite-latest", publicListingEnabled: true,
};

export function planSiteConfigRetirement(input: { row: Row; locationDomain: string | null; ai: Row | null; website: Row | null }) {
    const ai: Row = {}, website: Row = {}, report: string[] = [];
    let domain: string | null = null;
    const consider = (key: string, value: unknown, target: Row, doc: Row | null, label: string) => {
        if (empty(value)) return;
        const current = doc?.[key];
        if (current === undefined) {
            const columnDefault = key in OLD_COLUMN_DEFAULTS ? OLD_COLUMN_DEFAULTS[key] : (LOCATION_CONFIG_DEFAULTS as Row)[key];
            if (same(value, columnDefault)) return;
            target[key] = value; report.push(`copy ${key} -> ${label}: ${JSON.stringify(value).slice(0, 80)}`);
        } else if (!same(current, value)) report.push(`keep ${label}.${key} ${JSON.stringify(current).slice(0, 60)} (table had ${JSON.stringify(value).slice(0, 60)})`);
    };
    for (const key of AI_CONFIG_KEYS) consider(key, input.row[key], ai, input.ai, "AI settings");
    for (const key of [...SEARCH_DEFAULT_KEYS, "publicListingEnabled"]) consider(key, input.row[key], website, input.website, "website");
    const title = (input.row.substoSiteConfig as { title?: unknown } | null)?.title;
    if (typeof title === "string" && title.trim()) consider("siteTitle", title.trim(), website, input.website, "website");
    if (!empty(input.row.domain)) {
        if (!input.locationDomain) { domain = String(input.row.domain); report.push(`copy domain -> Location: ${domain}`); }
        else if (input.locationDomain !== input.row.domain) report.push(`keep Location.domain ${input.locationDomain} (table had ${input.row.domain})`);
    }
    if (!report.length) report.push("nothing to copy");
    return { ai, website, domain, report };
}
