'use server';

import db from '@/lib/db';
import { clerkClient } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { getLocationContext } from '@/lib/auth/location-context';
import { getCalendars, createCalendarService } from '@/lib/ghl/calendars';

async function getCurrentLocationId(): Promise<string> {
    const cookieStore = await cookies();
    let locationId = cookieStore.get('crm_location_id')?.value;

    if (!locationId) {
        const locationContext = await getLocationContext();
        if (locationContext) {
            locationId = locationContext.id;
        }
    }

    if (!locationId) {
        throw new Error('No location context found');
    }

    return locationId;
}

async function requireAdminRole(locationId: string): Promise<string> {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        throw new Error('Unauthorized');
    }

    // Try to check role via UserLocationRole, fallback to legacy check
    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        include: {
            locations: { where: { id: locationId } }
        }
    });

    if (!user) {
        throw new Error('User not found');
    }

    // For now, any user connected to the location is allowed
    // Full role check will be enabled after migration
    if (!user.locations.length) {
        throw new Error('User does not have access to this location');
    }

    return user.id;
}

// ============ TEAM MEMBER MANAGEMENT ============

export async function inviteUserToLocation(formData: FormData) {
    const locationId = await getCurrentLocationId();
    const adminUserId = await requireAdminRole(locationId);

    const email = formData.get('email') as string;
    const role = formData.get('role') as 'ADMIN' | 'MEMBER';

    if (!email || !role) {
        return { success: false, error: 'Email and role are required' };
    }

    try {
        const normalizedEmail = email.toLowerCase().trim();

        // 1. Check if user already exists in OUR DB
        let user = await db.user.findUnique({ where: { email: normalizedEmail } });

        const client = await clerkClient();

        if (user) {
            // User exists in DB. Check if they exist in Clerk (REAL user vs ZOMBIE user)
            // If they were deleted from Clerk but remain in our DB, we should NOT just link them.
            // We should treat it as a new invitation.

            let clerkUserExists = false;
            try {
                if (user.clerkId) {
                    const u = await client.users.getUser(user.clerkId).catch(() => null);
                    if (u) clerkUserExists = true;
                } else {
                    // No clerkId? Check by email
                    const clerkUsers = await client.users.getUserList({ emailAddress: [normalizedEmail] });
                    if (clerkUsers.data.length > 0) clerkUserExists = true;
                }
            } catch (e) {
                console.warn('[Team] Failed to check Clerk status for existing DB user, assuming reset needed');
            }

            if (clerkUserExists) {
                // User exists in DB AND Clerk -> Just connect them (Silent immediate add)
                await db.user.update({
                    where: { id: user.id },
                    data: { locations: { connect: { id: locationId } } }
                });

                // Create role
                try {
                    await db.userLocationRole.upsert({
                        where: { userId_locationId: { userId: user.id, locationId } },
                        update: { role, invitedById: adminUserId, invitedAt: new Date() },
                        create: {
                            userId: user.id,
                            locationId,
                            role,
                            invitedById: adminUserId,
                            invitedAt: new Date()
                        },
                    });
                } catch (e) {
                    console.warn('[Team] UserLocationRole table not ready, skipping role assignment');
                }

                revalidatePath('/admin/team');
                return { success: true, message: 'User added to team immediately.' };
            }

            // If we get here, User is in DB but NOT in Clerk (Zombie). 
            // Fall through to Branch 3 (Create Invitation).
            // Do NOT connect to location yet (wait for invite acceptance).
            console.log(`[Team] User ${email} found in DB but not in Clerk (Zombie). Sending fresh invitation.`);
        }

        // 2. Check if user exists in Clerk (but not in our DB)
        // Note: We already initialized 'client' above
        if (!user) {
            const clerkUsers = await client.users.getUserList({ emailAddress: [normalizedEmail] });
            if (clerkUsers.data.length > 0) {
                // ... existing logic for Branch 2 ... ('Create user in DB and connect')
                const clerkUser = clerkUsers.data[0];
                // Create user in DB and connect
                user = await db.user.create({
                    data: {
                        email: normalizedEmail,
                        clerkId: clerkUser.id,
                        locations: { connect: { id: locationId } }
                    }
                });

                try {
                    await db.userLocationRole.upsert({
                        where: { userId_locationId: { userId: user.id, locationId } },
                        update: { role, invitedById: adminUserId, invitedAt: new Date() },
                        create: {
                            userId: user.id,
                            locationId,
                            role,
                            invitedById: adminUserId,
                            invitedAt: new Date()
                        },
                    });
                } catch (e) { }

                revalidatePath('/admin/team');
                return { success: true, message: 'User added to team immediately.' };
            }
        }

        // 3. User does not exist -> Create Invitation
        // We need the domain for the redirect URL
        // Currently we can infer it or just use a standard one.
        // Let's use the origin from the request if possible, or build it.
        // Server actions don't have easy access to request origin unless passed.
        // We'll trust Clerk's default or hardcode a sensible path.
        // Ideally: https://tenant.com/sign-in
        // But we don't know the tenant domain easily here without DB lookup on Location -> SiteConfig
        // Let's look up the location to get the domain if possible.

        const location = await db.location.findUnique({
            where: { id: locationId },
            include: { siteConfig: true }
        });

        const domain = location?.siteConfig?.domain || 'estio.co'; // Fallback
        const protocol = domain.includes('localhost') ? 'http' : 'https';
        const redirectUrl = `${protocol}://${domain}/sign-up?email_address=${encodeURIComponent(normalizedEmail)}`;

        const sourceUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        await client.invitations.createInvitation({
            emailAddress: normalizedEmail,
            redirectUrl: redirectUrl,
            publicMetadata: {
                locationId,
                ghlLocationId: location?.ghlLocationId || "", // Correctly use GHL Location ID
                role,
                invitedBy: adminUserId,
                source: "team_invite",
                sourceUrl: sourceUrl
            }
        });

        revalidatePath('/admin/team');
        return { success: true, message: 'Invitation sent!' };

    } catch (error: any) {
        console.error('[Team] Failed to invite user:', error);
        // Handle Clerk "already exists" errors specifically if needed
        return { success: false, error: error.errors?.[0]?.message || error.message || 'Failed to invite user' };
    }
}

export async function revokeInvitation(invitationId: string) {
    const locationId = await getCurrentLocationId();
    await requireAdminRole(locationId);

    try {
        const client = await clerkClient();
        await client.invitations.revokeInvitation(invitationId);
        revalidatePath('/admin/team');
        return { success: true };
    } catch (error) {
        console.error('Failed to revoke invitation:', error);
        return { success: false, error: 'Failed to revoke invitation' };
    }
}

export async function resendInvitation(invitationId: string) {
    console.log(`[ResendInvitation] Started for invitationId: ${invitationId}`);
    const locationId = await getCurrentLocationId();
    await requireAdminRole(locationId);

    try {
        const client = await clerkClient();

        // 1. Get existing invitation data
        const invitationList = await client.invitations.getInvitationList({ status: 'pending' });
        const invitation = invitationList.data.find((inv) => inv.id === invitationId);

        if (!invitation) {
            console.warn(`[ResendInvitation] Invitation ${invitationId} NOT FOUND in pending list.`);
            return { success: false, error: 'Invitation not found' };
        }
        console.log(`[ResendInvitation] Found existing invitation for ${invitation.emailAddress}`);

        // Reconstruct redirect URL (same logic as inviteUserToLocation)
        const location = await db.location.findUnique({
            where: { id: locationId },
            include: { siteConfig: true }
        });

        const domain = location?.siteConfig?.domain || 'estio.co';
        const protocol = domain.includes('localhost') ? 'http' : 'https';
        const redirectUrl = `${protocol}://${domain}/sign-up?email_address=${encodeURIComponent(invitation.emailAddress)}`;
        console.log(`[ResendInvitation] Reconstructed redirectUrl: ${redirectUrl}`);

        // 2. Revoke old invitation
        console.log(`[ResendInvitation] Revoking old invitation ${invitationId}...`);
        await client.invitations.revokeInvitation(invitationId);
        console.log(`[ResendInvitation] Revoked.`);

        // 3. Create new invitation
        console.log(`[ResendInvitation] Creating NEW invitation for ${invitation.emailAddress}...`);

        // IDEMPOTENCY: Tag with source URL to avoid cross-environment sending
        const sourceUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        const newInvite = await client.invitations.createInvitation({
            emailAddress: invitation.emailAddress,
            redirectUrl: redirectUrl,
            publicMetadata: {
                ...(invitation.publicMetadata || {}),
                locationId, // Explicitly set locationId to ensure visibility
                ghlLocationId: location?.ghlLocationId || "", // Correctly use GHL Location ID
                sourceUrl: sourceUrl
            },
            ignoreExisting: true
        });
        console.log(`[ResendInvitation] New Invitation Created with ID: ${newInvite.id}. Status: ${newInvite.status}`);

        revalidatePath('/admin/team');
        return { success: true, message: 'Invitation resent successfully' };
    } catch (error: any) {
        console.error('[ResendInvitation] Failed:', error);
        return { success: false, error: error.errors?.[0]?.message || 'Failed to resend invitation' };
    }
}



export async function updateUserRole(userId: string, newRole: 'ADMIN' | 'MEMBER') {
    const locationId = await getCurrentLocationId();
    await requireAdminRole(locationId);

    try {
        await db.userLocationRole.update({
            where: { userId_locationId: { userId, locationId } },
            data: { role: newRole },
        });

        revalidatePath('/admin/team');
        return { success: true };
    } catch (error) {
        console.error('[Team] Failed to update role:', error);
        return { success: false, error: 'Failed to update role' };
    }
}

export async function removeUserFromLocation(userId: string) {
    const locationId = await getCurrentLocationId();
    const adminUserId = await requireAdminRole(locationId);

    // Prevent self-removal
    const adminUser = await db.user.findUnique({ where: { id: adminUserId } });
    if (adminUser?.id === userId) {
        return { success: false, error: 'Cannot remove yourself' };
    }

    try {
        // Try to delete role (will fail gracefully if table doesn't exist)
        try {
            await db.userLocationRole.delete({
                where: { userId_locationId: { userId, locationId } },
            });
        } catch (e) {
            console.warn('[Team] UserLocationRole table not ready, skipping role deletion');
        }

        // Disconnect from location
        await db.location.update({
            where: { id: locationId },
            data: { users: { disconnect: { id: userId } } }
        });

        revalidatePath('/admin/team');
        return { success: true };
    } catch (error) {
        console.error('[Team] Failed to remove user:', error);
        return { success: false, error: 'Failed to remove user' };
    }
}

// ============ GHL CALENDAR MANAGEMENT (from old settings/team) ============

export async function getGHLCalendars(locationId: string) {
    const location = await db.location.findUnique({
        where: { id: locationId },
        select: { ghlLocationId: true }
    });

    if (!location?.ghlLocationId) {
        console.warn("No GHL Location ID found for location:", locationId);
        return [];
    }

    return await getCalendars(location.ghlLocationId);
}

export async function updateUserCalendar(userId: string, calendarId: string | null) {
    try {
        await db.user.update({
            where: { id: userId },
            data: { ghlCalendarId: calendarId },
        });
        revalidatePath('/admin/team');
        return { success: true };
    } catch (error) {
        console.error('Failed to update user calendar:', error);
        return { success: false, error: 'Database Error' };
    }
}

export async function createGHLCalendarForUser(
    userId: string,
    data: { name: string; slotDuration: number }
) {
    try {
        const adminUser = await auth();
        if (!adminUser.userId) return { success: false, message: 'Unauthorized' };

        const user = await db.user.findUnique({
            where: { id: userId },
            include: { locations: true }
        });

        if (!user) return { success: false, message: 'User not found' };

        const locationId = user.locations[0]?.ghlLocationId;
        if (!locationId) return { success: false, message: 'User has no GHL Location' };

        if (!user.ghlUserId) {
            return { success: false, message: 'User is not linked to a GHL User ID yet.' };
        }

        const newCalendar = await createCalendarService({
            locationId,
            name: data.name,
            duration: data.slotDuration,
            teamMembers: [user.ghlUserId],
            slug: `${data.name}-${Date.now()}`.toLowerCase().replace(/\s+/g, '-').slice(0, 40)
        });

        if (!newCalendar?.id) {
            throw new Error('Failed to create calendar in GHL');
        }

        await db.user.update({
            where: { id: userId },
            data: { ghlCalendarId: newCalendar.id }
        });

        revalidatePath('/admin/team');
        return { success: true, message: 'Calendar created and linked successfully!' };

    } catch (error) {
        console.error('Create Calendar Error:', error);
        return { success: false, message: 'Failed to create GHL Calendar' };
    }
}
