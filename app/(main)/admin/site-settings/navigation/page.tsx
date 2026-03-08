import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { MenuBuilder } from "./_components/menu-builder";
import { FooterBioEditor } from "./_components/footer-bio-editor";
import { FooterDisclaimerEditor } from "./_components/footer-disclaimer-editor";
import { SocialLinksEditor } from "./_components/social-links-editor";
import { getLivePages } from "./actions";
import { MenuStyleSelector } from "./_components/menu-style-selector";
import { PublicListingToggle } from "./_components/public-listing-toggle";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, isSettingsReadFromNewEnabled } from "@/lib/settings/constants";
import { getLocationContext } from "@/lib/auth/location-context";
import { cookies } from "next/headers";

export default async function NavigationSettingsPage() {
    const { userId } = await auth();
    if (!userId) return null;
    const cookieStore = await cookies();
    const contextLocation = await getLocationContext();
    const orgId = contextLocation?.id || cookieStore.get("crm_location_id")?.value || null;

    if (!orgId) return null;

    const [config, navigationDoc] = await Promise.all([
        db.siteConfig.findUnique({
            where: { locationId: orgId },
        }),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: orgId,
            domain: SETTINGS_DOMAINS.LOCATION_NAVIGATION,
        }),
    ]);

    const livePages = await getLivePages(orgId);
    const readNew = isSettingsReadFromNewEnabled() && Boolean(navigationDoc);
    const theme = (config?.theme as any) || {};

    const navLinks = readNew ? (navigationDoc?.payload?.navLinks || []) : ((config?.navLinks as any[]) || []);
    const footerLinks = readNew ? (navigationDoc?.payload?.footerLinks || []) : ((config?.footerLinks as any[]) || []);
    const socialLinks = readNew ? (navigationDoc?.payload?.socialLinks || []) : ((config?.socialLinks as any[]) || []);
    const legalLinks = readNew ? (navigationDoc?.payload?.legalLinks || []) : ((config?.legalLinks as any[]) || []);
    const footerDisclaimer = readNew ? (navigationDoc?.payload?.footerDisclaimer || "") : ((config?.footerDisclaimer as string) || "");
    const footerBio = readNew ? (navigationDoc?.payload?.footerBio || "") : ((config?.footerBio as string) || "");
    const menuStyle = readNew ? (navigationDoc?.payload?.menuStyle || "side") : (theme.menuStyle || "side");
    const publicListingEnabled = readNew
        ? (navigationDoc?.payload?.publicListingEnabled ?? true)
        : (config?.publicListingEnabled ?? true);

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
                <h2 className="text-xl font-bold">Bottom Footer</h2>
                <MenuBuilder locationId={orgId} type="legal" initialLinks={legalLinks} availablePages={livePages} />
                <FooterBioEditor locationId={orgId} initialText={footerBio} />
                <FooterDisclaimerEditor locationId={orgId} initialText={footerDisclaimer} />
                <SocialLinksEditor locationId={orgId} initialLinks={socialLinks} />
            </div>
        </div>
    );
}
