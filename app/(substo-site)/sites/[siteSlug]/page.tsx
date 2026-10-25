import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { getWebsitePage, listWebsitePosts } from "@/lib/substo-sites/service";
import { PublicPageContent } from "@/lib/substo-sites/content";
import { sitePath } from "@/lib/substo-sites/policy";
export default async function WebsiteHome({ params }: { params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  if (!site) notFound();
  const home = await getWebsitePage(db, site, "home");
  if (home) return <article className="space-y-8"><h1 className="text-4xl font-semibold tracking-tight">{home.title}</h1><PublicPageContent {...home} slug={site.slug} settings={site.settings} /></article>;
  const posts = await listWebsitePosts(db, site);
  return <div className="space-y-10"><section className="space-y-5 py-10"><h1 className="text-5xl font-semibold tracking-tight" style={{ color: site.settings.accent }}>{site.settings.title}</h1>{site.settings.description ? <p className="max-w-3xl text-xl leading-relaxed text-slate-600">{site.settings.description}</p> : null}</section>{posts.length ? <section className="space-y-5"><h2 className="text-2xl font-semibold">Latest posts</h2>{posts.slice(0, 6).map((post) => <article key={post.slug} className="rounded-xl border p-6"><a className="text-xl font-medium underline-offset-4 hover:underline" href={`${sitePath(site.slug)}/blog/${encodeURIComponent(post.slug)}`}>{post.title}</a>{post.excerpt ? <p className="mt-3 text-slate-600">{post.excerpt}</p> : null}</article>)}</section> : null}</div>;
}
