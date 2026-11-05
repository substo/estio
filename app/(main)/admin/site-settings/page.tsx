import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { getEditorWebsiteConfig } from "@/lib/website/editor-config";
import { getSubstoLocationActor } from "@/lib/locations/substo-locations";
import { notFound } from "next/navigation";
import Link from "next/link";
import db from "@/lib/db";
import { SiteSettingsForm } from "./site-settings-form";
import { getLocationContext } from "@/lib/auth/location-context";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { overlayWebsiteLayout } from "@/lib/website/settings";
import { listPublicSiteDomains } from "@/lib/public-site-domains/service";
import { PublicSiteDomainManager } from "./public-site-domain-manager";
import { getBusinessViewIfAny } from "@/lib/business-profile/service";
import { overlayBusinessDetails } from "@/lib/business-profile/overlay";

export default async function SiteSettingsPage() {
    const contextLocation = await getLocationContext();
    const locationId = contextLocation?.id;

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    if (await getRequestAuthRealm() === "substo") {
        const actor = await getSubstoLocationActor();
        if (!actor || actor.role !== "ADMIN") notFound();
        const config = await getEditorWebsiteConfig(locationId);
        return <div className="p-6 max-w-4xl space-y-6"><div><h1 className="text-2xl font-bold tracking-tight">Public Website Settings</h1><p className="text-muted-foreground">Configure how your website looks to the public.</p></div><Link href="/admin/content/website" className="underline">Website address and publishing</Link><div className="border rounded-lg p-6 bg-card"><SiteSettingsForm initialData={config} locationId={locationId} locationName={actor.locationName} locationTimeZone="" settingsVersion={0} realEstateEnabled={false} /></div></div>;
    }

    // Fetch existing config + location details + new settings document
    const [siteConfig, location, settingsDoc, publicSiteDomains] = await Promise.all([
        db.siteConfig.findUnique({
            where: { locationId },
        }),
        db.location.findUnique({
            where: { id: locationId },
            select: { name: true, timeZone: true },
        }),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
        }),
        listPublicSiteDomains(locationId),
    ]);

    const canonicalDomain = publicSiteDomains.find((item) => item.role === "CANONICAL" && item.status === "ACTIVE");

    // Layout from the website document over the stored row (Locations without a document keep the row); domain from the
    // active canonical domain.
    const initialDataBase = siteConfig || settingsDoc
        ? { ...overlayWebsiteLayout({ ...(siteConfig ?? {}) } as Record<string, any>, settingsDoc?.payload), domain: canonicalDomain?.hostname ?? siteConfig?.domain ?? null }
        : null;
    // Contact details, brand colours, logos and market come from the Business profile; layout from website settings.
    const business = await getBusinessViewIfAny(locationId);
    const initialData = {
        ...overlayBusinessDetails({ ...(initialDataBase || {}) } as Record<string, any>, business),
        marketProfile: business ? { countryCode: business.market.countryCode, countryName: business.market.countryName, locale: business.market.locale,
            currencyCode: business.market.currencyCode, supportedLanguages: business.market.supportedLanguages, serviceAreas: business.market.serviceAreas }
            : {},
    };

    const settingsVersion = settingsDoc?.version ?? 0;

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Public Website Settings</h1>
                <p className="text-muted-foreground">
                    Configure how your real estate site looks to the public.
                </p>
            </div>

            <PublicSiteDomainManager
                locationId={locationId}
                initialDomains={publicSiteDomains.map((item) => ({
                    id: item.id,
                    hostname: item.hostname,
                    role: item.role,
                    status: item.status,
                    verificationToken: item.verificationToken,
                    provisioningError: item.provisioningError,
                    verifiedAt: item.verifiedAt?.toISOString() || null,
                    activatedAt: item.activatedAt?.toISOString() || null,
                }))}
            />

            <div className="border rounded-lg p-6 bg-card">
                <SiteSettingsForm
                    initialData={initialData}
                    locationId={locationId}
                    locationName={location?.name || ""}
                    locationTimeZone={location?.timeZone || ""}
                    settingsVersion={settingsVersion}
                />
            </div>

        </div>
    );
}
