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

        // Redirect to settings or dashboard (Assuming existing integration page location)
        return NextResponse.redirect(`${baseUrl}/admin/settings/integrations/google?microsoft_connected=true`);
        // Note: We might want a dedicated /microsoft page later, but for now redirecting to the main integrations area or creating a new page is fine. 
        // Ideally, we redirect to the exact page where they started. usually /admin/settings/integrations
        // But since I saw the directory structure has `google` and `ghl`, maybe `microsoft` page doesn't exist yet. 
        // I will redirect to `/admin/settings/integrations/microsoft` assuming I will create it, OR just `/admin/settings/integrations` if it's a list.
        // Let's assume `/admin/settings/integrations/microsoft` as per plan to modify/create settings.

    } catch (error: any) {
        console.error('[Microsoft Callback] Error:', error?.message || error);
        console.error('[Microsoft Callback] Stack:', error?.stack);
        return new NextResponse(`Internal Error: ${error?.message || 'Unknown'}`, { status: 500 });
    }
}
