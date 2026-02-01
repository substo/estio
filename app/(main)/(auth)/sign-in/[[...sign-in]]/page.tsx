"use client"
import PageWrapper from "@/components/wrapper/page-wrapper";
import config from "@/config";
import { SignIn, useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Loader2 } from "lucide-react";

function SignInContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { signIn, setActive, isLoaded } = useSignIn();
    const [isProcessingTicket, setIsProcessingTicket] = useState(false);
    const [ticketError, setTicketError] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    // Prevent hydration mismatch by only rendering Clerk components after mount
    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (!config?.auth?.enabled) {
            router.back();
        }
    }, [router]);

    // Manual Ticket Handling for SSO
    // We use a layout effect or immediate check to avoid flash if possible, but useEffect is safer for hydration
    useEffect(() => {
        if (!isLoaded) return;

        const ticket = searchParams.get("__clerk_ticket");
        const redirectUrl = searchParams.get("redirect_url") || "/admin";

        if (ticket) {
            setIsProcessingTicket(true);

            signIn.create({ strategy: "ticket", ticket })
                .then((result) => {
                    if (result.status === "complete" && result.createdSessionId) {
                        setActive({ session: result.createdSessionId })
                            .then(() => {
                                router.push(redirectUrl);
                            });
                    } else {
                        setTicketError("Verification incomplete.");
                        setIsProcessingTicket(false);
                    }
                })
                .catch((err) => {
                    console.error("Ticket sign-in failed:", err);
                    setTicketError("Failed to verify ticket. Please sign in manually.");
                    setIsProcessingTicket(false);
                });
        }
    }, [isLoaded, searchParams, signIn, setActive, router]);

    if (isProcessingTicket) {
        return (
            <PageWrapper>
                <div className="flex flex-col items-center justify-center min-h-screen">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
                    <p className="text-gray-600">Verifying session...</p>
                </div>
            </PageWrapper>
        );
    }

    return (
        <PageWrapper >
            <div className="flex flex-col items-center min-w-screen justify-center my-[5rem]">
                {ticketError && (
                    <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">
                        {ticketError}
                    </div>
                )}
                {isMounted ? (
                    <SignIn />
                ) : (
                    <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
                )}
            </div>
        </PageWrapper>
    );
}

export default function SignInPage() {
    return (
        <Suspense fallback={
            <div className="flex min-w-screen justify-center my-[5rem]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
            </div>
        }>
            <SignInContent />
        </Suspense>
    );
}