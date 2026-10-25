import { headers } from "next/headers";
import db from "@/lib/db";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { listWebsitePages, listWebsitePosts } from "@/lib/substo-sites/service";
import { sitePath } from "@/lib/substo-sites/policy";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  const origin = getHostOrigin((await headers()).get("host"));
  if (!site || !origin) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const [pages, posts] = await Promise.all([listWebsitePages(db, site), listWebsitePosts(db, site)]);
  const base = sitePath(site.slug);
  const paths = [base, `${base}/blog`, ...pages.filter((page) => page.slug !== "home").map((page) => `${base}/${encodeURIComponent(page.slug)}`), ...posts.map((post) => `${base}/blog/${encodeURIComponent(post.slug)}`)];
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escape(origin + path)}</loc></url>`).join("")}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
