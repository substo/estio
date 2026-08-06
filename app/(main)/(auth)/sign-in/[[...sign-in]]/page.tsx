"use client"
import PageWrapper from "@/components/wrapper/page-wrapper";
import config from "@/config";
import { SignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

function SignInContent() {
    const router = useRouter();
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

    return (
        <PageWrapper >
            <div className="flex flex-col items-center min-w-screen justify-center my-[5rem]">
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
    return <SignInContent />;
}
