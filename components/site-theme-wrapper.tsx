"use client";

import { hexToHsl, getContrastColor } from "@/lib/utils";
import React from "react";

interface SiteThemeWrapperProps {
    siteConfig: any;
    children: React.ReactNode;
    className?: string;
}

export function SiteThemeWrapper({ siteConfig, children, className }: SiteThemeWrapperProps) {
    if (!siteConfig) return <>{children}</>;

    const theme = siteConfig.theme as any | null;
    const primaryColor = theme?.primaryColor;

    // Convert to HSL for Tailwind
    const primaryHsl = primaryColor ? hexToHsl(primaryColor) : null;
    const primaryForegroundHsl = primaryColor ? getContrastColor(primaryColor) : null;

    const style: React.CSSProperties = primaryHsl ? {
        // @ts-ignore - Custom CSS variables
        "--primary-brand": primaryHsl,
        "--primary": primaryHsl,
        "--primary-foreground": primaryForegroundHsl,
        "--ring": primaryHsl,
        "--input": primaryHsl,
        ...(theme?.secondaryColor ? { "--secondary": hexToHsl(theme.secondaryColor) } : {}),
        ...(theme?.accentColor ? { "--accent": hexToHsl(theme.accentColor) } : {}),
        ...(theme?.backgroundColor ? { "--background": hexToHsl(theme.backgroundColor) } : {}),
        ...(theme?.textColor ? { "--foreground": hexToHsl(theme.textColor) } : {}),
    } : {};

    return (
        <div style={style} className={className}>
            {children}
        </div>
    );
}
