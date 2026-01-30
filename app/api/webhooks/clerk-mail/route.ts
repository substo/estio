
import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { WebhookEvent } from '@clerk/nextjs/server'
import db from '@/lib/db'
import { sendGHLEmail } from '@/lib/ghl/email'
import { checkGHLSMTPStatus } from '@/lib/ghl/email'

// Simple in-memory cache for idempotency removed in favor of Metadata Tagging

export async function POST(req: Request) {
    const WEBHOOK_SECRET = process.env.CLERK_MAIL_WEBHOOK_SECRET || process.env.CLERK_WEBHOOK_SECRET

    if (!WEBHOOK_SECRET) {
        throw new Error('Please add CLERK_MAIL_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local')
    }

    // Get the headers
    const headerPayload = await headers();
    const svix_id = headerPayload.get("svix-id");
    const svix_timestamp = headerPayload.get("svix-timestamp");
    const svix_signature = headerPayload.get("svix-signature");

    if (!svix_id || !svix_timestamp || !svix_signature) {
        return new Response('Error occured -- no svix headers', { status: 400 })
    }



    const payload = await req.json()
    const body = JSON.stringify(payload);
    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: WebhookEvent

    try {
        evt = wh.verify(body, {
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": svix_signature,
        }) as WebhookEvent
    } catch (err) {
        console.error('Error verifying webhook:', err);
        return new Response('Error occured', { status: 400 })
    }

    // Handle `email.created`
    if (evt.type === 'email.created') {
        const { data } = evt as any;
        // Note: The Clerk 'email.created' payload structure isn't strictly typed in WebhookEvent 
        // normally, or it might be. We'll cast to any to access data fields safely.

        const toEmail = data.to_email_address;
        const subject = data.subject;
        const htmlBody = data.body;

        console.log(`[Clerk-Mail] Intercepted email to ${toEmail}: ${subject} (svix-id: ${svix_id})`);

        // RESOUTION STRATEGY: Determine which GHL Location to send from.
        let locationId: string | undefined;

        // 0. CHECK PAYLOAD METADATA (Most reliable for Invites)
        // Structure: evt.data.data.invitation.public_metadata.locationId

        // IDEMPOTENCY CHECK (SOURCE TAGGING)
        // Check if this invitation was initiated by THIS environment.
        // If mismatched, we skip processing (the other environment will handle it).
        const emailData = data.data; // The nested 'data' object in the email resource
        const invitationSourceUrl = emailData?.invitation?.public_metadata?.sourceUrl;
        const currentAppUrl = process.env.NEXT_PUBLIC_APP_URL;

        if (invitationSourceUrl && currentAppUrl) {
            // Normalize URLs (remove trailing slashes for comparison)
            const normalizedSource = invitationSourceUrl.replace(/\/$/, "");
            const normalizedCurrent = currentAppUrl.replace(/\/$/, "");

            if (normalizedSource !== normalizedCurrent) {
                console.log(`[Clerk-Mail] Skipped: Source Mismatch. Invite from ${invitationSourceUrl}, Current is ${currentAppUrl}`);
                return new Response('Skipped: Source Mismatch', { status: 200 });
            }
            console.log(`[Clerk-Mail] Processing: Source Matched (${invitationSourceUrl})`);
        } else {
            // Fallback: If sourceUrl is missing (legacy invites or dashboard creates), we process it to be safe.
            // Or if currentAppUrl is missing (misconfiguration).
            console.log(`[Clerk-Mail] Processing: No Source Validation (Source: ${invitationSourceUrl}, Current: ${currentAppUrl})`);
        }

        if (emailData?.invitation?.public_metadata?.locationId) {
            locationId = emailData.invitation.public_metadata.locationId;
            console.log(`[Clerk-Mail] Found locationId in Invitation Metadata: ${locationId}`);
        }

        // 1. Fallback: Check if it's an existing user in our DB
        if (!locationId) {
            const connectedUser = await db.user.findUnique({
                where: { email: toEmail },
                include: { locations: true }
            });

            if (connectedUser && connectedUser.locations.length > 0) {
                // Use the first location (Primary)
                locationId = connectedUser.locations[0].id;
                console.log(`[Clerk-Mail] Resolved locationId from User DB: ${locationId}`);
            }
        }

        if (!locationId) {
            console.warn(`[Clerk-Mail] Could not resolve Location for ${toEmail}. Sending skipped.`);
            return new Response('Skipped: No Location Context', { status: 200 });
        }

        if (locationId) {
            // Check SMTP status
            const smtpStatus = await checkGHLSMTPStatus(locationId);
            if (!smtpStatus.isConfigured) {
                console.warn(`[Clerk-Mail] Location ${locationId} has no SMTP. Skipping.`);
                // Retrying won't help if config is missing.
                return new Response('Skipped: No SMTP', { status: 200 });
            }

            // Send via GHL
            const result = await sendGHLEmail({
                to: toEmail,
                subject: subject,
                htmlBody: htmlBody,
                locationId: locationId
            });

            if (result.success) {
                console.log(`[Clerk-Mail] Email sent via GHL Location ${locationId}`);
                return new Response('Email Sent', { status: 200 });
            } else {
                console.error(`[Clerk-Mail] Failed to send via GHL: ${result.error}`);
                // IMPORTANT: If we return 500, Clerk will retry. 
                // Ensure sendGHLEmail only fails for transient errors if you want retries.
                // For now, returning 500 allows retry, but idempotency check above is critical.


                return new Response('Failed to send', { status: 500 });
            }
        }
    }

    return new Response('', { status: 200 })
}
