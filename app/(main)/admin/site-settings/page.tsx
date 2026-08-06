import db from "@/lib/db";
import { SiteSettingsForm } from "./site-settings-form";
import { getLocationContext } from "@/lib/auth/location-context";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, isSettingsReadFromNewEnabled } from "@/lib/settings/constants";
import { listPublicSiteDomains } from "@/lib/public-site-domains/service";
import { PublicSiteDomainManager } from "./public-site-domain-manager";

export default async function SiteSettingsPage() {
    const contextLocation = await getLocationContext();
    const locationId = contextLocation?.id;

    if (!locationId) {
        return <div>No location context found.</div>;
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

    const initialDataBase = isSettingsReadFromNewEnabled() && settingsDoc
        ? {
            ...settingsDoc.payload,
            domain: canonicalDomain?.hostname ?? siteConfig?.domain ?? null,
            theme: settingsDoc.payload?.theme ?? siteConfig?.theme ?? {},
            contactInfo: settingsDoc.payload?.contactInfo ?? siteConfig?.contactInfo ?? {},
            navLinks: settingsDoc.payload?.navLinks ?? siteConfig?.navLinks ?? [],
            footerLinks: settingsDoc.payload?.footerLinks ?? siteConfig?.footerLinks ?? [],
            socialLinks: settingsDoc.payload?.socialLinks ?? siteConfig?.socialLinks ?? [],
            legalLinks: settingsDoc.payload?.legalLinks ?? siteConfig?.legalLinks ?? [],
            footerDisclaimer: settingsDoc.payload?.footerDisclaimer ?? siteConfig?.footerDisclaimer ?? null,
            footerBio: settingsDoc.payload?.footerBio ?? siteConfig?.footerBio ?? null,
            primaryColor: (settingsDoc.payload?.theme as any)?.primaryColor ?? siteConfig?.primaryColor ?? null,
            secondaryColor: (settingsDoc.payload?.theme as any)?.secondaryColor ?? siteConfig?.secondaryColor ?? null,
            accentColor: (settingsDoc.payload?.theme as any)?.accentColor ?? siteConfig?.accentColor ?? null,
        }
        : siteConfig
            ? { ...siteConfig, domain: canonicalDomain?.hostname ?? siteConfig.domain }
            : siteConfig;
    const initialData = {
        ...(initialDataBase || {}),
        marketProfile: settingsDoc?.payload?.marketProfile || {},
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
