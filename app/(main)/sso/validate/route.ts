import { verifySSOToken } from '@/lib/jwt-utils';
import { getGHLUser } from '@/lib/ghl/client';
import { getAccessToken } from '@/lib/ghl/token';
import { syncGHLUserToClerk } from '@/lib/clerk-sync';
import db from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

/**
 * SSO Validation Endpoint
 * Verifies JWT token, fetches user from GHL API, syncs to Clerk, creates Clerk session
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    try {
        // Step 1: Verify token signature and expiration
        const payload = verifySSOToken(token);
        const { userId, locationId, userEmail } = payload;

        console.log(`[SSO Debug] Validating user ${userId} for location ${locationId}`);

        // Step 2: Find location by ghlLocationId
        let location = await db.location.findFirst({
            where: { ghlLocationId: locationId },
        });

        if (!location) {
            console.log(`[SSO Debug] Location not found for location ${locationId}. Redirecting to permission check.`);

            // Redirect to client-side permission check
            // This page will use postMessage to verify if the user is an Admin
            // If yes, it will redirect to /api/oauth/start
            const baseUrl = process.env.APP_BASE_URL || 'https://estio.co';
            const checkUrl = new URL('/sso/check-permissions', baseUrl);

            // Pass the original token so the check page can forward it or use it for context if needed
            // Actually, the check page needs to construct the oauth URL.
            // Let's pass the locationId to the check page.
            checkUrl.searchParams.set('locationId', locationId);

            return NextResponse.redirect(checkUrl);
        }

        console.log(`[SSO Debug] Location found: ${location.id} (GHL ID: ${location.ghlLocationId})`);

        // Step 3: Check if access token needs refresh
        // The getAccessToken function handles refresh automatically
        console.log(`[SSO Debug] Attempting to retrieve access token...`);
        const accessToken = await getAccessToken(location.ghlLocationId!);
        console.log(`[SSO Debug] Access token retrieval result: ${accessToken ? 'Success (Length: ' + accessToken.length + ')' : 'NULL'}`);

        if (!accessToken) {
            console.error(`[SSO Debug] Failed to get valid access token for location ${location.id}`);

            // Return a friendly HTML page prompting re-authentication
            const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connection Expired</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 480px;
            width: 100%;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            text-align: center;
        }
        .icon {
            width: 64px;
            height: 64px;
            background: #fef3c7;
            color: #d97706;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 32px;
            font-weight: bold;
        }
        h1 {
            color: #111827;
            font-size: 24px;
            margin-bottom: 12px;
            font-weight: 700;
        }
        p {
            color: #4b5563;
            line-height: 1.6;
            margin-bottom: 32px;
        }
        .button {
            display: inline-block;
            background: #2563eb;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            transition: background 0.2s;
            width: 100%;
        }
        .button:hover {
            background: #1d4ed8;
        }
        .debug-info {
            margin-top: 20px;
            padding: 10px;
            background: #f0f0f0;
            border-radius: 4px;
            font-family: monospace;
            font-size: 10px;
            color: #666;
            text-align: left;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">!</div>
        <h1>Connection Expired</h1>
        <p>The connection to GoHighLevel has expired. Please reconnect to continue using the application.</p>
        <a href="/api/oauth/start?locationId=${locationId}" class="button">Reconnect Now</a>
        <div class="debug-info">
            Debug: Location found (${location.id}) but tokens are missing/invalid.<br>
            Timestamp: ${new Date().toISOString()}
        </div>
    </div>
</body>
</html>`;

            return new NextResponse(html, {
                status: 401,
                headers: {
                    'Content-Type': 'text/html',
                    'X-Debug-SSO': 'validate-no-token'
                }
            });
        }

        // Step 4: Fetch user from GHL API
        const ghlUser = await getGHLUser(userId, accessToken);
        if (!ghlUser) {
            console.error(`[SSO] User ${userId} not found in GHL`);
            return NextResponse.json({ error: 'User not found in GoHighLevel' }, { status: 404 });
        }

        // Log full user object for debugging
        console.log(`[SSO] Fetched user: ${ghlUser.name} (${ghlUser.email})`);
        console.log(`[SSO] Full GHL user object:`, JSON.stringify(ghlUser, null, 2));

        // Step 5: Validate permissions (Configurable role-based access)
        const allowedRoles = process.env.ALLOWED_GHL_ROLES?.split(',').map(r => r.trim().toLowerCase()) || ['admin'];

        // Handle nested roles object (new API structure) with fallback to legacy flat fields
        let userRole: string | undefined;
        let userType: string | undefined;
        let userLocationIds: string[] | undefined;

        if (ghlUser.roles) {
            // New structure: nested roles object
            userRole = ghlUser.roles.role?.toLowerCase();
            userType = ghlUser.roles.type?.toLowerCase();
            userLocationIds = ghlUser.roles.locationIds;
            console.log(`[SSO] Using nested roles structure: role=${userRole}, type=${userType}`);
        } else {
            // Legacy structure: flat fields
            userRole = ghlUser.role?.toLowerCase();
            userType = ghlUser.type?.toLowerCase();
            userLocationIds = ghlUser.locationIds;
            console.log(`[SSO] Using legacy flat structure: role=${userRole}, type=${userType}`);
        }

        // If role is still undefined, fall back to type or default to 'user'
        if (!userRole) {
            console.warn(`[SSO] User ${ghlUser.email} has undefined role, using type '${userType}' as fallback`);
            userRole = userType || 'user';
        }

        if (!allowedRoles.includes(userRole)) {
            console.log(`[SSO] Access denied for user ${ghlUser.email} with role '${userRole}'. Allowed roles: ${allowedRoles.join(', ')}`);

            return new NextResponse(
                `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Denied</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
        }
        .icon {
            width: 64px;
            height: 64px;
            background: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
        }
        h1 {
            color: #1a1a1a;
            font-size: 24px;
            margin-bottom: 16px;
        }
        p {
            color: #6b7280;
            line-height: 1.6;
            margin-bottom: 12px;
        }
        .details {
            background: #f3f4f6;
            border-radius: 8px;
            padding: 16px;
            margin: 20px 0;
            font-size: 13px;
            text-align: left;
        }
        .details strong {
            color: #374151;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">
            <svg width="32" height="32" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </div>
        <h1>Access Denied</h1>
        <p>Your user role does not have permission to access this application.</p>
        <div class="details">
            <strong>Your Role:</strong> ${userRole}<br>
            <strong>Allowed Roles:</strong> ${allowedRoles.join(', ')}<br>
            <strong>User:</strong> ${ghlUser.email}
        </div>
        <p>Please contact your administrator to request access.</p>
    </div>
</body>
</html>`,
                { status: 403, headers: { 'Content-Type': 'text/html' } }
            );
        }

        console.log(`[SSO] User ${ghlUser.email} with role '${userRole}' authorized successfully`);

        // Verify user has access to this location (skip if locationIds is undefined)
        if (userLocationIds && Array.isArray(userLocationIds)) {
            if (!userLocationIds.includes(locationId)) {
                console.error(`[SSO] User ${ghlUser.email} does not have access to location ${locationId}`);
                console.error(`[SSO] User locations: ${userLocationIds.join(', ')}`);
                return NextResponse.json({ error: 'User does not have access to this location' }, { status: 403 });
            }
            console.log(`[SSO] User ${ghlUser.email} has access to location ${locationId}`);
        } else {
            console.warn(`[SSO] locationIds is undefined or not an array for user ${ghlUser.email}, skipping location verification`);
        }

        console.log(`[SSO] User ${ghlUser.email} validated successfully, syncing to Clerk...`);

        // Step 6: Sync GHL user to Clerk (create or update)
        const clerkUserId = await syncGHLUserToClerk(ghlUser, location.id, locationId);
        console.log(`[SSO] Clerk user synced: ${clerkUserId}`);

        // Step 7: Update location's last SSO validation and link User
        await db.location.update({
            where: { id: location.id },
            data: {
                lastSsoValidation: new Date(),
                lastSsoUserId: userId,
            },
        });

        // Ensure User record exists and is linked
        if (ghlUser.email) {
            const user = await db.user.upsert({
                where: { email: ghlUser.email },
                update: {
                    name: ghlUser.name,
                    ghlUserId: ghlUser.id,
                    locations: {
                        connect: { id: location.id }
                    }
                },
                create: {
                    email: ghlUser.email,
                    name: ghlUser.name,
                    ghlUserId: ghlUser.id,
                    locations: {
                        connect: { id: location.id }
                    }
                }
            });

            // Auto-assign ADMIN role for users who OAuth (location authorization = admin access)
            await db.userLocationRole.upsert({
                where: {
                    userId_locationId: {
                        userId: user.id,
                        locationId: location.id
                    }
                },
                update: { role: 'ADMIN' },  // Re-auth always confirms ADMIN
                create: {
                    userId: user.id,
                    locationId: location.id,
                    role: 'ADMIN'
                }
            });

            console.log(`[SSO] User ${ghlUser.email} linked to location ${location.id} with ADMIN role`);
        }


        // Step 8: Create Clerk session token and redirect
        // Clerk will handle the session creation via their signIn endpoint
        const baseUrl = process.env.APP_BASE_URL || 'https://estio.co';
        const signInUrl = new URL('/api/clerk/sign-in-with-token', baseUrl);
        signInUrl.searchParams.set('clerk_user_id', clerkUserId);

        // Use custom redirect URL if provided (e.g. for popup callback), otherwise default to /admin
        const redirectUrl = searchParams.get('redirect_url') || '/admin';
        signInUrl.searchParams.set('redirect_url', redirectUrl);

        console.log(`[SSO] Redirecting to Clerk sign-in for user ${ghlUser.email}`);

        const response = NextResponse.redirect(signInUrl);

        // Set the crm_location_id cookie so the app knows which location context to use
        response.cookies.set("crm_location_id", location.id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 7, // 7 days
        });

        return response;

    } catch (error) {
        console.error('[SSO] Validation error:', error);

        // Return detailed error in development
        if (process.env.NODE_ENV !== 'production') {
            return NextResponse.json({
                error: 'Internal server error (validate)',
                details: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            }, { status: 500 });
        }

        if (error instanceof jwt.JsonWebTokenError) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }
        if (error instanceof jwt.TokenExpiredError) {
            return NextResponse.json({ error: 'Token expired, please try again' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
