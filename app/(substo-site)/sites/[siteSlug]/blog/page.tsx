import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { listWebsitePosts } from "@/lib/substo-sites/service";
import { sitePath } from "@/lib/substo-sites/policy";
export const metadata = { title: "Blog" };
export default async function WebsiteBlog({ params }: { params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  if (!site) notFound();
  const posts = await listWebsitePosts(db, site);
  return <div className="space-y-8"><h1 className="text-4xl font-semibold">Blog</h1>{posts.length ? posts.map((post) => <article key={post.slug} className="space-y-3 rounded-xl border p-6"><h2 className="text-2xl font-medium"><a href={`${sitePath(site.slug)}/blog/${encodeURIComponent(post.slug)}`}>{post.title}</a></h2>{post.excerpt ? <p className="text-slate-600">{post.excerpt}</p> : null}{post.publishedAt ? <time dateTime={post.publishedAt.toISOString()} className="text-sm text-slate-500">{post.publishedAt.toISOString().slice(0, 10)}</time> : null}</article>) : <p className="text-slate-600">No posts published yet.</p>}</div>;
}
