import { WebsiteShell } from "@/components/website/shell";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { sitePath } from "@/lib/substo-sites/policy";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  return site ? { title: { default: site.settings.title, template: `%s | ${site.settings.title}` }, description: site.settings.description, icons: { icon: "/images/substo-mark.svg" } } : {};
}
export default async function WebsiteLayout({ children, params }: { children: ReactNode; params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  if (!site) notFound();
  return <WebsiteShell config={site.config} basePath={sitePath(site.slug)} realEstateEnabled={false}>{children}</WebsiteShell>;
}
