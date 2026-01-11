"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";

type HeaderStyle = "transparent" | "solid" | string | null;

interface HeaderContextType {
    headerStyle: HeaderStyle;
    setHeaderStyle: (style: HeaderStyle) => void;
    defaultStyle: HeaderStyle;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export function HeaderProvider({
    children,
    defaultStyle = "transparent",
}: {
    children: React.ReactNode;
    defaultStyle?: HeaderStyle;
}) {
    const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(defaultStyle);
    const pathname = usePathname();

    // Reset to default style on navigation, unless a page component immediately overrides it.
    // However, the SetHeaderStyle component works by setting it on mount.
    // To avoid flickering, we can reset it in a useLayoutEffect or just rely on the Page component to set it if needed.
    // A safer bet for "Clean Slate" is to reset on pathname change.
    useEffect(() => {
        setHeaderStyle(defaultStyle);
    }, [pathname, defaultStyle]);

    return (
        <HeaderContext.Provider value={{ headerStyle, setHeaderStyle, defaultStyle }}>
            {children}
        </HeaderContext.Provider>
    );
}

export function useHeaderStyle() {
    const context = useContext(HeaderContext);
    if (context === undefined) {
        throw new Error("useHeaderStyle must be used within a HeaderProvider");
    }
    return context;
}

// Utility component to set the style from a Page
export function SetHeaderStyle({ style }: { style: HeaderStyle }) {
    const { setHeaderStyle } = useHeaderStyle();

    useEffect(() => {
        if (style) {
            // Defer execution to ensure this runs AFTER the HeaderProvider's reset effect
            // which runs on pathname change (Parent effects run after Child effects).
            const t = setTimeout(() => setHeaderStyle(style), 0);
            return () => clearTimeout(t);
        }
        // Return cleanup? If we navigate away, the Provider resets logic might handle it.
        // But if we unmount this component (e.g. conditional render), we might want to revert?
        // For now, page navigation is the main driver, so the Provider's useEffect [pathname] handles reset.
    }, [style, setHeaderStyle]);

    return null;
}
