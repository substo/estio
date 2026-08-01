'use server';

import db from '@/lib/db';
import { clerkClient } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocationContext } from '@/lib/auth/location-context';
import { getCalendars, createCalendarService } from '@/lib/ghl/calendars';
import { updateGHLUser, searchGHLUsers, removeGHLUserFromLocation, createGHLUser } from '@/lib/ghl/users';
import { isGhlIntegrationEnabled } from '@/lib/ghl/integration-gate';
import {
    assertOffboardingPair,
    normalizeOffboardingEmail,
    requireExactPreviewIdentity,
    resolveStrictAdminLocation,
    type ClerkIdentity,
    type PreviewIdentity,
} from '@/lib/team/offboarding-preview-policy';
import { canUpdateMemberContactAccess } from '@/lib/contacts/active-location-access';

type OffboardingPreview = {
    asOf: string;
    operation: 'Transfer responsibilities and deactivate';
    activeLocation: { id: string; name: string | null };
    source: PreviewIdentity & { clerkId: string };
    successor: PreviewIdentity & { clerkId: string };
    counts: {
        assignedContacts: number;
        inheritedConversations: number;
        activeLocationDealsWithoutAssignee: number;
        openTasks: number;
        nonTerminalViewingSessions: number;
        futureViewingsWithAmbiguousUserId: number;
    };
    unchangedShared: { label: string; count: number }[];
    preservedAttribution: { label: string; count: number }[];
    privateState: { label: string; configured: boolean; disposition: string }[];
    ambiguous: { label: string; count: number; reason: string }[];
    blockingConditions: string[];
};

export type OffboardingPreviewResult =
    | { success: true; preview: OffboardingPreview }
    | { success: false; error: string };

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

function toPreviewIdentity(user: any): PreviewIdentity {
    const connectedIds = new Set<string>(user.locations.map((location: any) => location.id));
    const memberships = user.locationRoles.map((entry: any) => ({
        locationId: entry.locationId,
        locationName: entry.location.name,
        role: entry.role,
        connected: connectedIds.has(entry.locationId),
    }));
    for (const location of user.locations) {
        if (!memberships.some((entry: any) => entry.locationId === location.id)) {
            memberships.push({ locationId: location.id, locationName: location.name, role: null, connected: true });
        }
    }
    return {
        id: user.id,
        email: user.email,
        clerkId: user.clerkId,
        firstName: user.firstName,
        lastName: user.lastName,
        memberships,
    };
}

const previewIdentitySelect = {
    id: true,
    email: true,
    clerkId: true,
    firstName: true,
    lastName: true,
    locations: { select: { id: true, name: true } },
    locationRoles: { select: { locationId: true, role: true, location: { select: { name: true } } } },
} as const;

/** Read-only Slice 1. It deliberately has no paired execution action. */
export async function previewTransferResponsibilities(input: {
    sourceEmail: string;
    successorEmail: string;
}): Promise<OffboardingPreviewResult> {
    try {
        const { userId: actorClerkId } = await auth();
        if (!actorClerkId) throw new Error('Unauthorized');

        const actorRecord = await db.user.findUnique({
            where: { clerkId: actorClerkId },
            select: previewIdentitySelect,
        });
        const activeMembership = resolveStrictAdminLocation(actorRecord ? toPreviewIdentity(actorRecord) : null);
        const locationId = activeMembership.locationId;
        const sourceEmail = normalizeOffboardingEmail(input.sourceEmail || '');
        const successorEmail = normalizeOffboardingEmail(input.successorEmail || '');
        if (!sourceEmail || !successorEmail) throw new Error('Source and successor emails are required');

        const [sourceRecords, successorRecords, clerk] = await Promise.all([
            db.user.findMany({ where: { email: { equals: sourceEmail, mode: 'insensitive' } }, select: previewIdentitySelect }),
            db.user.findMany({ where: { email: { equals: successorEmail, mode: 'insensitive' } }, select: previewIdentitySelect }),
            clerkClient(),
        ]);
        const [sourceClerkResult, successorClerkResult] = await Promise.all([
            clerk.users.getUserList({ emailAddress: [sourceEmail], limit: 10 }),
            clerk.users.getUserList({ emailAddress: [successorEmail], limit: 10 }),
        ]);
        const mapClerk = (users: typeof sourceClerkResult.data): ClerkIdentity[] => users.map((user) => ({
            id: user.id,
            emails: user.emailAddresses.map((entry) => entry.emailAddress),
        }));
        const source = requireExactPreviewIdentity({
            label: 'Source', email: sourceEmail, localMatches: sourceRecords.map(toPreviewIdentity),
            clerkMatches: mapClerk(sourceClerkResult.data), activeLocationId: locationId,
        });
        const successor = requireExactPreviewIdentity({
            label: 'Successor', email: successorEmail, localMatches: successorRecords.map(toPreviewIdentity),
            clerkMatches: mapClerk(successorClerkResult.data), activeLocationId: locationId,
        });
        assertOffboardingPair(source, successor);

        const now = new Date();
        const [
            adminCount, assignedContacts, inheritedConversations, activeDeals, openTasks, viewingSessions,
            futureViewings, properties, companies, projects, prospects, contactHistory, messages,
            propertyAttribution, legacyUnresolvedContacts, privateUser,
        ] = await Promise.all([
            db.userLocationRole.count({ where: { locationId, role: 'ADMIN', user: { locations: { some: { id: locationId } } } } }),
            db.contact.count({ where: { locationId, assignedUserId: source.id } }),
            db.conversation.count({ where: { locationId, contact: { locationId, assignedUserId: source.id } } }),
            db.dealContext.count({ where: { locationId, stage: 'ACTIVE' } }),
            db.contactTask.count({ where: { locationId, assignedUserId: source.id, deletedAt: null, status: 'open' } }),
            db.viewingSession.count({ where: { locationId, agentId: source.id, status: { notIn: ['completed', 'expired'] } } }),
            db.viewing.count({ where: { userId: source.id, date: { gte: now }, status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] }, OR: [{ contact: { locationId } }, { property: { locationId } }] } }),
            db.property.count({ where: { locationId } }),
            db.company.count({ where: { locationId } }),
            db.project.count({ where: { locationId } }),
            db.prospectLead.count({ where: { locationId } }),
            db.contactHistory.count({ where: { contact: { locationId }, OR: [{ userId: source.id }, { updatedById: source.id }, { deletedById: source.id }] } }),
            db.message.count({ where: { userId: source.id, conversation: { locationId } } }),
            db.property.count({ where: { locationId, OR: [{ createdById: source.id }, { updatedById: source.id }] } }),
            db.contact.count({ where: { locationId, assignedUserId: null, leadAssignedToAgent: { not: null } } }),
            db.user.findUnique({ where: { id: source.id }, select: {
                googleAccessToken: true, googleRefreshToken: true, googleSyncToken: true, googleSyncEnabled: true,
                outlookAccessToken: true, outlookRefreshToken: true, outlookSyncEnabled: true,
                outlookPasswordEncrypted: true, outlookSessionCookies: true, crmUsername: true, crmPassword: true,
                gmailSyncState: { select: { id: true } }, outlookSyncState: { select: { id: true } },
                taskReminderPreference: { select: { userId: true } },
                _count: { select: { webPushSubscriptions: true, userNotifications: true } },
            } }),
        ]);

        const otherMemberships = source.memberships.filter(
            (membership) => membership.locationId !== locationId && (membership.connected || membership.role),
        );
        const blockingConditions = [
            ...(source.memberships.find((membership) => membership.locationId === locationId)?.role === 'ADMIN' && adminCount <= 1
                ? ['Source is the final active ADMIN for this location'] : []),
            ...(otherMemberships.length ? ['Source has other location memberships; global retirement requires a separate explicit decision'] : []),
            'DealContext has no authoritative user assignment field; deal transfer is deferred to Slice 4',
            'Viewing.userId is not confirmed as current responsibility; future viewings remain ambiguous',
        ];

        return { success: true, preview: {
            asOf: now.toISOString(),
            operation: 'Transfer responsibilities and deactivate',
            activeLocation: { id: locationId, name: activeMembership.locationName },
            source, successor,
            counts: {
                assignedContacts, inheritedConversations, activeLocationDealsWithoutAssignee: activeDeals,
                openTasks, nonTerminalViewingSessions: viewingSessions, futureViewingsWithAmbiguousUserId: futureViewings,
            },
            unchangedShared: [
                { label: 'Properties', count: properties }, { label: 'Companies', count: companies },
                { label: 'Projects', count: projects }, { label: 'Prospecting records', count: prospects },
            ],
            preservedAttribution: [
                { label: 'Contact history actor entries', count: contactHistory },
                { label: 'Message sender entries', count: messages },
                { label: 'Property creator/updater records', count: propertyAttribution },
            ],
            privateState: [
                { label: 'Google OAuth and Gmail sync', configured: !!(privateUser?.googleAccessToken || privateUser?.googleRefreshToken || privateUser?.googleSyncToken || privateUser?.googleSyncEnabled || privateUser?.gmailSyncState), disposition: 'Disable/revoke; never transfer credentials or cursors' },
                { label: 'Outlook OAuth and browser session', configured: !!(privateUser?.outlookAccessToken || privateUser?.outlookRefreshToken || privateUser?.outlookSyncEnabled || privateUser?.outlookPasswordEncrypted || privateUser?.outlookSessionCookies || privateUser?.outlookSyncState), disposition: 'Disable/revoke; never transfer credentials or cookies' },
                { label: 'Personal CRM credentials', configured: !!(privateUser?.crmUsername || privateUser?.crmPassword), disposition: 'Disable; never transfer credentials' },
                { label: 'Web push subscriptions', configured: !!privateUser?._count.webPushSubscriptions, disposition: 'Disable; never transfer subscriptions' },
                { label: 'Notifications and reminder preferences', configured: !!(privateUser?._count.userNotifications || privateUser?.taskReminderPreference), disposition: 'Retain privately; never copy to successor' },
                { label: 'Clerk sessions', configured: true, disposition: 'Location access removal is authoritative; global suspension requires scope confirmation' },
            ],
            ambiguous: [
                { label: 'Active location deals', count: activeDeals, reason: 'No assignee field exists' },
                { label: 'Future viewings', count: futureViewings, reason: 'Viewing.userId may be historical attribution' },
                { label: 'Legacy contacts left unassigned', count: legacyUnresolvedContacts, reason: 'Legacy identifier was not guessed or backfilled; ADMIN must resolve it explicitly' },
            ],
            blockingConditions,
        } };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unable to build preview' };
    }
}

// ============ TEAM MEMBER MANAGEMENT ============

export async function updateMemberContactAccess(formData: FormData): Promise<void> {
    let outcome = 'error';
    try {
        const location = await getLocationContext();
        const { userId: clerkUserId } = await auth();
        const targetUserId = String(formData.get('userId') || '').trim();
        const scope = String(formData.get('contactAccessScope') || '');
        if (!location || !clerkUserId || !targetUserId || !['ASSIGNED_ONLY', 'LOCATION_WIDE'].includes(scope)) {
            throw new Error('Invalid request');
        }

        const [actor, target] = await Promise.all([
            db.userLocationRole.findFirst({
                where: { locationId: location.id, role: 'ADMIN', user: { clerkId: clerkUserId, locations: { some: { id: location.id } } } },
                select: { role: true },
            }),
            db.userLocationRole.findFirst({
                where: { locationId: location.id, userId: targetUserId, role: 'MEMBER', user: { locations: { some: { id: location.id } } } },
                select: { id: true, role: true },
            }),
        ]);
        if (!actor || !target || !canUpdateMemberContactAccess(actor.role, target.role)) throw new Error('Forbidden');

        await db.userLocationRole.update({
            where: { id: target.id },
            data: { contactAccessScope: scope as 'ASSIGNED_ONLY' | 'LOCATION_WIDE' },
        });
        revalidatePath('/admin/team');
        revalidatePath('/admin/contacts');
        outcome = 'updated';
    } catch (error) {
        console.error('[Team] Failed to update contact access:', error);
    }
    redirect(`/admin/team?contactAccess=${outcome}`);
}

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
                if (isGhlIntegrationEnabled() && location?.ghlLocationId && !user.ghlUserId) {
                    try {
                        console.log(`[Team] Restoring GHL User for ${user.email}...`);
                        const ghlUser = await createGHLUser(location.ghlLocationId, {
                            firstName: user.firstName || '',
                            lastName: user.lastName || '',
                            email: user.email,
                            type: 'account',
                            role: role === 'ADMIN' ? 'admin' : 'user',
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

                // Sync role to Clerk metadata for Settings page visibility
                if (user.clerkId) {
                    try {
                        await client.users.updateUser(user.clerkId, {
                            publicMetadata: {
                                ghlRole: role === 'ADMIN' ? 'admin' : 'user',
                                locationId,
                                ghlLocationId: location?.ghlLocationId || '',
                            }
                        });
                        console.log(`[Team] Synced role to Clerk metadata for user ${user.id}`);
                    } catch (e) {
                        console.warn('[Team] Failed to sync role to Clerk metadata:', e);
                    }
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
        // 1. Update DB Role
        await db.userLocationRole.update({
            where: { userId_locationId: { userId, locationId } },
            data: { role: newRole },
        });

        // 2. Sync to Clerk & GHL
        const user = await db.user.findUnique({
            where: { id: userId },
            include: { locations: { where: { id: locationId } } }
        });

        if (user) {
            // Sync Clerk Metadata
            if (user.clerkId) {
                try {
                    const client = await clerkClient();
                    await client.users.updateUser(user.clerkId, {
                        publicMetadata: {
                            ghlRole: newRole === 'ADMIN' ? 'admin' : 'user',
                            locationId,
                            ghlLocationId: user.locations[0]?.ghlLocationId || '',
                        }
                    });
                    console.log(`[Team] Updated Clerk role for ${user.email} to ${newRole}`);
                } catch (e) {
                    console.warn('[Team] Failed to sync role to Clerk:', e);
                }
            }

            // Sync GHL User
            if (isGhlIntegrationEnabled() && user.ghlUserId && user.locations[0]?.ghlLocationId) {
                try {
                    const { updateGHLUser } = await import('@/lib/ghl/users');
                    // Note: Update user endpoint might not support changing role directly in all GHL versions,
                    // but we will try. If not supported, we might need to use a specific permission endpoint
                    // or just rely on the initial creation. However, standard v2 users update often allows role.
                    // We map 'ADMIN' -> 'admin' and 'MEMBER' -> 'user'
                    // We need to pass required fields or at least the ones we want to update.
                    // updateGHLUser function currently expects firstName/lastName/email/phone.
                    // We'll need to slightly modify updateGHLUser or just accept that we might need to overwrite other fields.
                    // Let's check updateGHLUser signature. It primarily updates profile info.
                    // GHL V2 API for updating users DOES support 'role' and 'type'.
                    // We might need to cast the payload or update list of args.

                    // Actually, let's just make a direct call here or update the helper if needed.
                    // The current updateGHLUser helper only takes profile info.
                    // Use ghlFetchWithAuth directly here for precision or update the helper.
                    // Let's use the helper but we might need to modify it. 
                    // Wait, let's look at `lib/ghl/users.ts`.
                    // It only takes specific fields. Let's just do a direct fetch here to avoid breaking changes elsewhere for now,
                    // or better, extend the payload in the helper call if it allows extra props? No it's typed.

                    // Let's extend the helper call locally since we imported it.
                    // We can't easily change the helper signature without checking all usages.
                    // We'll implement a local fix:

                    const { ghlFetchWithAuth } = await import('@/lib/ghl/token');
                    await ghlFetchWithAuth(locationId, `/users/${user.ghlUserId}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            role: newRole === 'ADMIN' ? 'admin' : 'user',
                            type: 'account' // Maintain type
                        })
                    });
                    console.log(`[Team] Updated GHL role for ${user.email} to ${newRole}`);

                } catch (e) {
                    console.warn('[Team] Failed to sync role to GHL:', e);
                }
            }
        }

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

            if (isGhlIntegrationEnabled() && userToRemove.ghlUserId && location?.ghlLocationId) {
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
    if (!isGhlIntegrationEnabled()) {
        return [];
    }

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
        if (!isGhlIntegrationEnabled()) {
            return { success: false, message: 'GHL integration is paused.' };
        }

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

        if (isGhlIntegrationEnabled() && existingUser.locationRoles.length > 0) {
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
