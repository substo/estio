import { notFound } from "next/navigation";
import db from "@/lib/db";
import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { PublicPageContent } from "@/lib/substo-sites/content";
import { websiteSettings } from "@/lib/substo-sites/policy";
export default async function PagePreview({ params }: { params: Promise<{ id: string }> }) {
  if (await getRequestAuthRealm() !== "substo") notFound();
  const access = await getActiveContactsAccess();
  if (!access) notFound();
  const page = await db.contentPage.findFirst({ where: { id: (await params).id, locationId: access.locationId }, select: { title: true, content: true, blocks: true } });
  if (!page) notFound();
  const config = await db.siteConfig.findUnique({ where: { locationId: access.locationId }, select: { substoSiteSlug: true, substoSiteConfig: true } });
  return <article className="mx-auto max-w-5xl space-y-8 p-6"><p className="text-sm text-muted-foreground">Saved page preview · Visible only to your brand team</p><h1 className="text-4xl font-semibold">{page.title}</h1><PublicPageContent {...page} slug={config?.substoSiteSlug || "preview"} settings={websiteSettings(config?.substoSiteConfig)} /></article>;
}
