import db from "@/lib/db";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { TeamMemberCard } from "./_components/team-member-card";
import { InviteUserDialog } from "./_components/invite-user-dialog";
import { PendingInvitationsList } from "./_components/pending-invitations-list";
import { getGHLCalendars } from "./actions";
import { checkGHLSMTPStatus } from "@/lib/ghl/email";
import { isGhlIntegrationEnabled } from "@/lib/ghl/integration-gate";
import { resolveStrictAdminLocation, type PreviewIdentity } from "@/lib/team/offboarding-preview-policy";

export default async function TeamPage({ searchParams }: { searchParams?: Promise<{ contactAccess?: string }> }) {
    const contactAccessResult = (await searchParams)?.contactAccess;
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return <div className="p-6">Unauthorized</div>;
    }

    const actor = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true, email: true, clerkId: true, firstName: true, lastName: true,
            locations: { select: { id: true, name: true } },
            locationRoles: { select: { locationId: true, role: true, location: { select: { name: true } } } },
        },
    });
    const connectedIds = new Set(actor?.locations.map((entry) => entry.id) || []);
    const actorIdentity: PreviewIdentity | null = actor ? {
        id: actor.id,
        email: actor.email,
        clerkId: actor.clerkId,
        firstName: actor.firstName,
        lastName: actor.lastName,
        memberships: actor.locationRoles.map((entry) => ({
            locationId: entry.locationId,
            locationName: entry.location.name,
            role: entry.role,
            connected: connectedIds.has(entry.locationId),
        })),
    } : null;
    let activeMembership;
    try {
        activeMembership = resolveStrictAdminLocation(actorIdentity);
    } catch {
        return <div className="p-6">A current, unambiguous ADMIN role is required.</div>;
    }
    const locationId = activeMembership.locationId;

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
                    locationRoles: {
                        where: { locationId },
                        select: { role: true, invitedById: true, contactAccessScope: true }
                    }
                }
            }
        }
    });

    if (!location) {
        return <div className="p-6">Location not found.</div>;
    }

    const users = location.users || [];

    // Fetch GHL calendars for calendar assignment
    const calendars = await getGHLCalendars();

    // Check SMTP Status
    const smtpStatus = isGhlIntegrationEnabled() && location.ghlLocationId
        ? await checkGHLSMTPStatus(location.ghlLocationId)
        : { isConfigured: false };

    // Fetch pending invitations
    const client = await clerkClient();
    const invitations = await client.invitations.getInvitationList({ status: 'pending' });
    const locationInvitations = invitations.data
        .filter((inv: any) => inv.publicMetadata?.locationId === locationId)
        .map((inv: any) => ({
            id: inv.id,
            emailAddress: inv.emailAddress,
            status: inv.status,
            createdAt: inv.createdAt,
            publicMetadata: inv.publicMetadata,
        }));

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
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
