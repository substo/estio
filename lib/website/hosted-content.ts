import { load } from "cheerio";
import { safeImageUrl, siteLink } from "@/lib/substo-sites/policy";

const tags = new Set("p br h1 h2 h3 h4 h5 h6 strong b em i u s ul ol li blockquote pre code hr a img table thead tbody tr th td span div".split(" "));
const drop = "script,style,iframe,object,embed,svg,math,form,input,button,textarea,select,template,link,meta,base,noscript";
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sanitize data before sending it to the shared client renderer. Never ship tenant HTML executable code. */
export function hostedHtml(html: string, slug: string): string {
    const $ = load(html.slice(0, 500_000), {}, false);
    $(drop).remove();
    $("*").each((_index, element) => {
        if (!("tagName" in element)) return;
        const node = $(element);
        if (!tags.has(element.tagName)) { node.replaceWith(node.contents()); return; }
        const attrs = { ...element.attribs };
        for (const key of Object.keys(attrs)) node.removeAttr(key);
        if (element.tagName === "a") {
            const href = siteLink(attrs.href, slug);
            if (href) node.attr("href", href).attr("rel", "noopener noreferrer");
        }
        if (element.tagName === "img") {
            const src = safeImageUrl(attrs.src);
            if (!src) { node.remove(); return; }
            node.attr("src", src).attr("alt", attrs.alt || "").attr("loading", "lazy").attr("referrerpolicy", "no-referrer");
        }
        if (attrs.class && /^[a-zA-Z0-9_!:\-\/ .%]+$/.test(attrs.class)) node.attr("class", attrs.class.slice(0, 2000));
        // Keep the editor's rich-text alignment/colour without accepting URL-bearing CSS.
        const styles = String(attrs.style || "").split(";").filter((rule) => /^\s*(?:text-align\s*:\s*(?:left|right|center|justify)|(?:color|background-color)\s*:\s*#[\da-f]{3,8})\s*$/i.test(rule));
        if (styles.length) node.attr("style", styles.join(";"));
    });
    return $.html();
}

/** Preserve the existing renderer's layout/theme/animation schema; only sanitize untrusted values and URLs. */
export function hostedBlocks(blocks: unknown, slug: string, config: any): any[] {
    const replacements: Record<string, string> = {
        company_name: config.name || "", company_email: config.contactInfo?.email || "",
        company_phone: config.contactInfo?.mobile || "", company_address: config.contactInfo?.address || "", company_domain: config.domain || "",
    };
    const htmlKeys = new Set(["headline", "subheadline", "title", "description", "subtext", "htmlContent", "content", "overlayCard", "value", "label", "author", "name", "trigger"]);
    function visit(value: any, key = "", depth = 0, blockType = ""): any {
        if (depth > 20) return null;
        if (Array.isArray(value)) return value.slice(0, 100).map((entry) => visit(entry, key === "images" ? "image" : "", depth + 1, blockType));
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([name]) => !["__proto__", "prototype", "constructor"].includes(name)).map(([name, entry]) => [name, visit(entry, name, depth + 1, value.type || blockType)]));
        if (typeof value !== "string") return value;
        if (/(?:href|link)$/i.test(key)) return siteLink(value, slug) || "#";
        if (/(?:image|imageUrl|avatarUrl|backgroundImage)$/i.test(key)) return safeImageUrl(value) || "";
        if (/color$/i.test(key)) return /^#[\da-f]{3,8}$/i.test(value) ? value : "";
        const isHtml = htmlKeys.has(key) && !(key === "subtext" && blockType === "form");
        return (isHtml ? hostedHtml(value, slug) : value.slice(0, 500_000)).replace(/{{(company_\w+)}}/g, (_match, name) => isHtml ? escape(replacements[name] || "") : replacements[name] || "");
    }
    return Array.isArray(blocks) ? blocks.filter((block) => block && !["featured-properties", "trusted-partners", "categories"].includes(block.type)).slice(0, 100).map((block) => visit(block)) : [];
}
export function hostedPage(page: any, slug: string, config: any) {
    return { ...page, content: hostedHtml(page.content || "", slug), blocks: hostedBlocks(page.blocks, slug, config), heroImage: safeImageUrl(page.heroImage) || null };
}
