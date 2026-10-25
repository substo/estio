import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { getWebsitePost } from "@/lib/substo-sites/service";
import { WebsiteBlogPost } from "@/components/website/blog-post";
import { hostedHtml } from "@/lib/website/hosted-content";
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
  return <WebsiteBlogPost post={{ ...post, content: hostedHtml(post.content || "", site.slug) }} />;
}
