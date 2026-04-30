import { randomUUID } from 'crypto';
import { ContactOutbox, Prisma } from '@prisma/client';
import db from '@/lib/db';
import { GHLError } from '@/lib/ghl/client';
import { syncContactToGHL, deleteContactFromGHL } from '@/lib/ghl/stakeholders';
import { runGoogleAutoSyncForContact } from '@/lib/google/automation';

const MAX_OUTBOX_ATTEMPTS = 6;
const STALE_PROCESSING_LOCK_MS = 5 * 60 * 1000;

export type ContactOutboxOperation = 'create' | 'update' | 'delete';
export type ContactProvider = 'ghl' | 'google';

export interface ContactSyncEngineStats {
  scanned: number;
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  skipped: number;
}

type OutboxJobResult = 'success' | 'failed' | 'dead' | 'skipped';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function computeBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const seconds = Math.min(30 * 60, Math.pow(2, exponent) * 30);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(seconds * 1000 * jitter);
}

function getErrorStatusCode(error: unknown): number | null {
  if (error instanceof GHLError) {
    return error.status;
  }
  const candidate = error as any;
  if (typeof candidate?.status === 'number') return candidate.status;
  if (typeof candidate?.response?.status === 'number') return candidate.response.status;
  return null;
}

function isRetryableSyncError(provider: ContactProvider, error: unknown): boolean {
  const status = getErrorStatusCode(error);
  if (status === null) return true;

  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return true;
  }
  if (provider === 'ghl' && (status === 400 || status === 401 || status === 403 || status === 404 || status === 422)) {
    return false; // usually bad request / unrecoverable unless auth token refreshed automatically
  }
  if (status >= 400 && status < 500) {
    return false;
  }
  return true;
}

export async function enqueueContactSync(
  tx: Prisma.TransactionClient,
  options: {
    contactId: string;
    locationId: string;
    operation: ContactOutboxOperation;
    providers?: ContactProvider[];
    payload?: any;
    preferredUserId?: string | null;
  }
) {
  const providers = options.providers || ['ghl', 'google'];
  let queued = 0;

  for (const provider of providers) {
    // Note: since contact sync doesn't have an explicit syncVersion, we rely on the DB row lock and latest payload.
    // For updates, we use a single idempotency key per provider/operation, effectively debouncing them.
    const idempotencyKey = `${options.contactId}:${provider}:${options.operation}`;

    try {
      await tx.contactOutbox.upsert({
        where: { idempotencyKey },
        create: {
          contactId: options.contactId,
          locationId: options.locationId,
          provider,
          operation: options.operation,
          payload: options.payload || {},
          status: 'pending',
          scheduledAt: new Date(),
          idempotencyKey,
        },
        update: {
          // If already pending or failed, just update payload and schedule for now
          payload: options.payload || {},
          status: 'pending',
          scheduledAt: new Date(),
          lastError: null,
          attemptCount: 0,
          lockedAt: null,
          lockedBy: null,
        },
      });
      queued++;

      await tx.contactSync.upsert({
        where: {
          contactId_provider_providerAccountId: {
            contactId: options.contactId,
            provider,
            providerAccountId: 'default',
          },
        },
        create: {
          contactId: options.contactId,
          provider,
          providerAccountId: 'default',
          status: 'pending',
        },
        update: {
          status: 'pending',
        },
      });
    } catch (e) {
      console.error(`Failed to enqueue contact sync for ${provider}`, e);
    }
  }

  return { queued };
}

async function processSingleOutboxJob(jobId: string, workerId: string): Promise<OutboxJobResult> {
  const now = new Date();
  const job = await db.contactOutbox.findUnique({
    where: { id: jobId },
    include: {
      contact: true,
      location: {
        select: {
          id: true,
          ghlAccessToken: true,
          ghlLocationId: true,
        },
      },
    },
  });

  if (!job || !job.contact) {
    return 'skipped';
  }

  try {
    let remoteId: string | null = null;

    if (job.provider === 'ghl') {
      const { ghlAccessToken, ghlLocationId } = job.location;
      if (!ghlAccessToken || !ghlLocationId) {
        throw new Error('GHL sync unavailable: location not connected');
      }

      if (job.operation === 'delete') {
        if (job.contact.ghlContactId) {
          await deleteContactFromGHL(ghlLocationId, job.contact.ghlContactId);
        }
      } else {
        const payloadData = job.payload as any;
        const ghlId = await syncContactToGHL(
          ghlLocationId,
          {
            name: job.contact.name || undefined,
            firstName: job.contact.firstName || undefined,
            lastName: job.contact.lastName || undefined,
            email: job.contact.email || undefined,
            phone: job.contact.phone || undefined,
            ...payloadData
          },
          job.contact.ghlContactId
        );
        if (ghlId) {
          remoteId = ghlId;
          if (ghlId !== job.contact.ghlContactId) {
            await db.contact.update({
              where: { id: job.contact.id },
              data: { ghlContactId: ghlId },
            });
          }
        }
      }
    } else if (job.provider === 'google') {
      // Google Sync runs through its automation wrapper which resolves users & handles its own settings
      const payloadData = job.payload as any;
      const res = await runGoogleAutoSyncForContact({
        locationId: job.locationId,
        contactId: job.contactId,
        source: 'CONTACT_FORM',
        event: job.operation === 'create' ? 'create' : 'update',
        preferredUserId: payloadData?.preferredUserId || null,
      });

      if (res.status === 'failed') {
        throw new Error(res.reason || 'Google sync failed inside automation wrapper');
      }
    }

    await db.contactSync.upsert({
      where: {
        contactId_provider_providerAccountId: {
          contactId: job.contactId,
          provider: job.provider,
          providerAccountId: 'default',
        },
      },
      create: {
        contactId: job.contactId,
        provider: job.provider,
        providerAccountId: 'default',
        providerContactId: remoteId,
        status: 'synced',
        lastSyncedAt: now,
        lastAttemptAt: now,
        attemptCount: 0,
        lastError: null,
      },
      update: {
        providerContactId: remoteId || undefined,
        status: 'synced',
        lastSyncedAt: now,
        lastAttemptAt: now,
        attemptCount: 0,
        lastError: null,
      },
    });

    await db.contactOutbox.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        processedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });

    return 'success';
  } catch (error) {
    const message = normalizeError(error);
    const attemptCount = job.attemptCount + 1;
    const retryable = isRetryableSyncError(job.provider as ContactProvider, error);
    const isDead = !retryable || attemptCount >= MAX_OUTBOX_ATTEMPTS;
    const nextRunAt = new Date(Date.now() + computeBackoffMs(attemptCount));

    await db.contactSync.upsert({
      where: {
        contactId_provider_providerAccountId: {
          contactId: job.contactId,
          provider: job.provider,
          providerAccountId: 'default',
        },
      },
      create: {
        contactId: job.contactId,
        provider: job.provider,
        providerAccountId: 'default',
        status: 'error',
        lastAttemptAt: now,
        attemptCount,
        lastError: message,
      },
      update: {
        status: 'error',
        lastAttemptAt: now,
        attemptCount,
        lastError: message,
      },
    });

    await db.contactOutbox.update({
      where: { id: job.id },
      data: {
        status: isDead ? 'dead' : 'failed',
        attemptCount,
        lastError: message,
        scheduledAt: isDead ? now : nextRunAt,
        lockedAt: null,
        lockedBy: null,
        processedAt: isDead ? now : null,
      },
    });

    return isDead ? 'dead' : 'failed';
  }
}

export async function processContactSyncOutboxBatch(options?: {
  batchSize?: number;
  workerId?: string;
}): Promise<ContactSyncEngineStats> {
  const batchSize = Math.max(1, Math.min(options?.batchSize || 20, 100));
  const workerId = options?.workerId || `contact-sync-${randomUUID()}`;
  const now = new Date();

  const stats: ContactSyncEngineStats = {
    scanned: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    skipped: 0,
  };

  const staleLockCutoff = new Date(now.getTime() - STALE_PROCESSING_LOCK_MS);
  await db.contactOutbox.updateMany({
    where: {
      status: 'processing',
      lockedAt: { lte: staleLockCutoff },
    },
    data: {
      status: 'failed',
      lockedAt: null,
      lockedBy: null,
      scheduledAt: now,
      lastError: 'Recovered stale processing lock; re-queued',
    },
  });

  const candidates = await db.contactOutbox.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      scheduledAt: { lte: now },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
  });

  stats.scanned = candidates.length;

  for (const candidate of candidates) {
    try {
      const lockResult = await db.contactOutbox.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status, 
          lockedAt: null,
        },
        data: {
          status: 'processing',
          lockedAt: now,
          lockedBy: workerId,
        },
      });

      if (lockResult.count === 0) continue;
      stats.claimed++;

      const res = await processSingleOutboxJob(candidate.id, workerId);
      if (res === 'success') stats.succeeded++;
      if (res === 'failed') stats.failed++;
      if (res === 'dead') stats.dead++;
      if (res === 'skipped') stats.skipped++;

    } catch (e) {
      console.error(`Failed to process contact outbox job ${candidate.id}`, e);
      stats.failed++;
    }
  }

  return stats;
}
