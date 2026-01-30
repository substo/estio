import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { MenuBuilder } from "./_components/menu-builder";
import { FooterBioEditor } from "./_components/footer-bio-editor";
import { FooterDisclaimerEditor } from "./_components/footer-disclaimer-editor";
import { SocialLinksEditor } from "./_components/social-links-editor";
import { getLivePages } from "./actions";
import { MenuStyleSelector } from "./_components/menu-style-selector";
import { PublicListingToggle } from "./_components/public-listing-toggle";

export default async function NavigationSettingsPage() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) return null;

    const config = await db.siteConfig.findUnique({
        where: { locationId: orgId },
    });

    const livePages = await getLivePages();

    const navLinks = (config?.navLinks as any[]) || [];
    // @ts-ignore: footerLinks exists in schema
    const footerLinks = (config?.footerLinks as any[]) || [];
    // @ts-ignore: socialLinks exists in schema
    const socialLinks = (config?.socialLinks as any[]) || [];
    // @ts-ignore: legalLinks exists in schema
    const legalLinks = (config?.legalLinks as any[]) || [];
    // @ts-ignore: footerDisclaimer exists in schema
    const footerDisclaimer = (config?.footerDisclaimer as string) || "";
    // @ts-ignore: footerBio exists in schema
    const footerBio = (config?.footerBio as string) || "";

    // @ts-ignore: theme exists in schema
    const theme = (config?.theme as any) || {};
    const menuStyle = theme.menuStyle || "side";

    return (
        <div className="p-6 space-y-8 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold">Navigation Settings</h1>
                <p className="text-muted-foreground">Manage the links in your public site header and footer.</p>
            </div>

            <div className="grid gap-8">
                <MenuStyleSelector initialStyle={menuStyle} />
                <MenuBuilder type="nav" initialLinks={navLinks} availablePages={livePages} />
                <MenuBuilder type="footer" initialLinks={footerLinks} availablePages={livePages} />

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
                    <PublicListingToggle initialValue={config?.publicListingEnabled ?? true} />
                </div>

                <div className="border-t my-4 py-4" />
                <h2 className="text-xl font-bold">Bottom Footer</h2>
                <MenuBuilder type="legal" initialLinks={legalLinks} availablePages={livePages} />
                <FooterBioEditor initialText={footerBio} />
                <FooterDisclaimerEditor initialText={footerDisclaimer} />
                <SocialLinksEditor initialLinks={socialLinks} />
            </div>
        </div>
    );
}
