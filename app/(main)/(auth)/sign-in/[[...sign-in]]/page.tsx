"use client"
import PageWrapper from "@/components/wrapper/page-wrapper";
import config from "@/config";
import { SignIn, useAuth, useClerk, useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

function safeRedirectUrl(value: string | null): string {
    return value?.startsWith("/") && !value.startsWith("//") ? value : "/admin";
}

function SignInContent() {
    const router = useRouter();
    const clerk = useClerk();
    const { isLoaded: authLoaded, isSignedIn } = useAuth();
    const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
    const [isMounted, setIsMounted] = useState(false);
    const [isProcessingTicket, setIsProcessingTicket] = useState(false);
    const [ticketError, setTicketError] = useState<string | null>(null);
    const ticketAttempted = useRef(false);

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
        const redirectUrl = safeRedirectUrl(params.get("redirect_url"));

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
    }, [authLoaded, clerk, isMounted, isSignedIn, setActive, signIn, signInLoaded]);

    return (
        <PageWrapper >
            <div className="flex flex-col items-center min-w-screen justify-center my-[5rem]">
                {ticketError ? <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-600">{ticketError}</div> : null}
                {isProcessingTicket ? (
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
