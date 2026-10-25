import { createElement, Fragment, type ReactNode } from "react";
import { load } from "cheerio";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { safeImageUrl, siteLink, type WebsiteSettings } from "./policy";

const TAGS = new Set(["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "pre", "code", "hr", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "span", "div"]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "button", "textarea", "select", "template", "link", "meta", "base", "noscript"]);

/** HTML is parsed into a small React element vocabulary, never injected as raw HTML. */
export function PublicRichText({ html, slug }: { html?: string | null; slug: string }) {
  if (!html) return null;
  const $ = load(html.slice(0, 500_000), {}, false);
  function node(value: any, index: number, depth = 0): ReactNode {
    if (depth > 50) return null;
    if (value.type === "text") return value.data;
    const tag = String(value.name || "").toLowerCase();
    if (DROP.has(tag)) return null;
    const children = (value.children || []).map((child: unknown, childIndex: number) => node(child, childIndex, depth + 1));
    if (!TAGS.has(tag)) return createElement(Fragment, { key: index }, ...children);
    const attrs = value.attribs || {};
    if (tag === "img") {
      const src = safeImageUrl(attrs.src);
      return src ? createElement("img", { key: index, src, alt: String(attrs.alt || ""), loading: "lazy", referrerPolicy: "no-referrer", className: "my-6 h-auto max-w-full rounded-xl" }) : null;
    }
    if (tag === "a") {
      const href = siteLink(attrs.href, slug);
      return href ? createElement("a", { key: index, href, rel: "noopener noreferrer", className: "underline underline-offset-4" }, ...children) : createElement(Fragment, { key: index }, ...children);
    }
    return createElement(tag, { key: index }, ...children);
  }
  return <div className="prose prose-slate max-w-none break-words">{$.root().contents().toArray().map((value, index) => node(value, index))}</div>;
}

export function PublicImage({ value, alt }: { value?: string | null; alt: string }) {
  if (!value) return null;
  const src = safeImageUrl(value) ?? (/^[a-zA-Z0-9_-]{1,128}$/.test(value) ? safeImageUrl(getImageDeliveryUrl(value)) : null);
  return src ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="my-6 h-auto max-h-[32rem] w-full rounded-xl object-cover" /> : null;
}
const STATIC_BLOCKS = new Set(["hero", "text", "features", "feature-section", "testimonials", "pricing", "accordion", "stats", "gallery", "cta"]);
function value(record: any, ...keys: string[]): string {
  for (const key of keys) {
    if (typeof record?.[key] === "string") return record[key];
    if (typeof record?.[key] === "number" && Number.isFinite(record[key])) return String(record[key]);
  }
  return "";
}
function merge(text: string, settings: WebsiteSettings) {
  // Escape substitutions before parsing, so configured names cannot introduce markup.
  const escape = (input: string) => input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text.replace(/{{company_name}}/g, escape(settings.title)).replace(/{{company_email}}/g, escape(settings.email)).replace(/{{company_(?:phone|address|domain)}}/g, "");
}

/** Generic static blocks from the existing editor; property widgets and forms are not public capabilities. */
export function PublicPageContent({ content, blocks, slug, settings }: { content?: string | null; blocks?: unknown; slug: string; settings: WebsiteSettings }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return <PublicRichText html={content} slug={slug} />;
  return <div className="space-y-10">{blocks.slice(0, 100).map((block: any, index) => {
    if (!block || !STATIC_BLOCKS.has(block.type)) return null;
    const items = Array.isArray(block.items) ? block.items : Array.isArray(block.plans) ? block.plans : Array.isArray(block.stats) ? block.stats : [];
    const title = value(block, "headline", "title");
    const body = value(block, "htmlContent", "content", "text", "description", "subheadline", "subtitle", "subtext");
    const href = siteLink(block.ctaLink, slug);
    return <section key={index} className={block.type === "hero" || block.type === "cta" ? "rounded-2xl bg-slate-100 p-6 sm:p-10" : "space-y-4"}>
      {title ? <div className="mb-4 text-2xl font-semibold"><PublicRichText html={merge(title, settings)} slug={slug} /></div> : null}
      <PublicRichText html={merge(body, settings)} slug={slug} />
      <PublicImage value={value(block, "imageUrl", "image", "backgroundImage")} alt="" />
      {block.type === "gallery" && Array.isArray(block.images) ? <div className="grid gap-4 sm:grid-cols-2">{block.images.slice(0, 50).map((image: unknown, i: number) => typeof image === "string" ? <PublicImage key={i} value={image} alt="" /> : null)}</div> : null}
      {items.length ? <div className="grid gap-5 sm:grid-cols-2">{items.slice(0, 50).map((item: any, i: number) => <div key={i} className="space-y-2 rounded-xl border p-5">
        <PublicRichText html={merge(value(item, "title", "name", "label", "question"), settings)} slug={slug} />
        <PublicRichText html={merge(value(item, "description", "content", "quote", "answer", "value", "price"), settings)} slug={slug} />
        {Array.isArray(item.features) ? <ul className="list-inside list-disc">{item.features.slice(0, 30).map((feature: unknown, j: number) => typeof feature === "string" ? <li key={j}>{feature}</li> : null)}</ul> : null}
      </div>)}</div> : null}
      {href && block.ctaText ? <a className="mt-5 inline-flex rounded-md bg-slate-900 px-5 py-3 font-medium text-white" href={href}>{String(block.ctaText)}</a> : null}
    </section>;
  })}</div>;
}
