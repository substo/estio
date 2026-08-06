import db from "@/lib/db";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { TeamMemberCard } from "./_components/team-member-card";
import { InviteUserDialog } from "./_components/invite-user-dialog";
import { PendingInvitationsList } from "./_components/pending-invitations-list";
import { getGHLCalendars } from "./actions";
import { checkGHLSMTPStatus } from "@/lib/ghl/email";
import { isGhlIntegrationEnabled } from "@/lib/ghl/integration-gate";
import { AccessSessionsSection } from "./_components/access-sessions-section";
import { resolveActiveLocation } from "@/lib/auth/active-location";

export default async function TeamPage({ searchParams }: { searchParams?: Promise<{ contactAccess?: string; removalAudit?: string; cleanupWarning?: string }> }) {
    const resolvedSearchParams = await searchParams;
    const contactAccessResult = resolvedSearchParams?.contactAccess;
    const removalAudit = resolvedSearchParams?.removalAudit;
    const cleanupWarning = resolvedSearchParams?.cleanupWarning === '1';
    const { userId: clerkUserId } = await auth();
    const active = await resolveActiveLocation();
    if (!clerkUserId || active.status !== "authorized" || !active.location || active.role !== "ADMIN") {
        return <div className="p-6">A current ADMIN role for the active location is required.</div>;
    }
    const locationId = active.location.id;

    // Get location with users
    const location = await db.location.findUnique({
        where: { id: locationId },
        include: {
            users: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    clerkId: true,
                    createdAt: true,
                    ghlCalendarId: true,
                    ghlUserId: true,
                    locations: { select: { id: true } },
                    locationRoles: {
                        select: { locationId: true, role: true, invitedById: true, contactAccessScope: true }
                    }
                }
            }
        }
    });

    if (!location) {
        return <div className="p-6">Location not found.</div>;
    }

    const users = location.users || [];
    const latestActivities = await db.locationSessionActivity.groupBy({
        by: ['userId'],
        where: { locationId },
        _max: { lastSeenAt: true },
    });
    const lastSeenByUser = new Map(latestActivities.map((entry) => [entry.userId, entry._max.lastSeenAt]));
    const recentlyActiveAfter = Date.now() - 15 * 60 * 1000;
    const accessMembers = users.flatMap((user) => {
        const membership = user.locationRoles.find((entry) => entry.locationId === locationId);
        if (!membership) return [];
        const lastSeenAt = lastSeenByUser.get(user.id) || null;
        return [{
            id: user.id,
            name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed User',
            email: user.email,
            role: membership.role,
            lastSeenAt: lastSeenAt?.toISOString() || null,
            recentlyActive: Boolean(lastSeenAt && lastSeenAt.getTime() >= recentlyActiveAfter),
        }];
    });
    const removalMembers = users
        .filter((user) => user.locationRoles.some((entry) => entry.locationId === locationId))
        .map((user) => ({
            id: user.id,
            email: user.email,
            name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed User',
        }));

    // Fetch GHL calendars for calendar assignment
    const calendars = await getGHLCalendars();

    // Check SMTP Status
    const smtpStatus = isGhlIntegrationEnabled() && location.ghlLocationId
        ? await checkGHLSMTPStatus(location.ghlLocationId)
        : { isConfigured: false };

    // Fetch pending invitations
    let locationInvitations: Array<{
        id: string; emailAddress: string; status: string; createdAt: number; publicMetadata: { role?: string };
    }> = [];
    try {
        const client = await clerkClient();
        const invitations = await client.invitations.getInvitationList({ status: 'pending' });
        locationInvitations = invitations.data
            .filter((inv: any) => inv.publicMetadata?.locationId === locationId)
            .map((inv: any) => ({
                id: inv.id,
                emailAddress: inv.emailAddress,
                status: inv.status,
                createdAt: inv.createdAt,
                publicMetadata: inv.publicMetadata,
            }));
    } catch (error) {
        console.warn('[TeamPage] Clerk invitations are temporarily unavailable.', error);
    }

    const isAdmin = true;

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Team Management</h1>
                    <p className="text-gray-500 text-sm">
                        Manage team access and GoHighLevel booking calendars for {location.name || 'this location'}
                    </p>
                </div>
                {isAdmin && <InviteUserDialog />}
            </div>

            <div className="grid gap-4">
                {contactAccessResult && (
                    <div
                        role={contactAccessResult === 'updated' ? 'status' : 'alert'}
                        aria-live="polite"
                        className={contactAccessResult === 'updated' ? 'rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800' : 'rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800'}
                    >
                        {contactAccessResult === 'updated' ? 'Contact access updated.' : 'Contact access could not be updated.'}
                    </div>
                )}
                {removalAudit && (
                    <div role="status" aria-live="polite" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                        <p>Location access was removed successfully. Audit ID: <span className="font-mono">{removalAudit}</span>.</p>
                        {cleanupWarning && <p className="mt-1">Some external cleanup requires attention. The successful local removal was not rolled back.</p>}
                    </div>
                )}
                {!smtpStatus.isConfigured && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <p className="text-sm text-yellow-700">
                                    <span className="font-bold">SMTP Not Configured:</span> This location cannot send emails (invites, notifications). Please configure an Email Provider (SMTP/Mailgun) in GoHighLevel settings.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <PendingInvitationsList invitations={locationInvitations} isAdmin={isAdmin} />

                <AccessSessionsSection members={accessMembers} />

                {users.length === 0 && (
                    <div className="border rounded-lg p-8 text-center text-gray-500">
                        No team members found. Invite users to give them access.
                    </div>
                )}
                {users.map((user) => (
                    <div key={user.id} className="space-y-2">
                        <TeamMemberCard
                            user={user}
                            calendars={calendars}
                            isAdmin={isAdmin}
                            isCurrentUser={user.clerkId === clerkUserId}
                            activeLocation={{ id: location.id, name: location.name }}
                            removalMembers={removalMembers}
                            hasOtherMembership={user.locations.some((entry) => entry.id !== locationId)
                                || user.locationRoles.some((entry) => entry.locationId !== locationId)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
