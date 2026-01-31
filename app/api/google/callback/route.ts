
import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleCallback } from '@/lib/google/auth';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export async function GET(req: NextRequest) {
    // Prioritize environment variable for production stability
    const baseUrl = process.env.APP_BASE_URL
        || process.env.NEXT_PUBLIC_APP_URL
        || req.nextUrl.origin;

    console.log('[Google Callback] Using base URL:', baseUrl);

    try {
        // We need the ACTUAL internal user ID, not just Clerk ID.
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            console.error('[Google Callback] No Clerk user ID');
            return new NextResponse('Unauthorized', { status: 401 });
        }

        // Find internal User
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId }
        });

        if (!user) {
            console.error('[Google Callback] User not found for clerkId:', clerkUserId);
            return new NextResponse('User not found in DB', { status: 404 });
        }

        const searchParams = req.nextUrl.searchParams;
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
            console.error('[Google Callback] OAuth error:', error);
            return new NextResponse(`Google Auth Error: ${error}`, { status: 400 });
        }

        if (!code) {
            console.error('[Google Callback] Missing code in callback');
            return new NextResponse('Missing code', { status: 400 });
        }

        console.log('[Google Callback] Exchanging code for tokens, user:', user.id);

        // Exchange for tokens using consistent base URL
        await handleGoogleCallback(code, user.id, baseUrl);

        console.log('[Google Callback] Success! Redirecting...');

        // Redirect to settings or dashboard
        return NextResponse.redirect(`${baseUrl}/admin/settings/integrations/google?google_connected=true`);

    } catch (error: any) {
        console.error('[Google Callback] Error:', error?.message || error);
        console.error('[Google Callback] Stack:', error?.stack);
        return new NextResponse(`Internal Error: ${error?.message || 'Unknown'}`, { status: 500 });
    }
}
