import { generateSSOToken } from '@/lib/jwt-utils';
import { NextRequest, NextResponse } from 'next/server';

/**
 * SSO Initialization API
 * Receives user/location context from GHL custom menu link URL parameters
 * Generates a signed JWT token and redirects to validation endpoint
 * 
 * Expected URL: /api/sso/start?userId={{user.id}}&locationId={{location.id}}&userEmail={{user.email}}&redirect_url=...
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const locationId = searchParams.get('locationId');
    const userEmail = searchParams.get('userEmail');
    const redirectUrl = searchParams.get('redirect_url');

    console.log(`[SSO Start] Received params - User: ${userId}, Location: ${locationId}, Email: ${userEmail}, Redirect: ${redirectUrl}`);

    if (!userId || !locationId || !userEmail) {
        return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    try {
        // Generate HMAC-signed JWT token
        const token = generateSSOToken(userId, locationId, userEmail);

        // Redirect to validation endpoint with signed token
        // FIX: Start by using the public base URL to prevent localhost redirects behind proxy
        const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://estio.co';
        const validateUrl = new URL('/sso/validate', baseUrl);
        validateUrl.searchParams.set('token', token);

        if (redirectUrl) {
            validateUrl.searchParams.set('redirect_url', redirectUrl);
        }

        return NextResponse.redirect(validateUrl);
    } catch (error) {
        console.error('SSO start error:', error);
        return NextResponse.json(
            { error: 'Failed to generate SSO token' },
            { status: 500 }
        );
    }
}
