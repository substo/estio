import { randomUUID } from 'crypto';
import { ViewingOutbox, Prisma } from '@prisma/client';
import db from '@/lib/db';
import { ensureRemoteContact } from '@/lib/crm/contact-sync';
import { GHLError } from '@/lib/ghl/client';
import {
    createGhlViewingAppointment,
    updateGhlViewingAppointment,
    deleteGhlViewingAppointment,
} from './providers/ghl';
import {
    createGoogleCalendarEvent,
    updateGoogleCalendarEvent,
    deleteGoogleCalendarEvent,
    ViewingSyncOperationResult,
} from './providers/google-calendar';
import { TaskSyncEngineStats } from '@/lib/tasks/types';

export type ViewingOutboxOperation = 'create' | 'update' | 'delete';
export type ViewingProvider = 'ghl' | 'google';

const MAX_OUTBOX_ATTEMPTS = 6;
const STALE_PROCESSING_LOCK_MS = 5 * 60 * 1000;

type SyncViewingRecord = Prisma.ViewingGetPayload<{
    include: {
        contact: {
            select: {
                id: true;
                ghlContactId: true;
                name: true;
                firstName: true;
                lastName: true;
                location: {
                    select: { id: true; ghlAccessToken: true; ghlLocationId: true };
                };
            };
        };
        property: {
            select: { id: true; title: true };
        };
        user: {
            select: {
                id: true;
                ghlCalendarId: true;
                googleAccessToken: true;
                googleRefreshToken: true;
                googleCalendarId: true;
            };
        };
    };
}>;

type OutboxJobResult = 'success' | 'failed' | 'dead' | 'skipped';

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); } catch { return String(error); }
}

function computeBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    const seconds = Math.min(30 * 60, Math.pow(2, exponent) * 30);
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.round(seconds * 1000 * jitter);
}

function parseOutboxSyncVersion(idempotencyKey: string): number | null {
    const match = idempotencyKey.match(/:v(\d+)$/);
    if (!match?.[1]) return null;
    const version = Number(match[1]);
    return Number.isFinite(version) ? version : null;
}

function isSupersededOutboxJob(idempotencyKey: string, syncVersion: number): boolean {
    const outboxVersion = parseOutboxSyncVersion(idempotencyKey);
    if (!outboxVersion) return false;
    return outboxVersion < syncVersion;
}

function getErrorStatusCode(error: unknown): number | null {
    if (error instanceof GHLError) return error.status;
    const candidate = error as any;
    if (typeof candidate?.status === 'number') return candidate.status;
    if (typeof candidate?.response?.status === 'number') return candidate.response.status;
    return null;
}

function isGhlNotFoundError(error: unknown): boolean {
    return error instanceof GHLError && error.status === 404;
}

function isRetryableSyncError(provider: ViewingProvider, error: unknown): boolean {
    const status = getErrorStatusCode(error);
    if (status === null) return true;
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
    if (provider === 'ghl' && (status === 400 || status === 401 || status === 403 || status === 404 || status === 422)) return false;
    if (status >= 400 && status < 500) return false;
    return true;
}

function hasGoogleCredentials(user?: { googleAccessToken: string | null; googleRefreshToken: string | null } | null): boolean {
    if (!user) return false;
    return Boolean(user.googleAccessToken || user.googleRefreshToken);
}

function getAvailableProviders(viewing: SyncViewingRecord): ViewingProvider[] {
    const providers: ViewingProvider[] = [];
    if (viewing.contact.location.ghlAccessToken && viewing.contact.location.ghlLocationId && viewing.user.ghlCalendarId) {
        providers.push('ghl');
    }
    if (hasGoogleCredentials(viewing.user) && viewing.user.googleCalendarId) {
        providers.push('google');
    }
    return providers;
}

async function getViewingSyncRecord(viewingId: string, provider: ViewingProvider) {
    return db.viewingSync.findUnique({
        where: { viewingId_provider_providerAccountId: { viewingId, provider, providerAccountId: 'default' } },
    });
}

function toProviderViewingPayload(viewing: SyncViewingRecord) {
    const contactName = viewing.contact.name || [viewing.contact.firstName, viewing.contact.lastName].filter(Boolean).join(' ') || 'Unknown Contact';
    return {
        date: viewing.date,
        notes: viewing.notes,
        status: viewing.status,
        propertyTitle: viewing.property.title,
        contactName,
        userId: viewing.userId,
    };
}

async function syncViewingToGhl(job: ViewingOutbox, viewing: SyncViewingRecord): Promise<ViewingSyncOperationResult> {
    const accessToken = viewing.contact.location.ghlAccessToken;
    const ghlLocationId = viewing.contact.location.ghlLocationId;
    const ghlCalendarId = viewing.user.ghlCalendarId;

    if (!accessToken || !ghlLocationId || !ghlCalendarId) {
        throw new Error('GHL sync unavailable: location not connected or no calendar assigned');
    }

    let ghlContactId = viewing.contact.ghlContactId;
    if (!ghlContactId) {
        ghlContactId = await ensureRemoteContact(viewing.contact.id, ghlLocationId, accessToken);
    }

    if (!ghlContactId) {
        throw new Error('Cannot sync viewing to GHL: contact is not linked');
    }

    const syncRecord = await getViewingSyncRecord(viewing.id, 'ghl');
    const providerViewingId = syncRecord?.providerViewingId || null;
    const payload = toProviderViewingPayload(viewing);

    switch (job.operation as ViewingOutboxOperation) {
        case 'create': {
            if (providerViewingId) {
                try {
                    return await updateGhlViewingAppointment({ locationId: ghlLocationId, providerViewingId, ghlCalendarId, viewing: payload });
                } catch (error) {
                    if (isGhlNotFoundError(error)) {
                        return createGhlViewingAppointment({ locationId: ghlLocationId, ghlContactId, ghlCalendarId, viewing: payload });
                    }
                    throw error;
                }
            }
            return createGhlViewingAppointment({ locationId: ghlLocationId, ghlContactId, ghlCalendarId, viewing: payload });
        }

        case 'update': {
            if (!providerViewingId) {
                return createGhlViewingAppointment({ locationId: ghlLocationId, ghlContactId, ghlCalendarId, viewing: payload });
            }
            try {
                return await updateGhlViewingAppointment({ locationId: ghlLocationId, providerViewingId, ghlCalendarId, viewing: payload });
            } catch (error) {
                if (isGhlNotFoundError(error)) {
                    return createGhlViewingAppointment({ locationId: ghlLocationId, ghlContactId, ghlCalendarId, viewing: payload });
                }
                throw error;
            }
        }

        case 'delete': {
            if (providerViewingId) {
                try {
                    await deleteGhlViewingAppointment({ locationId: ghlLocationId, providerViewingId });
                } catch (error) {
                    if (!isGhlNotFoundError(error)) throw error;
                }
            }
            return { providerViewingId: null, remoteUpdatedAt: new Date(), etag: null };
        }

        default:
            throw new Error(`Unsupported outbox operation for GHL: ${job.operation}`);
    }
}

async function syncViewingToGoogle(job: ViewingOutbox, viewing: SyncViewingRecord): Promise<ViewingSyncOperationResult> {
    const googleUser = viewing.user;
    if (!hasGoogleCredentials(googleUser) || !googleUser.googleCalendarId) {
        throw new Error('Google sync unavailable: no connected user or calendar found for viewing');
    }

    const syncRecord = await getViewingSyncRecord(viewing.id, 'google');
    const providerViewingId = syncRecord?.providerViewingId || null;
    const providerContainerId = syncRecord?.providerContainerId || (googleUser as any).googleCalendarId;
    const payload = toProviderViewingPayload(viewing);

    switch (job.operation as ViewingOutboxOperation) {
        case 'create': {
            if (providerViewingId) {
                return updateGoogleCalendarEvent({ userId: googleUser.id, providerViewingId, calendarId: providerContainerId, viewing: payload });
            }
            return createGoogleCalendarEvent({ userId: googleUser.id, calendarId: providerContainerId, viewing: payload });
        }

        case 'update': {
            if (!providerViewingId) {
                return createGoogleCalendarEvent({ userId: googleUser.id, calendarId: providerContainerId, viewing: payload });
            }
            return updateGoogleCalendarEvent({ userId: googleUser.id, providerViewingId, calendarId: providerContainerId, viewing: payload });
        }

        case 'delete': {
            if (providerViewingId) {
                await deleteGoogleCalendarEvent({ userId: googleUser.id, providerViewingId, calendarId: providerContainerId });
            }
            return { providerViewingId: null, providerContainerId, remoteUpdatedAt: new Date(), etag: null };
        }

        default:
            throw new Error(`Unsupported outbox operation for Google: ${job.operation}`);
    }
}

async function processSingleOutboxJob(jobId: string, workerId: string): Promise<OutboxJobResult> {
    const now = new Date();
    const job = await db.viewingOutbox.findUnique({
        where: { id: jobId },
        include: {
            viewing: {
                include: {
                    contact: {
                        select: {
                            id: true,
                            ghlContactId: true,
                            name: true,
                            firstName: true,
                            lastName: true,
                            location: { select: { id: true, ghlAccessToken: true, ghlLocationId: true } },
                        },
                    },
                    property: { select: { id: true, title: true } },
                    user: { select: { id: true, ghlCalendarId: true, googleAccessToken: true, googleRefreshToken: true, googleCalendarId: true } },
                },
            },
        },
    });

    if (!job || !job.viewing) return 'skipped';

    if (isSupersededOutboxJob(job.idempotencyKey, (job.viewing as any).syncVersion || 1)) {
        await db.viewingOutbox.update({
            where: { id: job.id },
            data: { status: 'completed', processedAt: now, lockedAt: null, lockedBy: null, lastError: 'Skipped: superseded by newer version' },
        });
        return 'skipped';
    }

    let result: ViewingSyncOperationResult = { providerViewingId: null, remoteUpdatedAt: null, etag: null };

    try {
        if (job.provider === 'ghl') {
            result = await syncViewingToGhl(job, job.viewing as any);
        } else if (job.provider === 'google') {
            result = await syncViewingToGoogle(job, job.viewing as any);
        } else {
            throw new Error(`Unsupported provider: ${job.provider}`);
        }

        const isDelete = job.operation === 'delete';

        await db.viewingSync.upsert({
            where: { viewingId_provider_providerAccountId: { viewingId: job.viewingId, provider: job.provider, providerAccountId: 'default' } },
            create: {
                viewingId: job.viewingId,
                provider: job.provider,
                providerAccountId: 'default',
                providerContainerId: result.providerContainerId || null,
                providerViewingId: isDelete ? null : (result.providerViewingId || null),
                status: 'synced',
                remoteUpdatedAt: result.remoteUpdatedAt || null,
                etag: result.etag || null,
                lastSyncedAt: now,
                lastAttemptAt: now,
                attemptCount: 0,
                lastError: null,
            },
            update: {
                providerContainerId: result.providerContainerId || undefined,
                providerViewingId: isDelete ? null : (result.providerViewingId || undefined),
                status: 'synced',
                remoteUpdatedAt: result.remoteUpdatedAt || undefined,
                etag: result.etag || undefined,
                lastSyncedAt: now,
                lastAttemptAt: now,
                attemptCount: 0,
                lastError: null,
            },
        });

        await db.viewingOutbox.update({
            where: { id: job.id },
            data: { status: 'completed', processedAt: now, lockedAt: null, lockedBy: null, lastError: null },
        });

        return 'success';
    } catch (error) {
        const message = normalizeError(error);
        const attemptCount = job.attemptCount + 1;
        const retryable = isRetryableSyncError(job.provider as ViewingProvider, error);
        const isDead = !retryable || attemptCount >= MAX_OUTBOX_ATTEMPTS;
        const nextRunAt = new Date(Date.now() + computeBackoffMs(attemptCount));

        await db.viewingSync.upsert({
            where: { viewingId_provider_providerAccountId: { viewingId: job.viewingId, provider: job.provider, providerAccountId: 'default' } },
            create: { viewingId: job.viewingId, provider: job.provider, providerAccountId: 'default', status: 'error', lastAttemptAt: now, attemptCount, lastError: message },
            update: { status: 'error', lastAttemptAt: now, attemptCount, lastError: message },
        });

        await db.viewingOutbox.update({
            where: { id: job.id },
            data: { status: isDead ? 'dead' : 'failed', attemptCount, lastError: message, scheduledAt: isDead ? now : nextRunAt, lockedAt: null, lockedBy: null, processedAt: isDead ? now : null },
        });

        return isDead ? 'dead' : 'failed';
    }
}

export async function enqueueViewingSyncJobs(options: {
    viewingId: string;
    operation: ViewingOutboxOperation;
    providers?: ViewingProvider[];
    scheduledAt?: Date;
}) {
    const viewing = await db.viewing.findUnique({
        where: { id: options.viewingId },
        include: {
            contact: {
                select: {
                    id: true,
                    ghlContactId: true,
                    name: true,
                    firstName: true,
                    lastName: true,
                    locationId: true,
                    location: { select: { id: true, ghlAccessToken: true, ghlLocationId: true } },
                },
            },
            property: { select: { id: true, title: true } },
            user: { select: { id: true, ghlCalendarId: true, googleAccessToken: true, googleRefreshToken: true, googleCalendarId: true } },
        },
    });

    if (!viewing) return { queued: 0, skippedProviders: options.providers || [] };

    const availableProviders = getAvailableProviders(viewing as any);
    const targetProviders = options.providers?.length
        ? options.providers.filter((provider) => availableProviders.includes(provider))
        : availableProviders;

    const skippedProviders = options.providers?.filter((provider) => !targetProviders.includes(provider)) || [];

    let queued = 0;
    const scheduledAt = options.scheduledAt || new Date();

    for (const provider of targetProviders) {
        const idempotencyKey = `${viewing.id}:${provider}:${options.operation}:v${(viewing as any).syncVersion || 1}`;

        try {
            await db.viewingOutbox.create({
                data: {
                    viewingId: viewing.id,
                    locationId: (viewing as any).contact.locationId || '',
                    provider,
                    operation: options.operation,
                    status: 'pending',
                    scheduledAt,
                    idempotencyKey,
                },
            });
            queued += 1;

            await db.viewingSync.upsert({
                where: { viewingId_provider_providerAccountId: { viewingId: viewing.id, provider, providerAccountId: 'default' } },
                create: { viewingId: viewing.id, provider, providerAccountId: 'default', status: 'pending', attemptCount: 0, lastError: null },
                update: { status: 'pending', lastError: null },
            });
        } catch (error: any) {
            if (error?.code !== 'P2002') throw error;

            const existingOutbox = await db.viewingOutbox.findUnique({
                where: { idempotencyKey },
                select: { status: true },
            });

            if (existingOutbox && (existingOutbox.status === 'pending' || existingOutbox.status === 'failed' || existingOutbox.status === 'processing')) {
                await db.viewingSync.upsert({
                    where: { viewingId_provider_providerAccountId: { viewingId: viewing.id, provider, providerAccountId: 'default' } },
                    create: { viewingId: viewing.id, provider, providerAccountId: 'default', status: 'pending', attemptCount: 0, lastError: null },
                    update: { status: 'pending', lastError: null },
                });
            }
        }
    }

    return { queued, skippedProviders };
}

export async function processViewingSyncOutboxBatch(options?: {
    batchSize?: number;
    workerId?: string;
}): Promise<TaskSyncEngineStats> {
    const batchSize = Math.max(1, Math.min(options?.batchSize || 20, 100));
    const workerId = options?.workerId || `viewing-sync-${randomUUID()}`;
    const now = new Date();

    const stats: TaskSyncEngineStats = { scanned: 0, claimed: 0, succeeded: 0, failed: 0, dead: 0, skipped: 0 };
    const staleLockCutoff = new Date(now.getTime() - STALE_PROCESSING_LOCK_MS);

    await db.viewingOutbox.updateMany({
        where: { status: 'processing', lockedAt: { lte: staleLockCutoff } },
        data: { status: 'failed', lockedAt: null, lockedBy: null, scheduledAt: now, lastError: 'Recovered stale processing lock; re-queued' },
    });

    const candidates = await db.viewingOutbox.findMany({
        where: { status: { in: ['pending', 'failed'] }, scheduledAt: { lte: now } },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
        take: batchSize,
    });

    stats.scanned = candidates.length;

    for (const candidate of candidates) {
        try {
            const lockResult = await db.viewingOutbox.updateMany({
                where: { id: candidate.id, status: candidate.status },
                data: { status: 'processing', lockedAt: now, lockedBy: workerId },
            });

            if (lockResult.count === 0) continue;
            stats.claimed += 1;

            const result = await processSingleOutboxJob(candidate.id, workerId);
            if (result === 'success') stats.succeeded += 1;
            else if (result === 'failed') stats.failed += 1;
            else if (result === 'dead') stats.dead += 1;
            else if (result === 'skipped') stats.skipped += 1;
        } catch (e) {
            console.error(`Error processing viewing outbox job ${candidate.id}:`, e);
            stats.failed += 1;
        }
    }

    return stats;
}
