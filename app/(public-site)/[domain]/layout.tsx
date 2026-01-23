import { getSiteConfig } from "@/lib/public-data";
import { ensureContactExists } from "@/lib/auth/ensure-contact";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { Montserrat, Inter } from 'next/font/google';
import { PublicHeader } from "./_components/public-header";
import { PublicFooter } from "./_components/public-footer";
import "@/app/globals.css";
import { hexToHsl, getContrastColor } from "@/lib/utils";
import { ClerkProvider } from '@clerk/nextjs';
import { ThemeProvider } from "@/components/theme-provider";
import { HeaderProvider } from "./_components/header-context";
import { currentUser } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { CLERK_DEV_FAPI } from "@/lib/auth/clerk-config";

// Force dynamic rendering as domains vary
export const dynamic = "force-dynamic";

// Font Configuration
const montserrat = Montserrat({
    subsets: ['latin'],
    variable: '--font-heading',
    weight: ['300', '400', '500', '600', '700', '800']
});

const inter = Inter({
    subsets: ['latin'],
    variable: '--font-sans',
    weight: ['300', '400', '500', '600']
});

type Props = {
    children: React.ReactNode;
    params: Promise<{ domain: string }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) return { title: "Site Not Found" };

    const hero = config.heroContent as any;
    const theme = config.theme as any;

    // Favicon Logic:
    // 1. faviconUrl (Explicit browser icon)
    // 2. iconUrl (Brand icon used as fallback)
    // 3. logo.url (Main logo - discouraged for favicon but better than nothing)
    const favicon = theme?.logo?.faviconUrl || theme?.logo?.iconUrl || theme?.logo?.url;

    return {
        title: hero?.headline || config.location.name,
        description: hero?.subheadline,
        icons: favicon ? {
            icon: favicon,
            shortcut: favicon,
            apple: favicon,
        } : undefined,
    };
}

export default async function PublicSiteLayout(props: Props) {
    const params = await props.params;
    const { children } = props;

    console.log(`[PublicLayout] Rendering for domain: ${params.domain}`);

    // 1. Resolve Tenant
    const config = await getSiteConfig(params.domain);

    // 2. Security: If no config exists for this domain, 404 immediately.
    if (!config) {
        notFound();
    }

    // 3. Theming (Safe access to JSON)
    const theme = config.theme as any | null;
    const globalHeaderStyle = theme?.headerStyle || "transparent";

    // 4. Fail-Safe: Ensure Contact Exists (Public User)
    // If user is logged in via OAuth/Google, metadata might be missing.
    // This check ensures they are created as a Contact on valid access.
    if (config?.location?.id) {
        // Run in background (don't await to avoid blocking render completely, 
        // OR await if proper session setup is critical for children)
        // Since it's server component, awaiting is safer to ensure consistency
        await ensureContactExists(config.location.id);
    }
    // Map existing primary color handling to new CSS variable structure
    const primaryColor = theme?.primaryColor;

    // Convert to HSL for Tailwind
    const primaryHsl = primaryColor ? hexToHsl(primaryColor) : null;
    const primaryForegroundHsl = primaryColor ? getContrastColor(primaryColor) : null;

    // 4. Navigation (Safe access to JSON)
    // Cast to any first to avoid strict type mismatch, then shape it
    const rawNavLinks = (config.navLinks as any[]) || [];

    // Recursive filter to remove "Home" but keep categories
    // Also ensures the structure matches what PublicHeader expects
    const filterNavLinks = (links: any[]): any[] => {
        return links.filter(link => {
            // Remove explicit "Home" links unless they are categories
            if (link.label === 'Home' && (!link.children || link.children.length === 0)) return false;
            return true;
        }).map(link => ({
            ...link,
            children: link.children ? filterNavLinks(link.children) : []
        }));
    };

    const navLinks = filterNavLinks(rawNavLinks);

    // 5. Determine if this is a satellite domain (Tenant)
    // In Dev Mode: estio.co is Primary. downtowncyprus.site is Satellite.
    const isPrimary = params.domain === 'estio.co' || params.domain === 'localhost';
    const isSatellite = !isPrimary;

    // Explicitly cast to any to bypass complex Discriminated Union mismatch between Proxy/Satellite/Standard modes
    // This is temporary for the "Dev Mode Verification" phase.
    const providerProps: any = {
        allowedRedirectOrigins: [
            'https://estio.co',
            `https://${config.domain || ''}`,
        ].filter(Boolean)
    };

    // ==========================================================================
    // CLERK SATELLITE MODE CONFIGURATION
    // ==========================================================================
    // "Lazy" Satellite Mode:
    // We only enable isSatellite=true if the middleware detects an auth-related request
    // (Admin path, existing session cookie, or Auth ticket).
    // This prevents the automatic redirect loop for anonymous public visitors.
    // ==========================================================================

    // Check if middleware flagged this request for satellite mode
    const { headers } = require('next/headers'); // Dynamic import to avoid build issues if mixed
    const headerList = await headers();
    const enableSatellite = headerList.get("x-enable-satellite") === "true";

    if (isSatellite && enableSatellite) {
        // DEVELOPMENT: Enable satellite mode ONLY for authenticated sessions/flows
        providerProps.isSatellite = true;
        providerProps.signInUrl = "/sign-in";
        providerProps.signUpUrl = "/sign-up";
        // Dev FAPI (change to "clerk.estio.co" for production)
        providerProps.domain = CLERK_DEV_FAPI;
    } else if (isSatellite) {
        // ANONYMOUS: Public sites (No redirect loop)
        // Keep relative paths so the button links to the local sign-in page
        // (which then triggers satellite mode via middleware)
        providerProps.signInUrl = "/sign-in";
        providerProps.signUpUrl = "/sign-up";
    }

    // 6. Check Team Member Status used for Admin Dashboard Link
    const user = await currentUser();
    let isTeamMember = false;
    // Only check if we have a valid logged in user and known location
    if (user && config.location?.id) {
        isTeamMember = await verifyUserHasAccessToLocation(user.id, config.location.id);
        console.log(`[PublicLayout] Team Member Check for ${user.id} @ ${config.location.id}: ${isTeamMember}`);
    }

    return (
        <ClerkProvider {...providerProps}>
            <html lang="en" suppressHydrationWarning>
                <body className={`${inter.variable} ${montserrat.variable} font-sans min-h-screen flex flex-col`}>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="light"
                        enableSystem={false}
                        forcedTheme="light"
                        disableTransitionOnChange
                    >
                        <HeaderProvider defaultStyle={globalHeaderStyle}>
                            {/* Dynamic Theme Injection */}
                            {primaryHsl && (
                                <style>{`:root { 
                            --primary-brand: ${primaryHsl};
                            --primary: ${primaryHsl};
                            --primary-foreground: ${primaryForegroundHsl};
                            --ring: ${primaryHsl};
                            --input: ${primaryHsl};

                            ${theme?.secondaryColor ? `--secondary: ${hexToHsl(theme.secondaryColor)};` : ''}
                            ${theme?.accentColor ? `--accent: ${hexToHsl(theme.accentColor)};` : ''}
                            ${theme?.backgroundColor ? `--background: ${hexToHsl(theme.backgroundColor)};` : ''}
                            ${theme?.textColor ? `--foreground: ${hexToHsl(theme.textColor)};` : ''}
                        }`}</style>
                            )}

                            {/* Public Site Header */}
                            <PublicHeader
                                domain={config.domain || config.location.name || "Real Estate"}
                                navLinks={navLinks}
                                primaryColor={primaryColor}
                                logo={theme?.logo}
                                menuStyle={theme?.menuStyle}
                                publicListingEnabled={config.publicListingEnabled ?? true}
                                isTeamMember={isTeamMember}
                            />

                            {/* Main Content */}
                            <main className="flex-1">
                                {children}
                            </main>

                            {/* Public Footer */}
                            <PublicFooter
                                siteConfig={config}
                                primaryColor={primaryColor}
                            />
                        </HeaderProvider>
                    </ThemeProvider>
                </body>
            </html>
        </ClerkProvider>
    );
}
