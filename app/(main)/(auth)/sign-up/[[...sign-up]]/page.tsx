"use client"
import PageWrapper from "@/components/wrapper/page-wrapper";
import config from "@/config";
import { SignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export default function SignUpPage() {
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        if (!config?.auth?.enabled) {
            router.back();
        }
    }, [router]);

    // Prevent hydration mismatch by only rendering Clerk components after mount
    useEffect(() => {
        setIsMounted(true);
    }, []);

    return (
        <PageWrapper >
            <div className="flex min-w-screen justify-center my-[5rem]">
                {isMounted ? (
                    <SignUp />
                ) : (
                    <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
                )}
            </div>
        </PageWrapper>
    );
}