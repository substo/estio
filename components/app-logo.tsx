"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

interface AppLogoProps {
    size?: "sm" | "md" | "lg";
    showName?: boolean;
    linkToHome?: boolean;
    className?: string;
    url?: string;
    lightUrl?: string;
}

const sizeConfig = {
    sm: { height: 35, width: 95, text: "text-base" }, // approx 3:1 ratio
    md: { height: 40, width: 120, text: "text-lg" },
    lg: { height: 48, width: 144, text: "text-xl" },
};

export const APP_NAME = "Estio";

export function AppLogo({
    size = "md",
    showName = false,
    linkToHome = true,
    className,
    url,
    lightUrl,
}: AppLogoProps) {
    const { resolvedTheme } = useTheme();
    const config = sizeConfig[size];
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Default Logos (Local 1K Cropped)
    const DEFAULT_DARK_MODE_LOGO = "/images/estio logo/estio logo dark mode 1K.png";  // White Text
    const DEFAULT_LIGHT_MODE_LOGO = "/images/estio logo/estio logo light mode 1K.png"; // Dark Text

    // Determine which URL to use
    // 1. Dark Mode: Use lightUrl (if custom) OR Default Dark Mode Logo
    // 2. Light Mode: Use url (if custom) OR Default Light Mode Logo

    let targetUrl = DEFAULT_LIGHT_MODE_LOGO;

    if (mounted) {
        if (resolvedTheme === "dark") {
            targetUrl = lightUrl || DEFAULT_DARK_MODE_LOGO;
        } else {
            targetUrl = url || DEFAULT_LIGHT_MODE_LOGO;
        }
    } else {
        // SSR Fallback
        targetUrl = url || DEFAULT_LIGHT_MODE_LOGO;
    }

    const effectiveUrl = targetUrl;

    const content = (
        <div className={cn("flex items-center gap-2", className)}>
            <img
                src={effectiveUrl}
                alt={APP_NAME}
                style={{ height: config.height, width: 'auto' }}
                className="object-contain"
            />
            {/* Logo image already includes text */}
            {showName && (
                <span className={cn("font-bold sr-only", config.text)}>{APP_NAME}</span>
            )}
        </div>
    );

    if (linkToHome) {
        return (
            <Link href="/" className="flex items-center gap-2" aria-label="Home">
                {content}
            </Link>
        );
    }

    return content;
}
