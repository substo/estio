import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { getWebsitePost } from "@/lib/substo-sites/service";
import { PublicRichText, PublicImage } from "@/lib/substo-sites/content";
type Props = { params: Promise<{ siteSlug: string; postSlug: string }> };
export async function generateMetadata({ params }: Props) {
  const path = await params;
  const site = await loadPublicWebsite(path.siteSlug);
  const post = site ? await getWebsitePost(db, site, path.postSlug) : null;
  return post ? { title: post.title, description: post.excerpt || undefined } : {};
}
export default async function WebsitePost({ params }: Props) {
  const path = await params;
  const site = await loadPublicWebsite(path.siteSlug);
  if (!site) notFound();
  const post = await getWebsitePost(db, site, path.postSlug);
  if (!post) notFound();
  return <article className="space-y-6"><h1 className="text-4xl font-semibold tracking-tight">{post.title}</h1>{post.excerpt ? <p className="text-xl text-slate-600">{post.excerpt}</p> : null}<div className="flex gap-4 text-sm text-slate-500">{post.authorName ? <span>By {post.authorName}</span> : null}{post.publishedAt ? <time dateTime={post.publishedAt.toISOString()}>{post.publishedAt.toISOString().slice(0, 10)}</time> : null}</div><PublicImage value={post.coverImage} alt={post.title} /><PublicRichText html={post.content} slug={site.slug} /></article>;
}
