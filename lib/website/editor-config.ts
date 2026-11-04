import "server-only";
import { getBusinessViewIfAny } from "@/lib/business-profile/service";
import { overlayBusinessDetails } from "@/lib/business-profile/overlay";
import db from "@/lib/db";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { hostedWebsiteConfig, websiteDesignSelect } from "./config";

export async function getEditorWebsiteConfig(locationId: string) {
    const realm = await getRequestAuthRealm();
    const row = await db.siteConfig.findFirst({ where: { locationId, location: { authRealm: realm || "estio" } }, select: { locationId: true, domain: true, substoSiteSlug: true, substoSiteConfig: true, homeSections: true, heroContent: true, ...websiteDesignSelect } });
    const view = await getBusinessViewIfAny(locationId);
    return realm === "substo" ? { ...hostedWebsiteConfig(overlayBusinessDetails({ ...row, locationId }, view), row?.substoSiteSlug || "preview"), homeSections: row?.homeSections, heroContent: row?.heroContent } : overlayBusinessDetails(row || { locationId }, view);
}
