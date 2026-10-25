import { notFound } from "next/navigation";
import db from "@/lib/db";
import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { WebsitePageView } from "@/components/website/page-view";
import { getEditorWebsiteConfig } from "@/lib/website/editor-config";
import { SiteThemeWrapper } from "@/components/site-theme-wrapper";
import { HeaderProvider } from "@/app/(public-site)/[domain]/_components/header-context";
import { hostedPage } from "@/lib/website/hosted-content";
export default async function PagePreview({ params }: { params: Promise<{ id: string }> }) {
  if (await getRequestAuthRealm() !== "substo") notFound();
  const access = await getActiveContactsAccess();
  if (!access) notFound();
  const page = await db.contentPage.findFirst({ where: { id: (await params).id, locationId: access.locationId }, select: { title: true, content: true, blocks: true, headerStyle: true, heroImage: true } });
  if (!page) notFound();
  const config = await getEditorWebsiteConfig(access.locationId);
  return <HeaderProvider defaultStyle="solid"><SiteThemeWrapper siteConfig={config}><p className="p-6 text-sm text-muted-foreground">Saved page preview · Visible only to your brand team</p><WebsitePageView page={hostedPage(page, "preview", config)} config={config} /></SiteThemeWrapper></HeaderProvider>;
}
