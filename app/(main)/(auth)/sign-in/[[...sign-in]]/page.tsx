"use client"
import PageWrapper from "@/components/wrapper/page-wrapper";
import config from "@/config";
import { SignIn, useAuth, useClerk, useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useBrandExperience } from "@/components/wrapper/brand-experience";
import { safeAuthRedirect, signedInHandoff } from "@/lib/auth/host-routing-policy";

const HANDOFF_STORAGE_KEY = "substo-signed-in-handoff-at";

function SignInContent() {
    const brand = useBrandExperience();
    const router = useRouter();
    const clerk = useClerk();
    const { isLoaded: authLoaded, isSignedIn } = useAuth();
    const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
    const [isMounted, setIsMounted] = useState(false);
    const [isProcessingTicket, setIsProcessingTicket] = useState(false);
    const [ticketError, setTicketError] = useState<string | null>(null);
    const ticketAttempted = useRef(false);
    const [handoff, setHandoff] = useState<"none" | "redirect" | "stalled">("none");

    // Prevent hydration mismatch by only rendering Clerk components after mount
    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (!config?.auth?.enabled) {
            router.back();
        }
    }, [router]);

    useEffect(() => {
        if (!isMounted || !authLoaded || !signInLoaded || ticketAttempted.current) return;
        const params = new URLSearchParams(window.location.search);
        const ticket = params.get("__clerk_ticket");
        if (!ticket) return;

        ticketAttempted.current = true;
        setIsProcessingTicket(true);
        const ticketUrl = window.location.href;
        const redirectUrl = safeAuthRedirect(params.get("redirect_url"), brand);

        void (async () => {
            try {
                if (isSignedIn) {
                    await clerk.signOut({ redirectUrl: ticketUrl });
                    return;
                }
                const result = await signIn.create({ strategy: "ticket", ticket });
                if (result.status !== "complete" || !result.createdSessionId) {
                    throw new Error("Ticket verification did not create a session.");
                }
                await setActive({ session: result.createdSessionId });
                window.location.replace(redirectUrl);
            } catch (error) {
                const clerkError = error && typeof error === "object" && "errors" in error
                    ? (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors?.[0]
                    : undefined;
                setTicketError(clerkError?.longMessage || clerkError?.message || (error instanceof Error ? error.message : "Failed to verify ticket."));
                setIsProcessingTicket(false);
            }
        })();
    }, [authLoaded, brand, clerk, isMounted, isSignedIn, setActive, signIn, signInLoaded]);

    useEffect(() => {
        if (!isMounted || !authLoaded || !isSignedIn) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("__clerk_ticket")) return;
        const stored = Number(window.sessionStorage.getItem(HANDOFF_STORAGE_KEY));
        const next = signedInHandoff(brand, Number.isFinite(stored) && stored > 0 ? stored : null, Date.now());
        setHandoff(next);
        if (next !== "redirect") return;
        window.sessionStorage.setItem(HANDOFF_STORAGE_KEY, String(Date.now()));
        window.location.replace(safeAuthRedirect(params.get("redirect_url"), brand));
    }, [authLoaded, brand, isMounted, isSignedIn]);

    return (
        <PageWrapper >
            <div className="flex flex-col items-center min-w-screen justify-center my-[5rem]">
                {ticketError ? <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-600">{ticketError}</div> : null}
                {handoff === "stalled" ? (
                    <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                        <p>You are signed in, but the session could not be confirmed yet.</p>
                        <a className="font-medium text-primary hover:underline" href="/studio">Continue to Studio</a>
                    </div>
                ) : handoff === "redirect" ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Opening Studio...</span>
                    </div>
                ) : isProcessingTicket ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Switching user...</span>
                    </div>
                ) : isMounted ? (
                    <SignIn />
                ) : (
                    <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
                )}
            </div>
        </PageWrapper>
    );
}

export default function SignInPage() {
    return <SignInContent />;
}
