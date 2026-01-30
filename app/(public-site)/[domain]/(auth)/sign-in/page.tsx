"use client"
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

    // Manual Ticket Handling (if redirected here with a ticket)
    useEffect(() => {
        if (!isLoaded) return;

        const ticket = searchParams.get("__clerk_ticket");
        const redirectUrl = searchParams.get("redirect_url") || "/";

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
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Verifying session...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center py-20">
            {ticketError && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">
                    {ticketError}
                </div>
            )}
            <SignIn />
        </div>
    );
}

export default function TenantSignInPage() {
    return (
        <Suspense fallback={
            <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <SignInContent />
        </Suspense>
    );
}
