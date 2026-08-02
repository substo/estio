import type { Prisma } from "@prisma/client";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

export const DISCONNECTED_GOOGLE_SETTINGS = {
    googleSyncEnabled: false,
    googleSyncDirection: null,
    googleAutoSyncEnabled: false,
    googleAutoSyncLeadCapture: false,
    googleAutoSyncContactForm: false,
    googleAutoSyncWhatsAppInbound: false,
    googleAutoSyncMode: "LINK_ONLY" as const,
    googleAutoSyncPushUpdates: false,
    googleTasklistId: null,
    googleTasklistTitle: null,
    googleCalendarId: null,
    googleCalendarTitle: null,
};

const ACTIVE_OUTBOX_STATUSES = ["pending", "processing", "failed"];
const DISCONNECTED_REASON = "Google integration disconnected by user.";

export async function disconnectGoogleLocally(
    tx: Prisma.TransactionClient,
    input: { userId: string; requestId: string; now?: Date },
    dependencies: Pick<typeof settingsService, "clearSecret" | "upsertDocument"> = settingsService
) {
    const now = input.now || new Date();
    const taskOwnedByUser = {
        OR: [
            { assignedUserId: input.userId },
            { assignedUserId: null, createdByUserId: input.userId },
        ],
    };

    const results = await Promise.all([
        tx.user.update({
            where: { id: input.userId },
            data: {
                googleAccessToken: null,
                googleRefreshToken: null,
                googleSyncToken: null,
                ...DISCONNECTED_GOOGLE_SETTINGS,
            },
        }),
        tx.gmailSyncState.deleteMany({ where: { userId: input.userId } }),
        tx.googleContactDirectoryEntry.deleteMany({ where: { userId: input.userId } }),
        tx.googleContactDirectoryState.deleteMany({ where: { userId: input.userId } }),
        tx.gmailSyncOutbox.updateMany({
            where: { userId: input.userId, status: { in: ACTIVE_OUTBOX_STATUSES } },
            data: {
                status: "disabled",
                processedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: DISCONNECTED_REASON,
            },
        }),
        tx.providerOutbox.updateMany({
            where: {
                provider: "google",
                providerAccountId: input.userId,
                status: { in: ACTIVE_OUTBOX_STATUSES },
            },
            data: {
                status: "disabled",
                processedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: DISCONNECTED_REASON,
            },
        }),
        tx.contactSync.updateMany({
            where: { provider: "google", providerAccountId: input.userId },
            data: { status: "disabled", lastError: DISCONNECTED_REASON },
        }),
        tx.contactTaskOutbox.updateMany({
            where: {
                provider: "google",
                status: { in: ACTIVE_OUTBOX_STATUSES },
                task: taskOwnedByUser,
            },
            data: {
                status: "disabled",
                processedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: DISCONNECTED_REASON,
            },
        }),
        tx.contactTaskSync.updateMany({
            where: { provider: "google", task: taskOwnedByUser },
            data: { status: "disabled", lastError: DISCONNECTED_REASON },
        }),
        tx.viewingOutbox.updateMany({
            where: {
                provider: "google",
                status: { in: ACTIVE_OUTBOX_STATUSES },
                viewing: { userId: input.userId },
            },
            data: {
                status: "disabled",
                processedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: DISCONNECTED_REASON,
            },
        }),
        tx.viewingSync.updateMany({
            where: { provider: "google", viewing: { userId: input.userId } },
            data: { status: "disabled", lastError: DISCONNECTED_REASON },
        }),
        dependencies.clearSecret({
            scopeType: "USER",
            scopeId: input.userId,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
            actorUserId: input.userId,
            requestId: input.requestId,
            tx,
        }),
        dependencies.clearSecret({
            scopeType: "USER",
            scopeId: input.userId,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
            actorUserId: input.userId,
            requestId: input.requestId,
            tx,
        }),
        dependencies.upsertDocument({
            scopeType: "USER",
            scopeId: input.userId,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            payload: DISCONNECTED_GOOGLE_SETTINGS,
            actorUserId: input.userId,
            requestId: input.requestId,
            schemaVersion: 1,
            tx,
        }),
    ]);

    return {
        gmailJobsDisabled: results[4].count,
        providerJobsDisabled: results[5].count,
        taskJobsDisabled: results[7].count,
        viewingJobsDisabled: results[9].count,
    };
}
