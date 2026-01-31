
import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/google/auth';
import { auth } from '@clerk/nextjs/server';

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        // Prioritize environment variable for production stability
        // Only use request origin for local dev (when APP_BASE_URL isn't set)
        const baseUrl = process.env.APP_BASE_URL
            || process.env.NEXT_PUBLIC_APP_URL
            || req.nextUrl.origin;

        console.log('[Google Auth] Using base URL:', baseUrl);

        const url = getGoogleAuthUrl(baseUrl);

        return NextResponse.redirect(url);
    } catch (error) {
        console.error('Google Auth Error:', error);
        return new NextResponse('Internal Error', { status: 500 });
    }
}
