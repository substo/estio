
import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleCallback } from '@/lib/google/auth';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export async function GET(req: NextRequest) {
    try {
        // We need the ACTUAL internal user ID, not just Clerk ID.
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        // Find internal User
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId }
        });

        if (!user) {
            return new NextResponse('User not found in DB', { status: 404 });
        }

        const searchParams = req.nextUrl.searchParams;
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
            return new NextResponse(`Google Auth Error: ${error}`, { status: 400 });
        }

        if (!code) {
            return new NextResponse('Missing code', { status: 400 });
        }

        // Exchange for tokens
        await handleGoogleCallback(code, user.id);

        // Redirect to settings or dashboard
        const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://estio.co';
        return NextResponse.redirect(`${baseUrl}/admin/settings/integrations/google?google_connected=true`);

    } catch (error) {
        console.error('Google Callback Error:', error);
        return new NextResponse('Internal Error', { status: 500 });
    }
}
