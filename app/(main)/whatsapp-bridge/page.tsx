"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { FacebookSDKScript } from "@/components/integrations/facebook-sdk-script";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

// Official Meta Brand Assets
const MetaLogo = () => (
    <svg viewBox="0 0 32 32" className="w-8 h-8" fill="currentColor">
        <path d="M21.5 5h-11C4.7 5 0 9.7 0 15.5S4.7 26 10.5 26h11c5.8 0 10.5-4.7 10.5-10.5S27.3 5 21.5 5zm0 19h-11C5.8 24 2 20.2 2 15.5S5.8 7 10.5 7h11c4.7 0 8.5 3.8 8.5 8.5S26.2 24 21.5 24z" fill="#0668E1" />
        <path d="M16 11c-2.5 0-4.5 2-4.5 4.5S13.5 20 16 20s4.5-2 4.5-4.5S18.5 11 16 11zm0 7c-1.4 0-2.5-1.1-2.5-2.5S14.6 13 16 13s2.5 1.1 2.5 2.5S17.4 18 16 18z" fill="#0668E1" />
    </svg>
);

const WhatsAppLogo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#25D366">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

function BridgeContent() {
    const searchParams = useSearchParams();
    const originParam = searchParams.get("origin");
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [sdkReady, setSdkReady] = useState(false);
    const [hostname, setHostname] = useState<string>("");

    useEffect(() => {
        if (originParam) {
            try {
                setHostname(new URL(originParam).hostname);
            } catch (e) {
                setHostname("Unknown App");
            }
        }
    }, [originParam]);

    const handleLogin = () => {
        if (!window.FB) return;
        setStatus("loading");

        const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;

        // @ts-ignore - FB types might be incomplete
        window.FB.login(
            function (response: any) {
                if (response.authResponse) {
                    setStatus("success");
                    // Post back to opener
                    if (window.opener && originParam) {
                        window.opener.postMessage(
                            {
                                type: "WHATSAPP_SESSION",
                                payload: response.authResponse,
                            },
                            originParam
                        );
                        window.close();
                    } else {
                        setStatus("error");
                        console.error("No opener or origin found");
                    }
                } else {
                    setStatus("error");
                }
            },
            {
                config_id: configId,
                response_type: "code",
                override_default_response_type: true,
                extras: {
                    setup: {},
                },
            }
        );
    };

    if (!originParam) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="text-center p-8 bg-white rounded-xl shadow-lg border border-gray-100 max-w-md">
                    <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                        <span className="text-2xl">⚠️</span>
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">Configuration Error</h2>
                    <p className="text-gray-500 text-sm">Missing 'origin' parameter. Please close this window and try again from your dashboard.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F0F2F5] flex flex-col items-center justify-center p-4 font-sans text-slate-900">

            {/* Main Card */}
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-[440px] overflow-hidden border border-gray-200">

                {/* Header */}
                <div className="bg-white p-8 pb-6 flex flex-col items-center text-center space-y-4">
                    <div className="relative">
                        <div className="absolute -inset-1 rounded-full bg-blue-100 opacity-50 blur"></div>
                        <WhatsAppLogo />
                    </div>

                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Connect WhatsApp</h1>
                        <p className="text-gray-500 text-[15px] leading-relaxed">
                            Authorize <strong>{hostname}</strong> to manage your WhatsApp Business Account.
                        </p>
                    </div>
                </div>

                <div className="px-8 pb-8 space-y-6">
                    {/* Security Badge */}
                    <div className="flex items-start gap-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                        <ShieldCheck className="w-5 h-5 text-[#1877F2] mt-0.5 shrink-0" />
                        <p className="text-xs text-blue-800 leading-snug">
                            This connection is secure. You will be redirected to Facebook to approve permissions.
                        </p>
                    </div>

                    {/* Action Button */}
                    <Button
                        size="lg"
                        onClick={handleLogin}
                        disabled={status === "loading" || !sdkReady}
                        className="w-full h-12 text-[16px] font-semibold bg-[#1877F2] hover:bg-[#166FE5] active:bg-[#1464D1] text-white shadow-sm transition-all duration-200 ease-in-out rounded-lg flex items-center justify-center gap-2"
                    >
                        {status === "loading" ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Connecting...
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                </svg>
                                Continue with Facebook
                            </>
                        )}
                    </Button>

                    {/* Footer */}
                    <div className="pt-2 text-center">
                        <p className="text-xs text-gray-400">
                            Powered by Meta Business SDK
                        </p>
                    </div>

                    {status === "error" && (
                        <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg text-center font-medium animate-in fade-in slide-in-from-top-1">
                            Login cancelled or failed. Please try again.
                        </div>
                    )}
                </div>

                {/* Progress Bar (Fake loader line at top if loading) */}
                {status === "loading" && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-blue-100 overflow-hidden">
                        <div className="w-full h-full bg-[#1877F2] animate-progress-origin"></div>
                    </div>
                )}
            </div>

            <style jsx global>{`
                @keyframes progress-origin {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .animate-progress-origin {
                    animation: progress-origin 1.5s infinite linear;
                }
            `}</style>

            <FacebookSDKScript appId={process.env.NEXT_PUBLIC_META_APP_ID || ""} onReady={() => setSdkReady(true)} />
        </div>
    );
}

export default function WhatsAppBridgePage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[#F0F2F5]"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>}>
            <BridgeContent />
        </Suspense>
    );
}
