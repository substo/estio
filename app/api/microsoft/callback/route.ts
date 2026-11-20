import { NextRequest, NextResponse } from 'next/server';
import { handleMicrosoftCallback } from '@/lib/microsoft/auth';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export async function GET(req: NextRequest) {
    // Prioritize environment variable for production stability
    const baseUrl = process.env.APP_BASE_URL
        || process.env.NEXT_PUBLIC_APP_URL
        || req.nextUrl.origin;

    console.log('[Microsoft Callback] Using base URL:', baseUrl);

    try {
        // We need the ACTUAL internal user ID, not just Clerk ID.
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            console.error('[Microsoft Callback] No Clerk user ID');
            return new NextResponse('Unauthorized', { status: 401 });
        }

        // Find internal User
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId }
        });

        if (!user) {
            console.error('[Microsoft Callback] User not found for clerkId:', clerkUserId);
            return new NextResponse('User not found in DB', { status: 404 });
        }

        const searchParams = req.nextUrl.searchParams;
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
            console.error('[Microsoft Callback] OAuth error:', error);
            return new NextResponse(`Microsoft Auth Error: ${error}`, { status: 400 });
        }

        if (!code) {
            console.error('[Microsoft Callback] Missing code in callback');
            return new NextResponse('Missing code', { status: 400 });
        }

        console.log('[Microsoft Callback] Exchanging code for tokens, user:', user.id);

        // Exchange for tokens using consistent base URL
        await handleMicrosoftCallback(code, user.id, baseUrl);

        console.log('[Microsoft Callback] Success! Redirecting...');

        return NextResponse.redirect(`${baseUrl}/settings/integrations/microsoft?microsoft_connected=true`);

    } catch (error: any) {
        console.error('[Microsoft Callback] Error:', error?.message || error);
        console.error('[Microsoft Callback] Stack:', error?.stack);
        return new NextResponse(`Internal Error: ${error?.message || 'Unknown'}`, { status: 500 });
    }
}
