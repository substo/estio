'use client';

import { useSignIn } from "@clerk/nextjs";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function VerifyContent() {
    const { signIn, isLoaded, setActive } = useSignIn();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState("Verifying session...");

    useEffect(() => {
        if (!isLoaded) return;

        const verifyTicket = async () => {
            const ticket = searchParams.get("ticket");
            const redirectUrl = searchParams.get("redirect_url") || "/admin";

            if (!ticket) {
                setStatus("Error: No ticket provided.");
                return;
            }

            try {
                // Check if already signed in, maybe skip?
                // For now, assume ticket exchange is needed.

                const res = await signIn.create({
                    strategy: "ticket",
                    ticket,
                });

                if (res.status === "complete") {
                    await setActive({ session: res.createdSessionId });
                    router.push(redirectUrl);
                } else {
                    setStatus("Error: verification incomplete. " + res.status);
                }
            } catch (err: any) {
                console.error("SSO Verification Error:", err);
                setStatus("Verification failed: " + (err.errors?.[0]?.message || err.message));
            }
        };

        verifyTicket();
    }, [isLoaded, searchParams, router, signIn, setActive]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1 className="text-xl font-bold mb-4">Secure Sign In</h1>
            <p>{status}</p>
        </div>
    );
}

export default function SSOVerifyPage() {
    return (
        <Suspense fallback={<div>Loading verification...</div>}>
            <VerifyContent />
        </Suspense>
    );
}
