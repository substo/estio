import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { HeaderProvider } from "@/app/(public-site)/[domain]/_components/header-context";
import { PublicHeader } from "@/app/(public-site)/[domain]/_components/public-header";
import { PublicFooter } from "@/app/(public-site)/[domain]/_components/public-footer";
import { hexToHsl, getContrastColor } from "@/lib/utils";

export function WebsiteShell({ config, children, navLinks = config.navLinks || [], isTeamMember = false, realEstateEnabled = true, basePath = "", analytics }: {
    config: any; children: ReactNode; navLinks?: any[]; isTeamMember?: boolean; realEstateEnabled?: boolean; basePath?: string; analytics?: ReactNode;
}) {
    const theme = config.theme;
    const globalHeaderStyle = theme?.headerStyle || "transparent";
    const primaryColor = theme?.primaryColor;
    const primaryHsl = primaryColor ? hexToHsl(primaryColor) : null;
    const primaryForegroundHsl = primaryColor ? getContrastColor(primaryColor) : null;
    return (
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
                    realEstateEnabled={realEstateEnabled}
                    basePath={basePath}
                />

                {/* Main Content */}
                {analytics}
                <main className="flex-1">
                    {children}
                </main>

                {/* Public Footer */}
                <PublicFooter
                    siteConfig={config}
                    realEstateEnabled={realEstateEnabled}
                    primaryColor={primaryColor}
                />
            </HeaderProvider>
        </ThemeProvider>
    );
}
