import { notFound } from "next/navigation";
import db from "@/lib/db";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { getWebsitePage } from "@/lib/substo-sites/service";
import { WebsitePageView } from "@/components/website/page-view";
import { hostedPage } from "@/lib/website/hosted-content";
export default async function WebsiteHome({ params }: { params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  if (!site) notFound();
  const home = await getWebsitePage(db, site, "home");
  const page = site.homeBlocks ? { title: site.settings.title, blocks: site.homeBlocks } : home || { title: site.config?.name, blocks: [{ type: "hero", headline: site.settings.title, subheadline: site.settings.description, theme: "brand-solid", animation: "none" }] };
  return <WebsitePageView page={site.homeBlocks ? page : hostedPage(page, site.slug, site.config)} config={site.config} />;
}
