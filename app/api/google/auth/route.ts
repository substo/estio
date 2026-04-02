
import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/google/auth';
import { auth } from '@clerk/nextjs/server';
import {
    GOOGLE_OAUTH_STATE_COOKIE,
    GOOGLE_OAUTH_STATE_TTL_SECONDS,
    createGoogleOAuthState,
} from '@/lib/google/oauth-state';

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

        const state = createGoogleOAuthState();
        const url = getGoogleAuthUrl(baseUrl, state);
        const response = NextResponse.redirect(url);
        response.cookies.set({
            name: GOOGLE_OAUTH_STATE_COOKIE,
            value: state,
            maxAge: GOOGLE_OAUTH_STATE_TTL_SECONDS,
            path: '/api/google',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
        });

        return response;
    } catch (error) {
        console.error('Google Auth Error:', error);
        return new NextResponse('Internal Error', { status: 500 });
    }
}
