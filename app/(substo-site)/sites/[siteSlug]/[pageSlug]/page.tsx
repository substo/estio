import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { getWebsitePage } from "@/lib/substo-sites/service";
import { WebsitePageView } from "@/components/website/page-view";
import { hostedPage } from "@/lib/website/hosted-content";
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
  return <WebsitePageView page={hostedPage(page, site.slug, site.config)} config={site.config} />;
}
