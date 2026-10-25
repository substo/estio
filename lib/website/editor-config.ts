import "server-only";
import db from "@/lib/db";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { hostedWebsiteConfig, websiteDesignSelect } from "./config";

export async function getEditorWebsiteConfig(locationId: string) {
    const realm = await getRequestAuthRealm();
    const row = await db.siteConfig.findFirst({ where: { locationId, location: { authRealm: realm || "estio" } }, select: { locationId: true, domain: true, substoSiteSlug: true, substoSiteConfig: true, homeSections: true, heroContent: true, ...websiteDesignSelect } });
    return realm === "substo" ? { ...hostedWebsiteConfig({ ...row, locationId }, row?.substoSiteSlug || "preview"), homeSections: row?.homeSections, heroContent: row?.heroContent } : row || { locationId };
}
