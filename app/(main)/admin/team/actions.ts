'use server';

import db from '@/lib/db';
import { clerkClient } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { getLocationContext } from '@/lib/auth/location-context';
import { getCalendars, createCalendarService } from '@/lib/ghl/calendars';
import { updateGHLUser, searchGHLUsers, removeGHLUserFromLocation, createGHLUser } from '@/lib/ghl/users';

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
                let foundClerkUser = null;
                if (user.clerkId) {
                    foundClerkUser = await client.users.getUser(user.clerkId).catch(() => null);
                }

                if (foundClerkUser) {
                    clerkUserExists = true;
                } else {
                    // Clerk ID invalid/missing? Check by email (they might have re-registered)
                    const clerkUsers = await client.users.getUserList({ emailAddress: [normalizedEmail] });
                    if (clerkUsers.data.length > 0) {
                        clerkUserExists = true;
                        // Correction: Update our DB with the new Clerk ID so we don't have this issue again
                        await db.user.update({
                            where: { id: user.id },
                            data: { clerkId: clerkUsers.data[0].id }
                        });
                    }
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

                // Restore GHL User if missing (was offboarded)
                const location = await db.location.findUnique({ where: { id: locationId } });
                if (location?.ghlLocationId && !user.ghlUserId) {
                    try {
                        console.log(`[Team] Restoring GHL User for ${user.email}...`);
                        const ghlUser = await createGHLUser(location.ghlLocationId, {
                            firstName: user.firstName || '',
                            lastName: user.lastName || '',
                            email: user.email,
                            type: 'account',
                            role: 'user',
                            companyId: location.ghlAgencyId || undefined
                        });

                        await db.user.update({
                            where: { id: user.id },
                            data: { ghlUserId: ghlUser.id }
                        });
                        console.log(`[Team] GHL User Restored: ${ghlUser.id}`);
                    } catch (e) {
                        console.error('[Team] Failed to restore GHL user on re-invite:', e);
                    }
                }

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

        // Fix: Check for existing pending invitations and revoke them to prevent 422 Error
        try {
            const pendingInvites = await client.invitations.getInvitationList({ status: 'pending' });
            const existingInvite = pendingInvites.data.find(inv => inv.emailAddress === normalizedEmail);

            if (existingInvite) {
                console.log(`[Team] Found pending invitation for ${normalizedEmail}, revoking to send fresh one.`);
                await client.invitations.revokeInvitation(existingInvite.id);
            }
        } catch (e) {
            console.warn('[Team] Failed to check/revoke pending invitations, proceeding anyway:', e);
        }

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
        // 0. Get user details for robust offboarding
        const userToRemove = await db.user.findUnique({
            where: { id: userId },
            include: { locations: { where: { id: locationId } } }
        });

        if (userToRemove) {
            // 1. GHL OFFBOARDING
            // If they have a connected GHL User ID and this location has a GHL Location ID...
            const location = await db.location.findUnique({ where: { id: locationId } });

            if (userToRemove.ghlUserId && location?.ghlLocationId) {
                console.log(`[Team] Offboarding User ${userId} from GHL...`);
                await removeGHLUserFromLocation(location.ghlLocationId, userToRemove.ghlUserId);
            }

            // 2. GOOGLE SYNC OFFBOARDING
            // Revoke Google Sync to prevent zombie updates or leaked data
            if (userToRemove.googleSyncEnabled || userToRemove.googleRefreshToken) {
                console.log(`[Team] Revoking Google Sync for User ${userId}`);
                await db.user.update({
                    where: { id: userId },
                    data: {
                        googleSyncEnabled: false,
                        googleRefreshToken: null,
                        googleAccessToken: null,
                        googleSyncToken: null
                    }
                });
            }
        }

        // 3. REMOVE ACCESS (Local)
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

export async function updateTeamMemberProfile(formData: FormData) {
    const locationId = await getCurrentLocationId();
    await requireAdminRole(locationId);

    const userId = formData.get('userId') as string;
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const phone = (formData.get('phone') as string) || null;

    if (!userId || !firstName || !lastName) {
        return { success: false, error: 'Missing required fields' };
    }

    try {
        // 1. Get current user data to ensure we have GHL/Clerk IDs
        const existingUser = await db.user.findUnique({
            where: { id: userId },
            include: {
                locationRoles: {
                    where: { locationId },
                    include: { location: true }
                }
            }
        });

        if (!existingUser) {
            return { success: false, error: 'User not found' };
        }

        // 2. Update local DB
        await db.user.update({
            where: { id: userId },
            data: {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                phone: phone?.trim() || null
            }
        });

        // 3. Sync to Clerk
        if (existingUser.clerkId) {
            try {
                const client = await clerkClient();
                await client.users.updateUser(existingUser.clerkId, {
                    firstName: firstName.trim(),
                    lastName: lastName.trim()
                });
            } catch (clerkError) {
                console.error('[Team] Failed to sync to Clerk:', clerkError);
            }
        }

        // 4. Sync to GHL
        console.log(`[Team] GHL Sync Check - User: ${existingUser.id}, GHL ID: ${existingUser.ghlUserId}, Roles: ${existingUser.locationRoles.length}`);

        if (existingUser.locationRoles.length > 0) {
            const location = existingUser.locationRoles[0].location;
            if (location.ghlLocationId) {
                let ghlUserId = existingUser.ghlUserId;

                // Self-healing: If no GHL ID, try to find by email
                if (!ghlUserId) {
                    console.log(`[Team] No GHL ID found. Searching GHL for email: ${existingUser.email}`);
                    try {
                        const ghlUsers = await searchGHLUsers(location.ghlLocationId, existingUser.email);
                        // Filter strict email match
                        const match = ghlUsers.find(u => u.email.toLowerCase() === existingUser.email.toLowerCase());

                        if (match) {
                            console.log(`[Team] Found matching GHL User: ${match.id}. Linking...`);
                            await db.user.update({
                                where: { id: userId },
                                data: { ghlUserId: match.id }
                            });
                            ghlUserId = match.id;
                        } else {
                            console.warn(`[Team] No matching GHL user found for ${existingUser.email}`);
                        }
                    } catch (searchError) {
                        console.error('[Team] Failed to search GHL users:', searchError);
                    }
                }

                if (ghlUserId) {
                    console.log(`[Team] Syncing to GHL Location: ${location.ghlLocationId}, User: ${ghlUserId}`);
                    try {
                        const ghlResult = await updateGHLUser(location.ghlLocationId, ghlUserId, {
                            firstName: firstName.trim(),
                            lastName: lastName.trim(),
                            phone: phone?.trim() || undefined,
                            email: existingUser.email
                        });
                        console.log(`[Team] GHL Sync Success:`, ghlResult);
                    } catch (ghlError) {
                        console.error('[Team] Failed to sync to GHL:', ghlError);
                    }
                } else {
                    console.warn('[Team] Skipping GHL sync - User not found in GHL');
                }
            } else {
                console.warn('[Team] Location has no ghlLocationId, skipping GHL sync');
            }
        } else {
            console.warn('[Team] Skipping GHL sync - User has no location access');
        }

        revalidatePath('/admin/team');
        return { success: true };

    } catch (error: any) {
        console.error('[Team] Failed to update profile:', error);
        return { success: false, error: error.message || 'Failed to update profile' };
    }
}
