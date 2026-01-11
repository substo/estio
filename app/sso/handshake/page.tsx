
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SSOHandshakePage({
    searchParams,
}: {
    searchParams: Promise<{ redirect_url: string }>;
}) {
    const { userId } = await auth();
    const { redirect_url } = await searchParams;

    // 1. If not logged in, Clerk middleware should have intercepted this.
    // But double check to be safe.
    if (!userId) {
        return redirect("/sign-in");
    }

    // 2. Validate redirect_url
    if (!redirect_url) {
        return <div>Error: Missing redirect_url</div>;
    }

    let verifyUrl: string | undefined;

    try {
        const targetUrl = new URL(redirect_url);
        // TODO: Add strict domain whitelist check here for security

        // 3. Generate Ticket
        const client = await clerkClient();
        const token = await client.signInTokens.createSignInToken({
            userId,
            expiresInSeconds: 60, // Short-lived ticket
        });

        // 4. Construct verification URL
        const vUrl = new URL("/sso/verify", targetUrl.origin);
        vUrl.searchParams.set("ticket", token.token);
        vUrl.searchParams.set("redirect_url", targetUrl.pathname + targetUrl.search);

        verifyUrl = vUrl.toString();

    } catch (error: any) {
        console.error("SSO Handshake Error:", error);
        // Log detailed Clerk errors if available
        if (error.errors) {
            console.error("Clerk Errors:", JSON.stringify(error.errors, null, 2));
        }
        return <div>SSO Error: Could not generate ticket. Check server logs.</div>;
    }

    if (verifyUrl) {
        return redirect(verifyUrl);
    }
}
