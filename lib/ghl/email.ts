
import db from '@/lib/db';
import { ghlFetch } from "./client";
import { getAccessToken } from "./token";
import { GHLLocation } from "./types";

interface LocationResponse {
    location: GHLLocation;
}

async function resolveToGHLId(identifier: string): Promise<string | null> {
    const byId = await db.location.findUnique({
        where: { id: identifier },
        select: { ghlLocationId: true }
    });
    if (byId?.ghlLocationId) return byId.ghlLocationId;

    const byGhlId = await db.location.findUnique({
        where: { ghlLocationId: identifier },
        select: { ghlLocationId: true }
    });
    if (byGhlId) return byGhlId.ghlLocationId;

    return null;
}

export async function checkGHLSMTPStatus(locationId: string): Promise<{ isConfigured: boolean; providerName?: string }> {
    try {
        const ghlLocationId = await resolveToGHLId(locationId);
        if (!ghlLocationId) {
            console.warn(`[GHL SMTP Check] Could not resolve GHL ID for: ${locationId}`);
            return { isConfigured: false };
        }

        const token = await getAccessToken(ghlLocationId);
        if (!token) {
            console.warn("[GHL SMTP Check] No access token found for location:", ghlLocationId);
            return { isConfigured: false };
        }

        // Endpoint: /locations/:locationId (V2)
        // Requires 'locations.readonly' scope
        const response = await ghlFetch<LocationResponse>(
            `/locations/${ghlLocationId}`,
            token
        );

        const loc = response.location;
        if (!loc) {
            return { isConfigured: false };
        }

        // 1. Check for Default Email Service (covers Custom SMTP, AWS, Sendgrid, etc.)
        if (loc.defaultEmailService) {
            return { isConfigured: true, providerName: 'Configured Provider' };
        }

        // 2. Check Mailgun (Standard GHL integration)
        if (loc.mailgun && loc.mailgun.apiKey && loc.mailgun.domain) {
            return { isConfigured: true, providerName: 'Mailgun' };
        }

        // 3. Fallback check for generic SMTP object
        if (loc.smtp) {
            return { isConfigured: true, providerName: 'SMTP' };
        }

        return { isConfigured: false };
    } catch (error) {
        console.error("[GHL SMTP Check] Error checking status:", error);
        // Fail safe: If we can't check, we assume it's NOT configured so the user at least checks manually.
        return { isConfigured: false };
    }
}

interface SendEmailParams {
    to: string;
    subject: string;
    htmlBody: string;
    locationId: string;
}

export async function sendGHLEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
    console.log(`[sendGHLEmail] START. To: ${params.to}, Subject: ${params.subject}, Identifier: ${params.locationId}`);
    try {
        const ghlLocationId = await resolveToGHLId(params.locationId);
        if (!ghlLocationId) throw new Error(`Could not resolve GHL Location ID for identifier: ${params.locationId}`);

        console.log(`[sendGHLEmail] Resolved GHL ID: ${ghlLocationId}`);

        const token = await getAccessToken(ghlLocationId);
        if (!token) throw new Error("No access token for location");

        // Use conversations/messages to send email

        // 1. Find Contact (We need their ID to send a message)
        const encodedEmail = encodeURIComponent(params.to);
        const contactSearch = await ghlFetch<any>(`/contacts/?locationId=${ghlLocationId}&query=${encodedEmail}`, token);
        let contactId = contactSearch.contacts?.[0]?.id;

        if (!contactId) {
            console.log(`[sendGHLEmail] Contact not found, creating new contact...`);
            // Create contact if not exists (minimal)
            const newContact = await ghlFetch<any>(`/contacts/`, token, {
                method: 'POST',
                body: JSON.stringify({
                    email: params.to,
                    name: params.to.split('@')[0], // Fallback name
                    locationId: ghlLocationId // Must use GHL ID here
                })
            });
            contactId = newContact.contact?.id;
            console.log(`[sendGHLEmail] New contact created with ID: ${contactId}`);
        } else {
            console.log(`[sendGHLEmail] Found existing contact ID: ${contactId}`);
        }

        if (!contactId) throw new Error("Could not Resolve Contact for Email Sending");
        console.log(`[sendGHLEmail] Resolved Contact ID: ${contactId}`);

        // 2. Determine Sender Domain
        // We need to look up the location's siteConfig to get the custom domain
        const locationDetails = await db.location.findUnique({
            where: { ghlLocationId: ghlLocationId }, // mapping is already done
            include: { siteConfig: true }
        });
        const domain = locationDetails?.siteConfig?.domain || 'estio.co';
        const emailFrom = `info@${domain}`;
        console.log(`[sendGHLEmail] Sending from: ${emailFrom}`);

        // 3. Send Email Message
        console.log(`[sendGHLEmail] Sending message...`);
        const response = await ghlFetch(`/conversations/messages`, token, {
            method: 'POST',
            body: JSON.stringify({
                type: 'Email',
                contactId: contactId,
                locationId: ghlLocationId, // Add locationId for safety
                emailFrom: emailFrom,
                html: params.htmlBody,
                subject: params.subject,
            })
        });

        console.log(`[sendGHLEmail] SUCCESS. Response:`, JSON.stringify(response));
        return { success: true };

    } catch (error: any) {
        console.error("[sendGHLEmail] FAILED:", error);
        return { success: false, error: error.message };
    }
}
