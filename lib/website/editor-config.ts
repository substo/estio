import "server-only";
import { getLocationConfig } from "@/lib/location-config/service";
import { getBusinessViewIfAny } from "@/lib/business-profile/service";
import { overlayBusinessDetails } from "@/lib/business-profile/overlay";
import { getWebsiteSettings } from "./settings-service";
import { overlayWebsiteLayout } from "./settings";
import db from "@/lib/db";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { hostedWebsiteConfig } from "./config";

export async function getEditorWebsiteConfig(locationId: string) {
    const realm = await getRequestAuthRealm();
    // Only a Location of the requesting app has a stored config here (realm guard kept from the SiteConfig query).
    const owned = await db.location.findFirst({ where: { id: locationId, authRealm: realm || "estio" }, select: { id: true } });
    const stored = owned ? await getLocationConfig(locationId) : null;
    const [view, website] = await Promise.all([getBusinessViewIfAny(locationId), getWebsiteSettings(locationId)]);
    // Layout from the website document over the stored row; business fields from the profile.
    const row = overlayWebsiteLayout(stored ?? (website ? { locationId } : null), website?.payload) as typeof stored;
    return realm === "substo" ? { ...hostedWebsiteConfig(overlayBusinessDetails({ ...row, locationId }, view), row?.substoSiteSlug || "preview"), homeSections: row?.homeSections, heroContent: row?.heroContent } : overlayBusinessDetails(row || { locationId }, view);
}
