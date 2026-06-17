import { clerkClient } from '@clerk/nextjs/server';
import { verifyClerkSignInHandoffToken } from '@/lib/jwt-utils';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Creates a Clerk session for a GHL user
 * This endpoint generates a session token and redirects to sign in
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const handoffToken = searchParams.get('token');
    const redirectUrl = searchParams.get('redirect_url') || '/admin';

    if (!handoffToken) {
        return NextResponse.json({ error: 'Missing sign-in handoff token' }, { status: 400 });
    }

    try {
        const { clerkUserId } = verifyClerkSignInHandoffToken(handoffToken);

        // Create a sign-in token for the user
        const client = await clerkClient();
        const signInToken = await client.signInTokens.createSignInToken({
            userId: clerkUserId,
            expiresInSeconds: 300, // 5 minutes
        });

        // Redirect to Clerk's sign-in page with the token
        // FIX: Use hardcoded production URL to avoid localhost resolution behind proxy
        const baseUrl = process.env.NODE_ENV === 'production' ? 'https://estio.co' : request.url;
        const signInUrl = new URL('/sign-in', baseUrl);
        signInUrl.searchParams.set('__clerk_ticket', signInToken.token);
        signInUrl.searchParams.set('redirect_url', redirectUrl);

        console.log(`[Clerk] Created sign-in token for user ${clerkUserId}. Token length: ${signInToken.token.length}`);
        console.log(`[Clerk] Redirecting to ${signInUrl.toString()}`);

        return NextResponse.redirect(signInUrl);
    } catch (error) {
        console.error('[Clerk] Failed to create sign-in token:', error);
        if (
            error instanceof Error &&
            (error.message.includes('sign-in handoff token') ||
                error.name === 'JsonWebTokenError' ||
                error.name === 'TokenExpiredError')
        ) {
            return NextResponse.json({ error: 'Invalid sign-in handoff token' }, { status: 401 });
        }
        try {
            const fs = require('fs');
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [Clerk] Error: ${error instanceof Error ? error.message : String(error)}\nStack: ${error instanceof Error ? error.stack : ''}\n`);
        } catch (e) {
            console.error("Failed to write to debug log", e);
        }
        return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
}
