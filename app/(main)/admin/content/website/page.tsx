import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocationConfig } from "@/lib/location-config/service";
import { getSubstoLocationActor } from "@/lib/locations/substo-locations";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { sitePath, websiteSettings } from "@/lib/substo-sites/policy";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { getLocationContext } from "@/lib/auth/location-context";
import { listPublicSiteDomains } from "@/lib/public-site-domains/service";
import { PublicSiteDomainManager } from "./public-site-domain-manager";
import { WebsiteForm } from "./website-form";
export default async function WebsiteSettingsPage() {
  if (await getRequestAuthRealm() !== "substo") {
    const location = await getLocationContext();
    if (!location) notFound();
    const locationId = location.id;
    const domains = await listPublicSiteDomains(locationId);
    return (
      <div className="max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Website publishing</h1>
          <p className="mt-2 text-muted-foreground">Manage the public domains for your website.</p>
        </div>
        <PublicSiteDomainManager
            locationId={locationId}
            initialDomains={domains.map((item) => ({
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
      </div>
    );
  }

  const actor = await getSubstoLocationActor();
  if (!actor) notFound();
  const config = await getLocationConfig(actor.locationId);
  const row = { substoSiteSlug: config.substoSiteSlug, substoSitePublished: config.substoSitePublished, substoSiteConfig: config.substoSiteConfig };
  const origin = getHostOrigin((await headers()).get("host")) || "";
  return <div className="space-y-6 p-6">
    <div>
      <h1 className="text-2xl font-semibold">Website publishing</h1>
      <p className="mt-2 text-muted-foreground">Choose your public website address and control when the site is live.</p>
    </div>
    {row.substoSitePublished && row.substoSiteSlug
      ? <a className="text-sm underline" href={sitePath(row.substoSiteSlug)} target="_blank" rel="noopener noreferrer">View website</a>
      : null}
    {actor.role === "ADMIN"
      ? <WebsiteForm key={`${actor.locationId}:${row.substoSiteSlug}:${row.substoSitePublished}`} origin={origin}
          slug={row.substoSiteSlug || `brand-${actor.locationId.slice(-10)}`} published={row.substoSitePublished ?? false}
          settings={websiteSettings(row.substoSiteConfig, actor.locationName)} />
      : <p className="text-sm text-muted-foreground">Only brand admins can change the address or publish the website.</p>}
  </div>;
}
