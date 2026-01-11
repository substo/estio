import { GHL_CONFIG } from "@/config/ghl";
import db from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const stateStr = searchParams.get("state");

    if (!code) {
        return NextResponse.json({ error: "No code provided" }, { status: 400 });
    }

    try {
        // Exchange code for token
        const tokenParams = new URLSearchParams();
        tokenParams.append("client_id", process.env.GHL_CLIENT_ID!);
        tokenParams.append("client_secret", process.env.GHL_CLIENT_SECRET!);
        tokenParams.append("grant_type", "authorization_code");
        tokenParams.append("code", code);
        tokenParams.append("redirect_uri", process.env.GHL_REDIRECT_URI!);

        const tokenResponse = await fetch(`${GHL_CONFIG.API_BASE_URL}${GHL_CONFIG.ENDPOINTS.TOKEN}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: tokenParams,
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error("Token exchange failed:", errorText);
            return NextResponse.json({ error: "Token exchange failed", details: errorText }, { status: 400 });
        }

        const tokenData = await tokenResponse.json();
        console.log("[OAuth] Token Response Data:", JSON.stringify(tokenData, null, 2));

        // Parse state to get agency/location context if available
        let context: any = {};
        if (stateStr) {
            try {
                context = JSON.parse(stateStr);
                console.log("[OAuth] Parsed state context:", JSON.stringify(context));
            } catch (e) {
                console.error("Failed to parse state", e);
            }
        } else {
            console.log("[OAuth] No state string provided");
        }

        // Determine identifiers from token response
        let locationId = tokenData.locationId || context.locationId;
        let agencyId = tokenData.agencyId || context.agencyId;
        let userId = tokenData.userId || context.userId;

        console.log(`[OAuth] Derived IDs - Location: ${locationId}, Agency: ${agencyId}, User: ${userId}`);

        // If we have a userId,
        // Upsert Location into our DB
        const where = locationId ? { ghlLocationId: locationId } : { ghlAgencyId: agencyId };
        const dbLocation = await db.location.upsert({
            where: where as any, // Prisma types might be tricky with optional uniques, but this should work if defined correctly
            update: {
                ghlAccessToken: tokenData.access_token,
                ghlRefreshToken: tokenData.refresh_token,
                ghlExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
                ghlTokenType: tokenData.token_type,
                ghlScopes: tokenData.scope, // Store granted scopes for mismatch detection
                // Update IDs if they were missing and now present (unlikely for upsert but good for completeness)
                ghlLocationId: locationId,
                ghlAgencyId: agencyId,
            },
            create: {
                ghlLocationId: locationId,
                ghlAgencyId: agencyId,
                ghlAccessToken: tokenData.access_token,
                ghlRefreshToken: tokenData.refresh_token,
                ghlExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
                ghlTokenType: tokenData.token_type,
                ghlScopes: tokenData.scope, // Store granted scopes for mismatch detection
                name: "New Location", // Placeholder
            },
        });
        console.log("[OAuth] Location upserted successfully. ID:", dbLocation.id);

        // Link User to Location if we have user details
        // We might need to fetch user details again if we didn't earlier, but we likely did if we needed context
        // Or we can try to fetch them now if we have the token
        try {
            let userEmail = "";
            let userName = "";
            let ghlUserId = "";

            // If we already fetched userData earlier (variable scope issue, let's refactor slightly or just fetch again/use what we have)
            // In the current code, userData is inside a block. Let's fetch if we don't have it.
            // For simplicity, let's just fetch user details again using the new token to be sure
            const userResponse = await fetch(`${GHL_CONFIG.API_BASE_URL}/users/${userId}`, {
                headers: {
                    "Authorization": `Bearer ${tokenData.access_token}`,
                    "Version": "2021-07-28"
                }
            });

            if (userResponse.ok) {
                const userData = await userResponse.json();
                userEmail = userData.email;
                userName = userData.name;
                ghlUserId = userData.id;

                if (userEmail) {
                    console.log(`[OAuth] Linking user ${userEmail} to location ${dbLocation.id}`);

                    // Upsert User and connect to Location
                    await db.user.upsert({
                        where: { email: userEmail },
                        update: {
                            name: userName,
                            ghlUserId: ghlUserId,
                            locations: {
                                connect: { id: dbLocation.id }
                            }
                        },
                        create: {
                            email: userEmail,
                            name: userName,
                            ghlUserId: ghlUserId,
                            locations: {
                                connect: { id: dbLocation.id }
                            }
                        }
                    });
                    console.log(`[OAuth] User linked successfully`);
                }
            }
        } catch (err) {
            console.error("[OAuth] Failed to link user to location:", err);
            // Don't fail the whole request, just log
        }

        // Return a success page with manual integration instructions
        // Standard plan does not have access to Custom Menu Link API
        const appUrl = process.env.NODE_ENV === 'production'
            ? 'https://estio.co'
            : 'http://localhost:3000';
        const ssoUrl = `${appUrl}/sso/init?userId={{user.id}}&locationId={{location.id}}&userEmail={{user.email}}`;

        const successHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Complete - Estio</title>
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
        .success-icon {
            width: 80px;
            height: 80px;
            background: #22c55e;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            box-shadow: 0 10px 20px rgba(34, 197, 94, 0.3);
        }
        h1 {
            color: #1a1a1a;
            font-size: 28px;
            margin-bottom: 16px;
        }
        p {
            color: #6b7280;
            line-height: 1.6;
            margin-bottom: 24px;
            font-size: 16px;
        }
        .action-box {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 24px;
            margin: 24px 0;
            border: 1px solid #e5e7eb;
        }
        .step {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            text-align: left;
        }
        .step:last-child {
            margin-bottom: 0;
        }
        .step-num {
            width: 24px;
            height: 24px;
            background: #667eea;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            flex-shrink: 0;
        }
        .step-text {
            color: #374151;
            font-weight: 500;
        }
        .close-btn {
            background: #1f2937;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            width: 100%;
            transition: all 0.2s;
        }
        .close-btn:hover {
            background: #111827;
            transform: translateY(-1px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">
            <svg width="40" height="40" fill="none" stroke="white" stroke-width="4" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
        </div>
        <h1>Setup Complete!</h1>
        <p>
            Your GoHighLevel account has been successfully connected.
        </p>

        <div class="action-box">
            <div class="step">
                <div class="step-num">1</div>
                <div class="step-text">Close this tab/window</div>
            </div>
            <div class="step">
                <div class="step-num">2</div>
                <div class="step-text">Return to your GoHighLevel tab</div>
            </div>
            <div class="step">
                <div class="step-num">3</div>
                <div class="step-text"><strong>Refresh the page</strong> to see the app</div>
            </div>
        </div>

        <button class="close-btn" onclick="window.close()">Close Window</button>
    </div>
</body>
</html>
        `;

        const response = new NextResponse(successHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });

        // Still set the location cookie for when they access via the custom menu link
        response.cookies.set("crm_location_id", dbLocation.id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 7, // 7 days
        });

        return response;

    } catch (error) {
        console.error("OAuth callback error:", error);

        // Return detailed error in development
        if (process.env.NODE_ENV !== 'production') {
            return NextResponse.json({
                error: 'Internal server error (oauth callback)',
                details: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            }, { status: 500 });
        }

        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
