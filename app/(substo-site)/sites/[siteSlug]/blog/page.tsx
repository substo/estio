import { WebsiteBlogIndex } from "@/components/website/blog-index";
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
  return <WebsiteBlogIndex posts={posts} basePath={sitePath(site.slug)} />;
}
