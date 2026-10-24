import { WebhookEvent } from '@clerk/nextjs/server'
import db from '@/lib/db'
import { NextResponse } from 'next/server'
import { isGhlIntegrationEnabled } from '@/lib/ghl/integration-gate'
import { verifyPublicSignupLocationToken } from '@/lib/jwt-utils'
import {
    claimInvitedRealmUser,
    type InvitedUserStore,
    realmAcceptsTeamInvites,
    realmHandlesTenantContacts,
    verifyClerkBusinessWebhook,
} from '@/lib/auth/clerk-business-webhook'

const invitedUserStore: InvitedUserStore = {
    user: { upsert: (args) => db.user.upsert(args as Parameters<typeof db.user.upsert>[0]) },
};

export async function POST(req: Request) {
    // The host's realm selects the signing secret (Clerk Dashboard -> Webhooks).
    // Every write below is scoped to that realm, never to the payload's email alone.
    const verified = await verifyClerkBusinessWebhook(req);
    if (verified instanceof Response) return verified;
    const { realm } = verified;
    const evt: WebhookEvent = verified.event;

    // Handle the event
    const eventType = evt.type;

    if (eventType === 'user.created') {
        const { id, email_addresses, first_name, last_name, unsafe_metadata, public_metadata } = evt.data;
        const email = email_addresses[0]?.email_address;
        const name = `${first_name || ''} ${last_name || ''}`.trim();

        // 1. Team Invitation Flow
        // Metadata injected by server-side Clerk Invitation API
        const isTeamInvite = public_metadata?.source === 'team_invite';
        const inviteLocationId = public_metadata?.locationId as string | undefined;

        // 2. Public Sign-Up Flow (Tenant Domain)
        // Metadata injected by client-side SignUp component (unsafe)
        const publicLocationId = unsafe_metadata?.locationId as string | undefined;
        const publicLocationToken = unsafe_metadata?.locationToken as string | undefined;

        if (email) {
            try {
                // BRANCH 1: Public Lead (Contact Only)
                // If signed up on tenant domain (unsafe_metadata), they are a Lead/Contact.
                if (publicLocationId && !isTeamInvite) {
                    if (!realmHandlesTenantContacts(realm)) {
                        console.warn(`[Webhook] Public sign-up metadata from the ${realm} realm for ${id}. Skipping contact creation.`);
                        return new Response('Skipped (Realm has no tenant sites)', { status: 200 });
                    }
                    if (!publicLocationToken) {
                        console.warn(`[Webhook] Public sign-up for ${id} missing signed location token. Skipping contact creation.`);
                        return new Response('Skipped (Invalid Public Signup Metadata)', { status: 200 });
                    }

                    let verifiedLocationId: string;
                    try {
                        const verified = verifyPublicSignupLocationToken(publicLocationToken);
                        verifiedLocationId = verified.locationId;
                    } catch (err) {
                        console.warn(`[Webhook] Public sign-up for ${id} had invalid signed location token. Skipping contact creation.`, err);
                        return new Response('Skipped (Invalid Public Signup Metadata)', { status: 200 });
                    }

                    if (verifiedLocationId !== publicLocationId) {
                        console.warn(`[Webhook] Public sign-up for ${id} location metadata mismatch. Skipping contact creation.`);
                        return new Response('Skipped (Invalid Public Signup Metadata)', { status: 200 });
                    }

                    console.log(`[Webhook] Public Sign-Up on Location ${publicLocationId}. Creating Contact ONLY.`);

                    await db.contact.create({
                        data: {
                            location: { connect: { id: publicLocationId } },
                            clerkUserId: id,
                            name: name,
                            email: email,
                            status: "new",
                            leadSource: "Website Sign Up",
                            leadStage: "New Lead",
                        }
                    });
                    console.log(`[Webhook] Contact created for public user ${id} at location ${publicLocationId}`);
                    return new Response('Public Contact Created', { status: 200 });
                }

                // BRANCH 2: Team Invitation (User + Role)
                if (isTeamInvite && inviteLocationId) {
                    if (!realmAcceptsTeamInvites(realm)) {
                        console.warn(`[Webhook] Team invite metadata from the ${realm} realm for ${id}. No Business access yet; skipping.`);
                        return new Response('Skipped (Realm has no Business access)', { status: 200 });
                    }
                    console.log(`[Webhook] Team Invite Accepted: ${email}`);

                    // Claim the invited user by email within this realm only, and connect to Location
                    const user = await claimInvitedRealmUser(invitedUserStore, realm, {
                        clerkId: id,
                        email,
                        firstName: first_name,
                        lastName: last_name,
                        locationId: inviteLocationId,
                    });

                    const role = (public_metadata?.role as string) || 'MEMBER';
                    console.log(`[Webhook] Linking User ${user.id} to Location ${inviteLocationId} with role ${role}`);

                    // Create role record (upsert to avoid duplicates)
                    await db.userLocationRole.upsert({
                        where: {
                            userId_locationId: {
                                userId: user.id,
                                locationId: inviteLocationId
                            }
                        },
                        update: { role: role as any },
                        create: {
                            userId: user.id,
                            locationId: inviteLocationId,
                            role: role as any
                        }
                    });

                    // CRITICAL: Update Clerk publicMetadata with ghlRole so Settings page can check it
                    try {
                        const { clerkClient } = await import('@clerk/nextjs/server');
                        const client = await clerkClient();
                        await client.users.updateUser(id, {
                            publicMetadata: {
                                ...public_metadata,
                                ghlRole: role === 'ADMIN' ? 'admin' : 'user', // Normalize to lowercase
                                locationId: inviteLocationId,
                                ghlLocationId: inviteLocationId,
                            },
                        });
                        console.log(`[Webhook] Updated Clerk publicMetadata.ghlRole for user ${id}`);
                    } catch (metadataErr) {
                        console.error('[Webhook] Failed to update Clerk publicMetadata:', metadataErr);
                        // Continue - this is not fatal, just means Settings page might not show Team card
                    }

                    // --- GHL SYNC ---
                    // Sync the user to GoHighLevel (create/link)
                    try {
                        // 1. Get the actual GHL Location ID from the DB Location
                        const location = await db.location.findUnique({ where: { id: inviteLocationId } });
                        if (isGhlIntegrationEnabled() && location?.ghlLocationId) {
                            console.log(`[Webhook GHL Sync] Checking GHL user for ${email} in loc ${location.ghlLocationId}`);

                            // 2. Search for existing user in GHL
                            // Dynamic import to avoid cycles or load issues if any
                            const { searchGHLUsers, createGHLUser } = await import('@/lib/ghl/users');
                            const ghlUsers = await searchGHLUsers(location.ghlLocationId, email);

                            let ghlUserId = ghlUsers.find(u => u.email.toLowerCase() === email.toLowerCase())?.id;

                            if (ghlUserId) {
                                console.log(`[Webhook GHL Sync] User found in GHL: ${ghlUserId}. Linking...`);
                            } else {
                                console.log(`[Webhook GHL Sync] User NOT found in GHL. Creating...`);
                                const newGhlUser = await createGHLUser(location.ghlLocationId, {
                                    firstName: first_name || 'New',
                                    lastName: last_name || 'User',
                                    email: email,
                                    type: 'account',
                                    role: role === 'ADMIN' ? 'admin' : 'user'
                                });
                                ghlUserId = newGhlUser.id;
                                console.log(`[Webhook GHL Sync] Created GHL User: ${ghlUserId}`);
                            }

                            // 3. Save GHL User ID to DB
                            if (ghlUserId) {
                                await db.user.update({
                                    where: { id: user.id },
                                    data: { ghlUserId: ghlUserId }
                                });
                                console.log(`[Webhook GHL Sync] Saved ghlUserId to local database.`);
                            }
                        } else {
                            console.warn(`[Webhook GHL Sync] Skipped: No ghlLocationId found for Location ${inviteLocationId}`);
                        }
                    } catch (err) {
                        console.error('[Webhook GHL Sync] Failed to sync user to GHL:', err);
                        // We do NOT fail the webhook request, we just log the error. 
                        // The user is successfully in our DB, GHL sync can be manual later if needed.
                    }
                    // ----------------

                    console.log(`[Webhook] SUCCESS: User ${email} linked to location ${inviteLocationId}`);
                    return new Response('Team User Created', { status: 200 });
                }

                // BRANCH 3: Platform Sign-Up (Fall-Safe / Admin)
                // WARNING: Google Sign-Ups often have NO metadata.
                // We must be CAREFUL not to turn a Public User into an Admin User just because metadata is missing.

                // DECISION: If NO metadata, we ASSUME it's a Public User who lost metadata (or a platform sign-up).
                // But creating a 'User' record validates them as an App User.
                // WE SHOULD NOT create a 'User' by default anymore.

                console.warn(`[Webhook] User ${id} (${email}) created with NO valid metadata. Skipping 'User' creation to preven duplication. Logic relies on On-Access Contact creation.`);

                // If it WAS a legitimate Platform Admin sign-up (e.g. at estio.co/sign-up), we currently don't differentiate 
                // easily without metadata. 
                // TODO: Ensure Platform Sign-Up page injects 'source: platform' in public_metadata to re-enable this.

                return new Response('Skipped (No Metadata)', { status: 200 });

            } catch (error: any) {
                console.error('[Webhook] Error processing user.created:', error);
                // Return 500 to retry webhook if DB failed
                return new Response('Error processing user', { status: 500 });
            }
        }
    }

    if (eventType === 'user.updated') {
        const { id, phone_numbers } = evt.data;

        // Find verified phone number
        // Clerk sends array of phones. We want the one where verification.status === 'verified'
        const verifiedPhoneObj = phone_numbers?.find((p: any) => p.verification?.status === 'verified');
        const verifiedPhone = verifiedPhoneObj?.phone_number;

        if (verifiedPhone && realmHandlesTenantContacts(realm)) {
            console.log(`[Webhook] User ${id} updated with Verified Phone: ${verifiedPhone}`);

            try {
                // Find linked contact
                const contact = await db.contact.findUnique({
                    where: { clerkUserId: id }
                });

                if (contact) {
                    // Update phone if different
                    if (contact.phone !== verifiedPhone) {
                        await db.contact.update({
                            where: { id: contact.id },
                            data: { phone: verifiedPhone }
                        });
                        console.log(`[Webhook] Updated Contact ${contact.id} with verified phone.`);
                    }
                } else {
                    console.log(`[Webhook] No linked contact found for User ${id}. Skipping phone sync.`);
                }

                return new Response('User Updated', { status: 200 });

            } catch (error) {
                console.error('[Webhook] Error processing user.updated:', error);
                return new Response('Error processing user update', { status: 500 });
            }
        }
    }

    return new Response('', { status: 200 })
}
