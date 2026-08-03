'use server';

import db from '@/lib/db';
import { Prisma } from '@prisma/client';
import { clerkClient } from '@clerk/nextjs/server';
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCalendars, createCalendarService } from '@/lib/ghl/calendars';
import { updateGHLUser, searchGHLUsers, removeGHLUserFromLocation, createGHLUser } from '@/lib/ghl/users';
import { isGhlIntegrationEnabled } from '@/lib/ghl/integration-gate';
import {
    assertOffboardingPair,
    normalizeOffboardingEmail,
    requireExactPreviewIdentity,
    requirePreviewIdentityById,
    resolveStrictAdminLocation,
    type ClerkIdentity,
    type PreviewIdentity,
} from '@/lib/team/offboarding-preview-policy';
import { randomUUID } from 'node:crypto';
import {
    createOffboardingConfirmationToken,
    createOffboardingPreviewFingerprint,
    isOffboardingExecutionConfigured,
    requiredOffboardingPhrase,
    verifyOffboardingConfirmationToken,
    type OffboardingMode,
    type OffboardingResponsibilityCounts,
} from '@/lib/team/offboarding-confirmation';
import { rebuildTaskReminderJobsForAssignee } from '@/lib/tasks/reminders';
import { enqueueTaskSyncJobs } from '@/lib/tasks/sync-engine';
import { enqueueViewingSyncJobs } from '@/lib/viewings/sync-engine';
import { queueDefaultViewingLeadReminders } from '@/lib/viewings/reminders';
import { canUpdateMemberContactAccess } from '@/lib/contacts/active-location-access';
import { applyOffboardingResponsibilityMode, countOffboardingResponsibilities, shouldClearUserGlobalPrivateState } from '@/lib/team/offboarding-responsibilities';
import {
    applyAssignmentRecovery,
    countAssignmentRecovery,
    createAssignmentRecoveryFingerprint,
    createAssignmentRecoveryToken,
    requiredAssignmentRecoveryPhrase,
    verifyAssignmentRecoveryToken,
    type AssignmentRecoveryCounts,
} from '@/lib/team/assignment-recovery';

type OffboardingPreview = {
    asOf: string;
    operation: 'Remove access to this location';
    mode: OffboardingMode;
    suspendClerkGlobally: boolean;
    activeLocation: { id: string; name: string | null };
    source: PreviewIdentity & { clerkId: string };
    successor: (PreviewIdentity & { clerkId: string }) | null;
    counts: OffboardingResponsibilityCounts;
    unchangedShared: { label: string; count: number }[];
    preservedAttribution: { label: string; count: number }[];
    privateState: { label: string; configured: boolean; disposition: string }[];
    ambiguous: { label: string; count: number; reason: string }[];
    blockingConditions: string[];
    confirmationToken: string | null;
    confirmationPhrase: string;
    fingerprint: string;
    executionConfigured: boolean;
};

export type OffboardingPreviewResult =
    | { success: true; preview: OffboardingPreview }
    | { success: false; error: string };

async function getCurrentLocationId(): Promise<string> {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error('Unauthorized');

    const actor = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            locationRoles: {
                where: { role: 'ADMIN' },
                select: { locationId: true, location: { select: { users: { where: { clerkId: clerkUserId }, select: { id: true } } } } },
            },
        },
    });
    const activeAdminLocations = (actor?.locationRoles || []).filter((entry) => entry.location.users.length === 1);
    if (activeAdminLocations.length !== 1) {
        throw new Error('A single authoritative ADMIN location is required');
    }
    return activeAdminLocations[0].locationId;
}

async function requireAdminRole(locationId: string): Promise<string> {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        throw new Error('Unauthorized');
    }

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true,
            locations: { where: { id: locationId }, select: { id: true } },
            locationRoles: { where: { locationId, role: 'ADMIN' }, select: { id: true } },
        },
    });

    if (!user) {
        throw new Error('User not found');
    }

    if (user.locations.length !== 1 || user.locationRoles.length !== 1) {
        throw new Error('Administrator access required');
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

type AssignmentRecoveryPreview = {
    asOf: string;
    activeLocation: { id: string; name: string | null };
    target: PreviewIdentity & { clerkId: string };
    counts: AssignmentRecoveryCounts;
    confirmationToken: string | null;
    confirmationPhrase: string;
    fingerprint: string;
};

export type AssignmentRecoveryPreviewResult =
    | { success: true; preview: AssignmentRecoveryPreview }
    | { success: false; error: string };

export async function previewAssignmentRecovery(input: { sourceEmail: string }): Promise<AssignmentRecoveryPreviewResult> {
    try {
        const { userId: actorClerkId } = await auth();
        if (!actorClerkId) throw new Error('Unauthorized');
        const actorRecord = await db.user.findUnique({ where: { clerkId: actorClerkId }, select: previewIdentitySelect });
        const activeMembership = resolveStrictAdminLocation(actorRecord ? toPreviewIdentity(actorRecord) : null);
        const locationId = activeMembership.locationId;
        const targetEmail = normalizeOffboardingEmail(input.sourceEmail || '');
        if (!targetEmail) throw new Error('Target email is required');

        const [targetRecords, clerk] = await Promise.all([
            db.user.findMany({ where: { email: { equals: targetEmail, mode: 'insensitive' } }, select: previewIdentitySelect }),
            clerkClient(),
        ]);
        const clerkResult = await clerk.users.getUserList({ emailAddress: [targetEmail], limit: 10 });
        const target = requireExactPreviewIdentity({
            label: 'Target',
            email: targetEmail,
            localMatches: targetRecords.map(toPreviewIdentity),
            clerkMatches: clerkResult.data.map((user) => ({ id: user.id, emails: user.emailAddresses.map((entry) => entry.emailAddress) })),
            activeLocationId: locationId,
        });
        const cutoff = new Date();
        const counts = await countAssignmentRecovery(db, { locationId, targetUserId: target.id, viewingCutoff: cutoff });
        const fingerprint = createAssignmentRecoveryFingerprint({ locationId, targetUserId: target.id, counts });
        const confirmationPhrase = requiredAssignmentRecoveryPhrase(target.email);
        const confirmationToken = createAssignmentRecoveryToken({
            confirmationId: randomUUID(),
            actorUserId: actorRecord!.id,
            locationId,
            targetUserId: target.id,
            targetClerkId: target.clerkId,
            targetEmail,
            previewFingerprint: fingerprint,
            responsibilityCutoff: cutoff.toISOString(),
            issuedAt: Date.now(),
        });
        return { success: true, preview: {
            asOf: cutoff.toISOString(),
            activeLocation: { id: locationId, name: activeMembership.locationName },
            target,
            counts,
            confirmationToken,
            confirmationPhrase,
            fingerprint,
        } };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unable to build assignment recovery preview' };
    }
}

export type AssignmentRecoveryExecuteResult =
    | { success: true; auditId: string; counts: Record<string, number>; externalErrors: string[] }
    | { success: false; error: string };

export async function executeAssignmentRecovery(input: {
    confirmationToken: string;
    confirmationPhrase: string;
    acknowledgeHistoricalPreservation: boolean;
}): Promise<AssignmentRecoveryExecuteResult> {
    try {
        if (!input.acknowledgeHistoricalPreservation) throw new Error('Historical-preservation acknowledgement is required');
        const token = verifyAssignmentRecoveryToken(input.confirmationToken);
        const { userId: actorClerkId } = await auth();
        if (!actorClerkId) throw new Error('Unauthorized');
        const actor = await db.user.findUnique({ where: { clerkId: actorClerkId }, select: { id: true } });
        if (!actor || actor.id !== token.actorUserId) throw new Error('Confirmation actor does not match');
        if (input.confirmationPhrase !== requiredAssignmentRecoveryPhrase(token.targetEmail)) throw new Error('Confirmation phrase does not match');

        const fresh = await previewAssignmentRecovery({ sourceEmail: token.targetEmail });
        if (!fresh.success) throw new Error(fresh.error);
        if (fresh.preview.activeLocation.id !== token.locationId || fresh.preview.target.id !== token.targetUserId || fresh.preview.target.clerkId !== token.targetClerkId || fresh.preview.fingerprint !== token.previewFingerprint) {
            throw new Error('Assignments changed since preview; create a fresh preview');
        }

        const result = await db.$transaction(async (tx) => {
            const [actorRole, targetRole] = await Promise.all([
                tx.userLocationRole.findFirst({ where: { userId: actor.id, locationId: token.locationId, role: 'ADMIN', user: { locations: { some: { id: token.locationId } } } }, select: { id: true } }),
                tx.userLocationRole.findFirst({ where: { userId: token.targetUserId, locationId: token.locationId, user: { locations: { some: { id: token.locationId } } } }, select: { id: true } }),
            ]);
            if (!actorRole || !targetRole) throw new Error('Active location membership changed; create a fresh preview');
            const cutoff = new Date(token.responsibilityCutoff);
            const counts = await countAssignmentRecovery(tx, { locationId: token.locationId, targetUserId: token.targetUserId, viewingCutoff: cutoff });
            if (createAssignmentRecoveryFingerprint({ locationId: token.locationId, targetUserId: token.targetUserId, counts }) !== token.previewFingerprint) {
                throw new Error('Assignments changed during confirmation; create a fresh preview');
            }
            const [taskRows, viewingRows] = await Promise.all([
                tx.contactTask.findMany({ where: {
                    locationId: token.locationId, deletedAt: null, status: 'open',
                    OR: [{ assignedUserId: null }, { assignedUserId: { not: token.targetUserId } }],
                }, select: { id: true } }),
                tx.viewing.findMany({ where: {
                    userId: { not: token.targetUserId }, date: { gte: cutoff },
                    status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] },
                    OR: [{ contact: { locationId: token.locationId } }, { property: { locationId: token.locationId } }],
                }, select: { id: true } }),
            ]);
            const changes = await applyAssignmentRecovery(tx, {
                locationId: token.locationId,
                targetUserId: token.targetUserId,
                taskIds: taskRows.map((row) => row.id),
                viewingIds: viewingRows.map((row) => row.id),
                viewingCutoff: cutoff,
            });
            if (
                changes.contacts !== counts.contacts || changes.deals !== counts.deals
                || changes.openTasks !== counts.openTasks
                || changes.nonTerminalViewingSessions !== counts.nonTerminalViewingSessions
                || changes.futureActionableViewings !== counts.futureActionableViewings
            ) throw new Error('Assignment recovery count changed; transaction rolled back');

            const canceledReminders = await tx.taskReminderJob.updateMany({
                where: { locationId: token.locationId, taskId: { in: taskRows.map((row) => row.id) }, userId: { not: token.targetUserId }, status: { in: ['pending', 'processing', 'failed'] } },
                data: { status: 'canceled', processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: 'Canceled by assignment recovery' },
            });
            const audit = await tx.userOffboardingAudit.create({
                data: {
                    locationId: token.locationId,
                    actorUserId: actor.id,
                    sourceUserId: token.targetUserId,
                    successorUserId: null,
                    mode: 'RECOVERY',
                    operation: 'Recover all location assignments',
                    confirmationId: token.confirmationId,
                    status: 'LOCAL_COMPLETE',
                    globalSuspensionRequested: false,
                    previewJson: { asOf: fresh.preview.asOf, fingerprint: token.previewFingerprint, counts },
                    resultJson: { ...changes, inheritedConversations: counts.inheritedConversations, canceledReminderJobs: canceledReminders.count },
                },
                select: { id: true },
            });
            return {
                auditId: audit.id,
                counts: { ...changes, inheritedConversations: counts.inheritedConversations, canceledReminderJobs: canceledReminders.count },
                taskIds: taskRows.map((row) => row.id),
                viewingIds: viewingRows.map((row) => row.id),
            };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        const externalErrors: string[] = [];
        for (const taskId of result.taskIds) {
            try { await enqueueTaskSyncJobs({ taskId, operation: 'update' }); }
            catch (error) { console.error('[Assignment recovery] Task synchronization failed', error); externalErrors.push('Task synchronization requires attention'); }
        }
        try { await rebuildTaskReminderJobsForAssignee(token.targetUserId); }
        catch (error) { console.error('[Assignment recovery] Reminder rebuilding failed', error); externalErrors.push('Task reminder rebuilding requires attention'); }
        for (const viewingId of result.viewingIds) {
            try { await enqueueViewingSyncJobs({ viewingId, operation: 'update' }); }
            catch (error) { console.error('[Assignment recovery] Viewing synchronization failed', error); externalErrors.push('Viewing synchronization requires attention'); }
            try { await queueDefaultViewingLeadReminders(viewingId); }
            catch (error) { console.error('[Assignment recovery] Viewing reminder rebuilding failed', error); externalErrors.push('Viewing reminder rebuilding requires attention'); }
        }
        try {
            revalidatePath('/admin/team'); revalidatePath('/admin/contacts'); revalidatePath('/admin/conversations'); revalidatePath('/admin/deals');
        } catch (error) { console.error('[Assignment recovery] Cache refresh failed', error); externalErrors.push('UI cache refresh requires attention'); }
        try {
            await db.userOffboardingAudit.update({
                where: { id: result.auditId },
                data: { status: externalErrors.length ? 'COMPLETED_WITH_EXTERNAL_ERRORS' : 'COMPLETED', resultJson: { ...result.counts, externalErrors } },
            });
        } catch (error) { console.error('[Assignment recovery] Audit finalization failed', error); externalErrors.push('Audit finalization requires attention; LOCAL_COMPLETE remains authoritative'); }
        return { success: true, auditId: result.auditId, counts: result.counts, externalErrors };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return { success: false, error: 'Assignments changed concurrently; create a fresh preview' };
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { success: false, error: 'This confirmation was already used; create a fresh preview' };
        return { success: false, error: error instanceof Error ? error.message : 'Assignment recovery failed' };
    }
}

/** Read-only preview. Identity intent and all counts are resolved server-side. */
export async function previewTransferResponsibilities(input: {
    sourceUserId: string;
    successorUserId?: string;
    mode: OffboardingMode;
    suspendClerkGlobally: boolean;
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
        const sourceUserId = String(input.sourceUserId || '').trim();
        const successorUserId = String(input.successorUserId || '').trim();
        if (!['TRANSFER', 'KEEP_ASSIGNED'].includes(input.mode)) throw new Error('A valid offboarding mode is required');
        if (!sourceUserId) throw new Error('Source user is required');
        if (input.mode === 'TRANSFER' && !successorUserId) throw new Error('Successor user is required for TRANSFER');
        if (input.mode === 'TRANSFER' && sourceUserId === successorUserId) throw new Error('Source and successor must be different users');

        const requestedIds = input.mode === 'TRANSFER' ? [sourceUserId, successorUserId] : [sourceUserId];
        const localRecords = await db.user.findMany({
            where: { id: { in: requestedIds } },
            select: previewIdentitySelect,
        });
        const localIdentities = localRecords.map(toPreviewIdentity);
        const sourceLocal = localIdentities.find((identity) => identity.id === sourceUserId);
        const successorLocal = localIdentities.find((identity) => identity.id === successorUserId);
        if (!sourceLocal?.clerkId) throw new Error('Source local User and Clerk identity do not agree');
        if (input.mode === 'TRANSFER' && !successorLocal?.clerkId) throw new Error('Successor local User and Clerk identity do not agree');

        const clerk = await clerkClient();
        const [sourceClerkUser, successorClerkUser] = await Promise.all([
            clerk.users.getUser(sourceLocal.clerkId),
            input.mode === 'TRANSFER' && successorLocal?.clerkId
                ? clerk.users.getUser(successorLocal.clerkId)
                : Promise.resolve(null),
        ]);
        const toClerkIdentity = (user: typeof sourceClerkUser | null): ClerkIdentity | null => user ? ({
            id: user.id,
            emails: user.emailAddresses.map((entry) => entry.emailAddress),
        }) : null;
        const source = requirePreviewIdentityById({
            label: 'Source', userId: sourceUserId, localMatches: localIdentities,
            clerkIdentity: toClerkIdentity(sourceClerkUser), activeLocationId: locationId,
        });
        const successor = input.mode === 'TRANSFER' ? requirePreviewIdentityById({
            label: 'Successor', userId: successorUserId, localMatches: localIdentities,
            clerkIdentity: toClerkIdentity(successorClerkUser), activeLocationId: locationId,
        }) : null;
        if (successor) assertOffboardingPair(source, successor);
        if (source.id === actorRecord!.id) throw new Error('You cannot remove yourself from the active location');

        const now = new Date();
        const [
            adminCount, counts, properties, companies, projects, prospects, contactHistory, messages,
            propertyAttribution, legacyUnresolvedContacts, privateUser,
        ] = await Promise.all([
            db.userLocationRole.count({ where: { locationId, role: 'ADMIN', user: { locations: { some: { id: locationId } } } } }),
            countOffboardingResponsibilities(db, { locationId, sourceUserId: source.id, viewingCutoff: now }),
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
            ...(input.suspendClerkGlobally && otherMemberships.length
                ? ['Global identity retirement is unavailable while the source has other location memberships'] : []),
            ...(!isOffboardingExecutionConfigured() ? ['OFFBOARDING_CONFIRMATION_SECRET is not configured'] : []),
        ];

        const fingerprint = createOffboardingPreviewFingerprint({
            locationId,
            sourceUserId: source.id,
            successorUserId: successor?.id || null,
            mode: input.mode,
            suspendClerkGlobally: input.suspendClerkGlobally,
            counts,
        });
        const confirmationPhrase = requiredOffboardingPhrase(input.mode, source.email);
        const confirmationToken = blockingConditions.length === 0
            ? createOffboardingConfirmationToken({
                confirmationId: randomUUID(),
                actorUserId: actorRecord!.id,
                locationId,
                sourceUserId: source.id,
                successorUserId: successor?.id || null,
                sourceClerkId: source.clerkId,
                successorClerkId: successor?.clerkId || null,
                sourceEmail: normalizeOffboardingEmail(source.email),
                successorEmail: successor ? normalizeOffboardingEmail(successor.email) : null,
                mode: input.mode,
                suspendClerkGlobally: input.suspendClerkGlobally,
                previewFingerprint: fingerprint,
                responsibilityCutoff: now.toISOString(),
                issuedAt: Date.now(),
            })
            : null;

        return { success: true, preview: {
            asOf: now.toISOString(),
            operation: 'Remove access to this location',
            mode: input.mode,
            suspendClerkGlobally: input.suspendClerkGlobally,
            activeLocation: { id: locationId, name: activeMembership.locationName },
            source, successor,
            counts,
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
                { label: 'Google OAuth and Gmail sync', configured: !!(privateUser?.googleAccessToken || privateUser?.googleRefreshToken || privateUser?.googleSyncToken || privateUser?.googleSyncEnabled || privateUser?.gmailSyncState), disposition: otherMemberships.length ? 'Preserve for other location memberships' : 'Clear after local commit; never transfer credentials or cursors' },
                { label: 'Outlook OAuth and browser session', configured: !!(privateUser?.outlookAccessToken || privateUser?.outlookRefreshToken || privateUser?.outlookSyncEnabled || privateUser?.outlookPasswordEncrypted || privateUser?.outlookSessionCookies || privateUser?.outlookSyncState), disposition: otherMemberships.length ? 'Preserve for other location memberships' : 'Clear after local commit; never transfer credentials or cookies' },
                { label: 'Personal CRM credentials', configured: !!(privateUser?.crmUsername || privateUser?.crmPassword), disposition: otherMemberships.length ? 'Preserve for other location memberships' : 'Clear after local commit; never transfer credentials' },
                { label: 'Web push subscriptions', configured: !!privateUser?._count.webPushSubscriptions, disposition: otherMemberships.length ? 'Preserve for other location memberships' : 'Clear after local commit; never transfer subscriptions' },
                { label: 'Notifications and reminder preferences', configured: !!(privateUser?._count.userNotifications || privateUser?.taskReminderPreference), disposition: 'Retain privately; never copy to successor' },
                { label: 'Clerk sessions', configured: true, disposition: 'Location access removal is authoritative; global suspension requires scope confirmation' },
            ],
            ambiguous: [
                { label: 'Active deals without a safe assignee', count: counts.activeUnassignedDeals, reason: 'Conservative Deal backfill could not classify these; ADMIN must assign them explicitly' },
                { label: 'Legacy contacts left unassigned', count: legacyUnresolvedContacts, reason: 'Legacy identifier was not guessed or backfilled; ADMIN must resolve it explicitly' },
            ],
            blockingConditions,
            confirmationToken,
            confirmationPhrase,
            fingerprint,
            executionConfigured: isOffboardingExecutionConfigured(),
        } };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unable to build preview' };
    }
}

export type ExecuteOffboardingResult =
    | { success: true; auditId: string; counts: Record<string, number>; externalErrors: string[] }
    | { success: false; error: string };

/**
 * Final execution path. It accepts no client location, IDs, roles, or counts.
 * A fresh server preview and an exact, short-lived signed confirmation are mandatory.
 */
export async function executeTransferResponsibilities(input: {
    confirmationToken: string;
    confirmationPhrase: string;
    acknowledgeNoHistoricalRewrite: boolean;
}): Promise<ExecuteOffboardingResult> {
    let localCommit: { auditId: string; counts: Record<string, number>; taskIds: string[]; viewingIds: string[] } | null = null;
    try {
        if (!input.acknowledgeNoHistoricalRewrite) throw new Error('Confirmation acknowledgement is required');
        const token = verifyOffboardingConfirmationToken(input.confirmationToken);
        const { userId: actorClerkId } = await auth();
        if (!actorClerkId) throw new Error('Unauthorized');

        const actor = await db.user.findUnique({ where: { clerkId: actorClerkId }, select: { id: true } });
        if (!actor || actor.id !== token.actorUserId) throw new Error('Confirmation actor does not match');
        if (input.confirmationPhrase !== requiredOffboardingPhrase(token.mode, token.sourceEmail)) {
            throw new Error('Confirmation phrase does not match');
        }

        const fresh = await previewTransferResponsibilities({
            sourceUserId: token.sourceUserId,
            successorUserId: token.successorUserId || undefined,
            mode: token.mode,
            suspendClerkGlobally: token.suspendClerkGlobally,
        });
        if (!fresh.success) throw new Error(fresh.error);
        const preview = fresh.preview;
        if (preview.blockingConditions.length) throw new Error(preview.blockingConditions.join('; '));
        if (
            preview.activeLocation.id !== token.locationId
            || preview.source.id !== token.sourceUserId
            || (preview.successor?.id || null) !== token.successorUserId
            || preview.source.clerkId !== token.sourceClerkId
            || (preview.successor?.clerkId || null) !== token.successorClerkId
        ) {
            throw new Error('Fresh preview no longer matches confirmation');
        }

        if (preview.fingerprint !== token.previewFingerprint) {
            throw new Error('Responsibilities changed since preview; create a fresh preview');
        }

        const now = new Date();
        localCommit = await db.$transaction(async (tx) => {
            const [actorRole, sourceRole, successorRole, activeAdminCount, otherRoleCount, otherConnectionCount] = await Promise.all([
                tx.userLocationRole.findFirst({ where: { userId: actor.id, locationId: token.locationId, role: 'ADMIN', user: { locations: { some: { id: token.locationId } } } }, select: { id: true } }),
                tx.userLocationRole.findFirst({ where: { userId: token.sourceUserId, locationId: token.locationId, user: { locations: { some: { id: token.locationId } } } }, select: { id: true, role: true } }),
                token.successorUserId
                    ? tx.userLocationRole.findFirst({ where: { userId: token.successorUserId, locationId: token.locationId, user: { locations: { some: { id: token.locationId } } } }, select: { id: true } })
                    : Promise.resolve(null),
                tx.userLocationRole.count({ where: { locationId: token.locationId, role: 'ADMIN', user: { locations: { some: { id: token.locationId } } } } }),
                tx.userLocationRole.count({ where: { userId: token.sourceUserId, locationId: { not: token.locationId } } }),
                tx.location.count({ where: { id: { not: token.locationId }, users: { some: { id: token.sourceUserId } } } }),
            ]);
            if (!actorRole || !sourceRole || (token.mode === 'TRANSFER' && !successorRole)) throw new Error('Active membership changed; build a new preview');
            if (actor.id === token.sourceUserId) throw new Error('You cannot remove yourself from the active location');
            if (sourceRole.role === 'ADMIN' && activeAdminCount <= 1) throw new Error('Source is the final active ADMIN');
            const hasOtherMembership = otherRoleCount > 0 || otherConnectionCount > 0;
            if (token.suspendClerkGlobally && hasOtherMembership) {
                throw new Error('Global identity retirement is unavailable while other memberships exist');
            }

            const transactionalCounts = await countOffboardingResponsibilities(tx, {
                locationId: token.locationId,
                sourceUserId: token.sourceUserId,
                viewingCutoff: new Date(token.responsibilityCutoff),
            });
            const transactionalFingerprint = createOffboardingPreviewFingerprint({
                locationId: token.locationId,
                sourceUserId: token.sourceUserId,
                successorUserId: token.successorUserId,
                mode: token.mode,
                suspendClerkGlobally: token.suspendClerkGlobally,
                counts: transactionalCounts,
            });
            if (transactionalFingerprint !== token.previewFingerprint) {
                throw new Error('Responsibilities changed during confirmation; create a fresh preview');
            }

            const [taskRows, viewingRows] = token.mode === 'TRANSFER' ? await Promise.all([
                tx.contactTask.findMany({
                    where: { locationId: token.locationId, assignedUserId: token.sourceUserId, deletedAt: null, status: 'open' },
                    select: { id: true },
                }),
                tx.viewing.findMany({
                    where: {
                        userId: token.sourceUserId,
                        date: { gte: new Date(token.responsibilityCutoff) },
                        status: { notIn: ['completed', 'cancelled', 'canceled', 'no_show'] },
                        OR: [{ contact: { locationId: token.locationId } }, { property: { locationId: token.locationId } }],
                    },
                    select: { id: true },
                }),
            ]) : [[], []];

            const responsibilityChanges = await applyOffboardingResponsibilityMode(tx, {
                mode: token.mode,
                locationId: token.locationId,
                sourceUserId: token.sourceUserId,
                successorUserId: token.successorUserId,
                taskIds: taskRows.map((row) => row.id),
                viewingIds: viewingRows.map((row) => row.id),
                viewingCutoff: new Date(token.responsibilityCutoff),
            });
            if (token.mode === 'TRANSFER' && (
                responsibilityChanges.contacts !== transactionalCounts.assignedContacts
                || responsibilityChanges.deals !== transactionalCounts.activeAssignedDeals
                || responsibilityChanges.tasks !== transactionalCounts.openTasks
                || responsibilityChanges.viewingSessions !== transactionalCounts.nonTerminalViewingSessions
                || responsibilityChanges.futureViewings !== transactionalCounts.futureActionableViewings
            )) throw new Error('Responsibility transfer count changed; transaction rolled back');

            const canceledReminders = await tx.taskReminderJob.updateMany({
                where: { locationId: token.locationId, userId: token.sourceUserId, status: { in: ['pending', 'processing', 'failed'] } },
                data: { status: 'canceled', processedAt: now, lockedAt: null, lockedBy: null, lastError: 'Canceled by location offboarding' },
            });
            const clearPrivateState = shouldClearUserGlobalPrivateState(otherRoleCount, otherConnectionCount);

            await Promise.all([
                ...(clearPrivateState ? [
                    tx.gmailSyncState.deleteMany({ where: { userId: token.sourceUserId } }),
                    tx.outlookSyncState.deleteMany({ where: { userId: token.sourceUserId } }),
                    tx.googleContactDirectoryState.deleteMany({ where: { userId: token.sourceUserId } }),
                    tx.googleContactDirectoryEntry.deleteMany({ where: { userId: token.sourceUserId } }),
                    tx.webPushSubscription.deleteMany({ where: { userId: token.sourceUserId } }),
                    tx.settingsSecret.deleteMany({
                        where: {
                            scopeType: 'USER',
                            scopeId: token.sourceUserId,
                            domain: 'user.integrations.chatgpt_subscription',
                        },
                    }),
                    tx.settingsDocument.deleteMany({
                        where: {
                            scopeType: 'USER',
                            scopeId: token.sourceUserId,
                            domain: 'user.integrations.chatgpt_subscription',
                        },
                    }),
                    tx.gmailSyncOutbox.updateMany({
                    where: { userId: token.sourceUserId, status: { in: ['pending', 'processing', 'failed'] } },
                    data: { status: 'disabled', processedAt: now, lockedAt: null, lockedBy: null, lastError: 'Disabled by user offboarding' },
                    }),
                ] : []),
                tx.user.update({
                    where: { id: token.sourceUserId },
                    data: {
                        ...(clearPrivateState ? {
                            googleAccessToken: null, googleRefreshToken: null, googleSyncToken: null,
                            googleSyncEnabled: false, googleAutoSyncEnabled: false,
                            outlookAccessToken: null, outlookRefreshToken: null, outlookSyncEnabled: false,
                            outlookSubscriptionId: null, outlookSubscriptionExpiry: null,
                            outlookPasswordEncrypted: null, outlookSessionCookies: null, outlookSessionExpiry: null,
                            crmUsername: null, crmPassword: null,
                        } : {}),
                        locations: { disconnect: { id: token.locationId } },
                    },
                }),
                tx.userLocationRole.delete({ where: { id: sourceRole.id } }),
            ]);

            const audit = await tx.userOffboardingAudit.create({
                data: {
                    locationId: token.locationId,
                    actorUserId: actor.id,
                    sourceUserId: token.sourceUserId,
                    successorUserId: token.successorUserId,
                    mode: token.mode,
                    operation: 'Remove access to this location',
                    confirmationId: token.confirmationId,
                    status: 'LOCAL_COMPLETE',
                    globalSuspensionRequested: token.suspendClerkGlobally,
                    previewJson: {
                        asOf: preview.asOf,
                        mode: token.mode,
                        suspendClerkGlobally: token.suspendClerkGlobally,
                        fingerprint: token.previewFingerprint,
                        counts: preview.counts,
                        unchangedShared: preview.unchangedShared,
                        preservedAttribution: preview.preservedAttribution,
                        privateState: preview.privateState.map(({ label, configured, disposition }) => ({ label, configured, disposition })),
                    },
                    resultJson: { ...responsibilityChanges, canceledReminderJobs: canceledReminders.count },
                },
                select: { id: true },
            });
            return { auditId: audit.id, counts: { ...responsibilityChanges, canceledReminderJobs: canceledReminders.count }, taskIds: taskRows.map((row) => row.id), viewingIds: viewingRows.map((row) => row.id) };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const transactionResult = localCommit;

        const externalErrors: string[] = [];
        const recordExternalError = (description: string, error: unknown) => {
            console.error(`[Team offboarding] ${description}`, error);
            externalErrors.push(description);
        };
        for (const taskId of transactionResult.taskIds) {
            try { await enqueueTaskSyncJobs({ taskId, operation: 'update' }); }
            catch (error) { recordExternalError('Task synchronization requires attention', error); }
        }
        if (token.successorUserId) {
            try { await rebuildTaskReminderJobsForAssignee(token.successorUserId); }
            catch (error) { recordExternalError('Task reminder rebuilding requires attention', error); }
        }
        for (const viewingId of transactionResult.viewingIds) {
            try { await enqueueViewingSyncJobs({ viewingId, operation: 'update' }); }
            catch (error) { recordExternalError('Viewing synchronization requires attention', error); }
            try { await queueDefaultViewingLeadReminders(viewingId); }
            catch (error) { recordExternalError('Viewing reminder rebuilding requires attention', error); }
        }

        let sourceUser: { clerkId: string | null; ghlUserId: string | null } | null = null;
        let location: { ghlLocationId: string | null } | null = null;
        try {
            [sourceUser, location] = await Promise.all([
                db.user.findUnique({ where: { id: token.sourceUserId }, select: { clerkId: true, ghlUserId: true } }),
                db.location.findUnique({ where: { id: token.locationId }, select: { ghlLocationId: true } }),
            ]);
        } catch (error) { recordExternalError('External account cleanup could not be evaluated', error); }
        if (sourceUser?.ghlUserId && location?.ghlLocationId) {
            try {
                const removed = await removeGHLUserFromLocation(location.ghlLocationId, sourceUser.ghlUserId);
                if (!removed) throw new Error('Provider returned an unsuccessful result');
            } catch (error) { recordExternalError('GHL access cleanup requires attention', error); }
        }
        if (token.suspendClerkGlobally && sourceUser?.clerkId) {
            try {
                const clerk = await clerkClient();
                const sessions = await clerk.sessions.getSessionList({ userId: sourceUser.clerkId, limit: 100 });
                for (const session of sessions.data) await clerk.sessions.revokeSession(session.id);
                await clerk.users.banUser(sourceUser.clerkId);
            } catch (error) {
                recordExternalError('Global Clerk retirement requires attention', error);
            }
        }

        try {
            await db.userOffboardingAudit.update({
                where: { id: transactionResult.auditId },
                data: {
                    status: externalErrors.length ? 'COMPLETED_WITH_EXTERNAL_ERRORS' : 'COMPLETED',
                    resultJson: { ...transactionResult.counts, externalErrors },
                },
            });
        } catch (error) {
            recordExternalError('Audit finalization requires attention; the LOCAL_COMPLETE audit remains authoritative', error);
        }
        try {
            revalidatePath('/admin/team');
            revalidatePath('/admin/contacts');
            revalidatePath('/admin/conversations');
        } catch (error) { recordExternalError('UI cache refresh requires attention', error); }
        return { success: true, auditId: transactionResult.auditId, counts: transactionResult.counts, externalErrors };
    } catch (error) {
        if (localCommit) {
            console.error('[Team offboarding] Unexpected post-commit failure', error);
            return {
                success: true,
                auditId: localCommit.auditId,
                counts: localCommit.counts,
                externalErrors: ['Unexpected external cleanup failure requires attention'],
            };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            return { success: false, error: 'Membership changed concurrently; create a fresh preview' };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { success: false, error: 'This confirmation was already used; create a fresh preview' };
        }
        return { success: false, error: error instanceof Error ? error.message : 'Offboarding failed' };
    }
}

// ============ TEAM MEMBER MANAGEMENT ============

export async function updateMemberContactAccess(formData: FormData): Promise<void> {
    let outcome = 'error';
    try {
        const locationId = await getCurrentLocationId();
        await requireAdminRole(locationId);
        const targetUserId = String(formData.get('userId') || '').trim();
        const scope = String(formData.get('contactAccessScope') || '');
        if (!targetUserId || !['ASSIGNED_ONLY', 'LOCATION_WIDE'].includes(scope)) throw new Error('Invalid request');

        const target = await db.userLocationRole.findFirst({
            where: { locationId, userId: targetUserId, role: 'MEMBER', user: { locations: { some: { id: locationId } } } },
            select: { id: true, role: true },
        });
        if (!target || !canUpdateMemberContactAccess('ADMIN', target.role)) throw new Error('Forbidden');
        await db.userLocationRole.update({
            where: { id: target.id },
            data: { contactAccessScope: scope as 'ASSIGNED_ONLY' | 'LOCATION_WIDE' },
        });
        revalidatePath('/admin/team');
        revalidatePath('/admin/contacts');
        revalidatePath('/admin/conversations');
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
            const existingInvite = pendingInvites.data.find(inv =>
                inv.emailAddress.toLowerCase() === normalizedEmail && inv.publicMetadata?.locationId === locationId
            );

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
        const invitations = await client.invitations.getInvitationList({ status: 'pending' });
        const invitation = invitations.data.find((entry) => entry.id === invitationId && entry.publicMetadata?.locationId === locationId);
        if (!invitation) return { success: false, error: 'Invitation not found for this location' };
        await client.invitations.revokeInvitation(invitation.id);
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

        if (!invitation || invitation.publicMetadata?.locationId !== locationId) {
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
    const adminUserId = await requireAdminRole(locationId);

    try {
        await db.$transaction(async (tx) => {
            const [actorRole, targetRole] = await Promise.all([
                tx.userLocationRole.findFirst({ where: { userId: adminUserId, locationId, role: 'ADMIN', user: { locations: { some: { id: locationId } } } }, select: { id: true } }),
                tx.userLocationRole.findFirst({ where: { userId, locationId, user: { locations: { some: { id: locationId } } } }, select: { id: true, role: true } }),
            ]);
            if (!actorRole) throw new Error('Administrator access changed');
            if (!targetRole) throw new Error('Team member not found for this location');
            if (newRole === 'MEMBER' && adminUserId === userId) throw new Error('You cannot demote yourself');
            if (newRole === 'MEMBER' && targetRole.role === 'ADMIN') {
                const activeAdmins = await tx.userLocationRole.count({ where: { locationId, role: 'ADMIN', user: { locations: { some: { id: locationId } } } } });
                if (activeAdmins <= 1) throw new Error('The final active ADMIN cannot be demoted');
            }
            await tx.userLocationRole.update({ where: { id: targetRole.id }, data: { role: newRole } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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

export async function removeUserFromLocation(_userId: string) {
    return {
        success: false,
        error: 'Direct removal is disabled. Use Transfer responsibilities and deactivate with a fresh confirmed preview.',
    };
}

// ============ GHL CALENDAR MANAGEMENT (from old settings/team) ============

export async function getGHLCalendars() {
    const locationId = await getCurrentLocationId();
    await requireAdminRole(locationId);
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
        const locationId = await getCurrentLocationId();
        await requireAdminRole(locationId);
        const target = await db.user.findFirst({ where: { id: userId, locations: { some: { id: locationId } } }, select: { id: true } });
        if (!target) return { success: false, error: 'Team member not found for this location' };
        await db.user.update({
            where: { id: target.id },
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
        const activeLocationId = await getCurrentLocationId();
        await requireAdminRole(activeLocationId);
        if (!isGhlIntegrationEnabled()) {
            return { success: false, message: 'GHL integration is paused.' };
        }

        const user = await db.user.findFirst({
            where: { id: userId, locations: { some: { id: activeLocationId } } },
            include: { locations: { where: { id: activeLocationId } } }
        });

        if (!user) return { success: false, message: 'User not found' };

        const ghlLocationId = user.locations[0]?.ghlLocationId;
        if (!ghlLocationId) return { success: false, message: 'User has no GHL Location' };

        if (!user.ghlUserId) {
            return { success: false, message: 'User is not linked to a GHL User ID yet.' };
        }

        const newCalendar = await createCalendarService({
            locationId: ghlLocationId,
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
        const existingUser = await db.user.findFirst({
            where: { id: userId, locations: { some: { id: locationId } } },
            include: {
                locationRoles: {
                    where: { locationId },
                    include: { location: true }
                }
            }
        });

        if (!existingUser || existingUser.locationRoles.length !== 1) {
            return { success: false, error: 'Team member not found for this location' };
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
