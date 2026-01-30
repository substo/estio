"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

interface FacebookSDKScriptProps {
    appId: string;
    onReady?: () => void;
}

export function FacebookSDKScript({ appId, onReady }: FacebookSDKScriptProps) {
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (window.FB) {
            setLoaded(true);
            onReady?.();
        }

        // Define the callback that the SDK will call when loaded
        (window as any).fbAsyncInit = function () {
            window.FB.init({
                appId: appId,
                cookie: true,
                xfbml: true,
                version: "v21.0", // Use latest version
            });
            setLoaded(true);
            onReady?.();
        };
    }, [appId, onReady]);

    return (
        <Script
            id="facebook-jssdk"
            src="https://connect.facebook.net/en_US/sdk.js"
            strategy="lazyOnload"
            onLoad={() => {
                // Sometimes onLoad triggers before fbAsyncInit if simplified
            }}
        />
    );
}

// Global type augmentation
declare global {
    interface Window {
        FB: any;
        fbAsyncInit: () => void;
    }
}
