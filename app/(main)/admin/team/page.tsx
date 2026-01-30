import db from "@/lib/db";
import { cookies } from "next/headers";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getLocationContext } from "@/lib/auth/location-context";
import { redirect } from "next/navigation";
import { TeamMemberCard } from "./_components/team-member-card";
import { InviteUserDialog } from "./_components/invite-user-dialog";
import { PendingInvitationsList } from "./_components/pending-invitations-list";
import { getGHLCalendars } from "./actions";
import { checkGHLSMTPStatus } from "@/lib/ghl/email";

export default async function TeamPage() {
    const cookieStore = await cookies();
    let locationId = cookieStore.get("crm_location_id")?.value;

    if (!locationId) {
        const locationContext = await getLocationContext();
        if (locationContext) {
            locationId = locationContext.id;
        }
    }

    if (!locationId) {
        return <div className="p-6">No location context found.</div>;
    }

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return <div className="p-6">Unauthorized</div>;
    }

    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, locationId);
    if (!hasAccess) {
        redirect('/admin');
    }

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
                        select: { role: true }
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
    const calendars = await getGHLCalendars(locationId);

    // Check SMTP Status
    const smtpStatus = location.ghlLocationId
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

    // Check current user role (try new table, fallback to allowing all location users)
    let isAdmin = true; // Default to admin until roles are migrated
    try {
        const currentUser = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            include: { locationRoles: { where: { locationId } } }
        });
        if (currentUser?.locationRoles?.length) {
            isAdmin = currentUser.locationRoles[0].role === 'ADMIN';
        }
    } catch (e) {
        // Table doesn't exist yet, allow all users for now
    }

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Team Management</h1>
                    <p className="text-gray-500 text-sm">
                        Manage team access and GHL calendars for {location.name || 'this location'}
                    </p>
                </div>
                {isAdmin && <InviteUserDialog />}
            </div>

            <div className="grid gap-4">
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
                    <TeamMemberCard
                        key={user.id}
                        user={user}
                        calendars={calendars}
                        isAdmin={isAdmin}
                        isCurrentUser={user.clerkId === clerkUserId}
                    />
                ))}
            </div>
        </div>
    );
}
