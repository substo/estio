import { getLocationConfig } from "@/lib/location-config/service";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import db from "@/lib/db";
import { MenuBuilder } from "./_components/menu-builder";
import { FooterBioEditor } from "./_components/footer-bio-editor";
import { FooterDisclaimerEditor } from "./_components/footer-disclaimer-editor";
import { SocialLinksEditor } from "./_components/social-links-editor";
import { getLivePages } from "./actions";
import { MenuStyleSelector } from "./_components/menu-style-selector";
import { PublicListingToggle } from "./_components/public-listing-toggle";
import { getWebsiteSettings } from "@/lib/website/settings-service";
import { overlayWebsiteLayout } from "@/lib/website/settings";
import { getLocationContext } from "@/lib/auth/location-context";
import { getBusinessViewIfAny } from "@/lib/business-profile/service";

export default async function NavigationSettingsPage() {
    const contextLocation = await getLocationContext();
    const orgId = contextLocation?.id || null;

    if (!orgId) return null;

    // Layout from the website document over the stored row (Locations without a document keep the row).
    const [config, website] = await Promise.all([
        getLocationConfig(orgId),
        getWebsiteSettings(orgId),
    ]);
    const row = overlayWebsiteLayout({ ...(config ?? {}) } as Record<string, any>, website?.payload);

    const realEstateEnabled = await getRequestAuthRealm() !== "substo";
    const livePages = await getLivePages(orgId);
    const theme = (row.theme as any) || {};

    const navLinks = (row.navLinks as any[]) || [];
    const footerLinks = (row.footerLinks as any[]) || [];
    const business = await getBusinessViewIfAny(orgId);
    const socialLinks = business ? business.socialLinks : ((row.socialLinks as any[]) || []);
    const legalLinks = (row.legalLinks as any[]) || [];
    const footerDisclaimer = (row.footerDisclaimer as string) || "";
    const footerBio = business ? (business.summary || "") : ((row.footerBio as string) || "");
    const menuStyle = theme.menuStyle || row.menuStyle || "side";
    const publicListingEnabled = row.publicListingEnabled ?? true;

    return (
        <div className="p-6 space-y-8 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold">Navigation Settings</h1>
                <p className="text-muted-foreground">Manage the links in your public site header and footer.</p>
            </div>

            <div className="grid gap-8">
                <MenuStyleSelector locationId={orgId} initialStyle={menuStyle} />
                <MenuBuilder locationId={orgId} type="nav" initialLinks={navLinks} availablePages={livePages} />
                <MenuBuilder locationId={orgId} type="footer" initialLinks={footerLinks} availablePages={livePages} />

                {realEstateEnabled && <>
                <div className="border-t my-4 py-4" />
                <h2 className="text-xl font-bold">Public Contributions</h2>
                <div className="bg-card border rounded-lg p-4 flex items-center justify-between">
                    <div className="space-y-0.5">
                        <label className="text-base font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Allow Public Property Listings
                        </label>
                        <p className="text-sm text-muted-foreground">
                            If enabled, a "List Your Property" button will appear in the header, allowing users to submit properties.
                        </p>
                    </div>
                    {/* We need a client component here. I will just render it. */}
                    <PublicListingToggle locationId={orgId} initialValue={publicListingEnabled} />
                </div>

                <div className="border-t my-4 py-4" />
                </>}
                <h2 className="text-xl font-bold">Bottom Footer</h2>
                <MenuBuilder locationId={orgId} type="legal" initialLinks={legalLinks} availablePages={livePages} />
                <FooterBioEditor locationId={orgId} initialText={footerBio} />
                <FooterDisclaimerEditor locationId={orgId} initialText={footerDisclaimer} />
                <SocialLinksEditor locationId={orgId} initialLinks={socialLinks} />
            </div>
        </div>
    );
}
