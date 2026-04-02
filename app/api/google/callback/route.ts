
import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleCallback } from '@/lib/google/auth';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { randomUUID } from 'node:crypto';
import { GOOGLE_OAUTH_STATE_COOKIE, isGoogleOAuthStateValid } from '@/lib/google/oauth-state';

function googleSettingsRedirect(
    baseUrl: string,
    params: Record<string, string | undefined>
): NextResponse {
    const redirectUrl = new URL('/admin/settings/integrations/google', baseUrl);
    for (const [key, value] of Object.entries(params)) {
        if (value) redirectUrl.searchParams.set(key, value);
    }
    return NextResponse.redirect(redirectUrl);
}

function clearGoogleOAuthStateCookie(response: NextResponse) {
    response.cookies.set({
        name: GOOGLE_OAUTH_STATE_COOKIE,
        value: '',
        maxAge: 0,
        path: '/api/google',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
    });
}

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
        const providedState = searchParams.get('state');
        const expectedState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value || null;
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (!isGoogleOAuthStateValid(expectedState, providedState)) {
            console.warn('[Google Callback] Invalid OAuth state received.');
            const invalidStateRes = googleSettingsRedirect(baseUrl, {
                google_error: 'invalid_state',
            });
            clearGoogleOAuthStateCookie(invalidStateRes);
            return invalidStateRes;
        }

        if (error) {
            console.error('[Google Callback] OAuth error:', error);
            const authErrorRes = googleSettingsRedirect(baseUrl, {
                google_error: 'oauth_denied',
            });
            clearGoogleOAuthStateCookie(authErrorRes);
            return authErrorRes;
        }

        if (!code) {
            console.error('[Google Callback] Missing code in callback');
            const missingCodeRes = googleSettingsRedirect(baseUrl, {
                google_error: 'missing_code',
            });
            clearGoogleOAuthStateCookie(missingCodeRes);
            return missingCodeRes;
        }

        console.log('[Google Callback] Exchanging code for tokens, user:', user.id);

        // Exchange for tokens using consistent base URL
        await handleGoogleCallback(code, user.id, baseUrl);

        console.log('[Google Callback] Success! Redirecting...');

        // Redirect to settings or dashboard
        const successRes = googleSettingsRedirect(baseUrl, {
            google_connected: 'true',
        });
        clearGoogleOAuthStateCookie(successRes);
        return successRes;

    } catch (error: any) {
        const errorId = randomUUID();
        console.error(`[Google Callback] Error (${errorId}):`, error?.message || error);
        console.error(`[Google Callback] Stack (${errorId}):`, error?.stack);
        const internalErrorRes = googleSettingsRedirect(baseUrl, {
            google_error: 'internal_error',
            google_error_id: errorId,
        });
        clearGoogleOAuthStateCookie(internalErrorRes);
        return internalErrorRes;
    }
}
