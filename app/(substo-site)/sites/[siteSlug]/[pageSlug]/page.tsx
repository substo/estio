import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { getWebsitePage } from "@/lib/substo-sites/service";
import { PublicPageContent } from "@/lib/substo-sites/content";
type Props = { params: Promise<{ siteSlug: string; pageSlug: string }> };
export async function generateMetadata({ params }: Props) {
  const path = await params;
  const site = await loadPublicWebsite(path.siteSlug);
  const page = site ? await getWebsitePage(db, site, path.pageSlug) : null;
  return page ? { title: page.metaTitle || page.title, description: page.metaDescription || undefined } : {};
}
export default async function WebsitePage({ params }: Props) {
  const path = await params;
  const site = await loadPublicWebsite(path.siteSlug);
  if (!site) notFound();
  const page = await getWebsitePage(db, site, path.pageSlug);
  if (!page) notFound();
  return <article className="space-y-8"><h1 className="text-4xl font-semibold tracking-tight">{page.title}</h1><PublicPageContent {...page} slug={site.slug} settings={site.settings} /></article>;
}
