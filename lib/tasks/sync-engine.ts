import { randomUUID } from 'crypto';
import { ContactTaskOutbox, Prisma } from '@prisma/client';
import db from '@/lib/db';
import { ensureRemoteContact } from '@/lib/crm/contact-sync';
import { GHLError } from '@/lib/ghl/client';
import {
  createGhlTaskForContact,
  deleteGhlTaskForContact,
  setGhlTaskCompletionForContact,
  updateGhlTaskForContact,
} from '@/lib/tasks/providers/ghl';
import {
  DEFAULT_GOOGLE_TASKLIST_ID,
  createGoogleTask,
  deleteGoogleTask,
  setGoogleTaskCompletion,
  updateGoogleTask,
} from '@/lib/tasks/providers/google';
import {
  TaskOutboxOperation,
  TaskProvider,
  TaskSyncEngineStats,
  TaskSyncOperationResult,
} from '@/lib/tasks/types';

const MAX_OUTBOX_ATTEMPTS = 6;
const STALE_PROCESSING_LOCK_MS = 5 * 60 * 1000;

type SyncTaskRecord = Prisma.ContactTaskGetPayload<{
  include: {
    location: {
      select: {
        id: true;
        ghlAccessToken: true;
        ghlLocationId: true;
      };
    };
    contact: {
      select: {
        id: true;
        ghlContactId: true;
      };
    };
    assignedUser: {
      select: {
        id: true;
        googleAccessToken: true;
        googleRefreshToken: true;
        googleTasklistId: true;
      };
    };
    createdByUser: {
      select: {
        id: true;
        googleAccessToken: true;
        googleRefreshToken: true;
        googleTasklistId: true;
      };
    };
    updatedByUser: {
      select: {
        id: true;
        googleAccessToken: true;
        googleRefreshToken: true;
        googleTasklistId: true;
      };
    };
  };
}>;

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

function parseOutboxSyncVersion(idempotencyKey: string): number | null {
  const match = idempotencyKey.match(/:v(\d+)$/);
  if (!match?.[1]) return null;
  const version = Number(match[1]);
  return Number.isFinite(version) ? version : null;
}

function isSupersededOutboxJob(idempotencyKey: string, taskSyncVersion: number): boolean {
  const outboxVersion = parseOutboxSyncVersion(idempotencyKey);
  if (!outboxVersion) return false;
  return outboxVersion < taskSyncVersion;
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

function isGhlNotFoundError(error: unknown): boolean {
  return error instanceof GHLError && error.status === 404;
}

function isRetryableSyncError(provider: TaskProvider, error: unknown): boolean {
  const status = getErrorStatusCode(error);
  if (status === null) return true;

  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return true;
  }

  if (provider === 'ghl' && (status === 400 || status === 401 || status === 403 || status === 404 || status === 422)) {
    return false;
  }

  if (status >= 400 && status < 500) {
    return false;
  }

  return true;
}

function hasGoogleCredentials(user?: {
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
} | null): boolean {
  if (!user) return false;
  return Boolean(user.googleAccessToken || user.googleRefreshToken);
}

function selectGoogleSyncUser(task: SyncTaskRecord) {
  const orderedUsers = [task.assignedUser, task.createdByUser, task.updatedByUser];
  return orderedUsers.find((user) => hasGoogleCredentials(user)) || null;
}

function getAvailableProviders(task: SyncTaskRecord): TaskProvider[] {
  const providers: TaskProvider[] = [];

  if (task.location.ghlAccessToken && task.location.ghlLocationId) {
    providers.push('ghl');
  }

  if (selectGoogleSyncUser(task)) {
    providers.push('google');
  }

  return providers;
}

async function getTaskSyncRecord(taskId: string, provider: TaskProvider) {
  return db.contactTaskSync.findUnique({
    where: {
      taskId_provider_providerAccountId: {
        taskId,
        provider,
        providerAccountId: 'default',
      },
    },
  });
}

function toProviderTaskPayload(task: SyncTaskRecord) {
  return {
    title: task.title,
    description: task.description,
    dueAt: task.dueAt,
    assignedUserId: task.assignedUserId,
    status: task.status,
    completedAt: task.completedAt,
  };
}

async function syncTaskToGhl(
  job: ContactTaskOutbox,
  task: SyncTaskRecord,
): Promise<TaskSyncOperationResult> {
  const accessToken = task.location.ghlAccessToken;
  const ghlLocationId = task.location.ghlLocationId;

  if (!accessToken || !ghlLocationId) {
    throw new Error('GHL sync unavailable: location not connected');
  }

  let ghlContactId = task.contact.ghlContactId;
  if (!ghlContactId) {
    ghlContactId = await ensureRemoteContact(task.contact.id, ghlLocationId, accessToken);
  }

  if (!ghlContactId) {
    throw new Error('Cannot sync task to GHL: contact is not linked');
  }

  const syncRecord = await getTaskSyncRecord(task.id, 'ghl');
  const providerTaskId = syncRecord?.providerTaskId || null;
  const payload = toProviderTaskPayload(task);

  const createAndApplyCompletion = async (completed: boolean): Promise<TaskSyncOperationResult> => {
    const created = await createGhlTaskForContact({
      accessToken,
      ghlContactId,
      task: payload,
    });

    if (!created.providerTaskId) {
      throw new Error('GHL task create did not return a provider task id');
    }

    const completion = await setGhlTaskCompletionForContact({
      accessToken,
      ghlContactId,
      providerTaskId: created.providerTaskId,
      completed,
    });

    return {
      ...completion,
      providerTaskId: completion.providerTaskId || created.providerTaskId,
    };
  };

  switch (job.operation as TaskOutboxOperation) {
    case 'create': {
      if (providerTaskId) {
        try {
          return await updateGhlTaskForContact({
            accessToken,
            ghlContactId,
            providerTaskId,
            task: payload,
          });
        } catch (error) {
          if (isGhlNotFoundError(error)) {
            return createGhlTaskForContact({
              accessToken,
              ghlContactId,
              task: payload,
            });
          }
          throw error;
        }
      }
      return createGhlTaskForContact({
        accessToken,
        ghlContactId,
        task: payload,
      });
    }

    case 'update': {
      if (!providerTaskId) {
        return createGhlTaskForContact({
          accessToken,
          ghlContactId,
          task: payload,
        });
      }
      try {
        return await updateGhlTaskForContact({
          accessToken,
          ghlContactId,
          providerTaskId,
          task: payload,
        });
      } catch (error) {
        if (isGhlNotFoundError(error)) {
          return createGhlTaskForContact({
            accessToken,
            ghlContactId,
            task: payload,
          });
        }
        throw error;
      }
    }

    case 'complete':
    case 'uncomplete': {
      const completed = job.operation === 'complete';
      if (!providerTaskId) {
        return createAndApplyCompletion(completed);
      }

      try {
        return await setGhlTaskCompletionForContact({
          accessToken,
          ghlContactId,
          providerTaskId,
          completed,
        });
      } catch (error) {
        if (isGhlNotFoundError(error)) {
          return createAndApplyCompletion(completed);
        }
        throw error;
      }
    }

    case 'delete': {
      if (providerTaskId) {
        try {
          await deleteGhlTaskForContact({
            accessToken,
            ghlContactId,
            providerTaskId,
          });
        } catch (error) {
          if (!isGhlNotFoundError(error)) {
            throw error;
          }
        }
      }
      return {
        providerTaskId: null,
        remoteUpdatedAt: new Date(),
      };
    }

    default:
      throw new Error(`Unsupported outbox operation for GHL: ${job.operation}`);
  }
}

async function syncTaskToGoogle(
  job: ContactTaskOutbox,
  task: SyncTaskRecord,
): Promise<TaskSyncOperationResult> {
  const googleUser = selectGoogleSyncUser(task);
  if (!googleUser) {
    throw new Error('Google sync unavailable: no connected user found for task');
  }

  const syncRecord = await getTaskSyncRecord(task.id, 'google');
  const providerTaskId = syncRecord?.providerTaskId || null;
  const providerContainerId = syncRecord?.providerContainerId || googleUser.googleTasklistId || DEFAULT_GOOGLE_TASKLIST_ID;
  const payload = toProviderTaskPayload(task);

  switch (job.operation as TaskOutboxOperation) {
    case 'create': {
      if (providerTaskId) {
        return updateGoogleTask({
          userId: googleUser.id,
          providerTaskId,
          tasklistId: providerContainerId,
          task: payload,
        });
      }
      return createGoogleTask({
        userId: googleUser.id,
        task: payload,
        tasklistId: providerContainerId,
      });
    }

    case 'update': {
      if (!providerTaskId) {
        return createGoogleTask({
          userId: googleUser.id,
          task: payload,
          tasklistId: providerContainerId,
        });
      }
      return updateGoogleTask({
        userId: googleUser.id,
        providerTaskId,
        tasklistId: providerContainerId,
        task: payload,
      });
    }

    case 'complete':
    case 'uncomplete': {
      const completed = job.operation === 'complete';
      if (!providerTaskId) {
        const created = await createGoogleTask({
          userId: googleUser.id,
          task: payload,
          tasklistId: providerContainerId,
        });
        if (!created.providerTaskId) {
          throw new Error('Google task create did not return a provider task id');
        }
        const completion = await setGoogleTaskCompletion({
          userId: googleUser.id,
          providerTaskId: created.providerTaskId,
          tasklistId: created.providerContainerId || providerContainerId,
          completed,
        });
        return {
          ...completion,
          providerTaskId: completion.providerTaskId || created.providerTaskId,
        };
      }

      return setGoogleTaskCompletion({
        userId: googleUser.id,
        providerTaskId,
        tasklistId: providerContainerId,
        completed,
      });
    }

    case 'delete': {
      if (providerTaskId) {
        await deleteGoogleTask({
          userId: googleUser.id,
          providerTaskId,
          tasklistId: providerContainerId,
        });
      }
      return {
        providerTaskId: null,
        providerContainerId,
        remoteUpdatedAt: new Date(),
      };
    }

    default:
      throw new Error(`Unsupported outbox operation for Google: ${job.operation}`);
  }
}

async function processSingleOutboxJob(jobId: string, workerId: string): Promise<OutboxJobResult> {
  const now = new Date();
  const job = await db.contactTaskOutbox.findUnique({
    where: { id: jobId },
    include: {
      task: {
        include: {
          location: {
            select: {
              id: true,
              ghlAccessToken: true,
              ghlLocationId: true,
            },
          },
          contact: {
            select: {
              id: true,
              ghlContactId: true,
            },
          },
          assignedUser: {
            select: {
              id: true,
              googleAccessToken: true,
              googleRefreshToken: true,
              googleTasklistId: true,
            },
          },
          createdByUser: {
            select: {
              id: true,
              googleAccessToken: true,
              googleRefreshToken: true,
              googleTasklistId: true,
            },
          },
          updatedByUser: {
            select: {
              id: true,
              googleAccessToken: true,
              googleRefreshToken: true,
              googleTasklistId: true,
            },
          },
        },
      },
    },
  });

  if (!job || !job.task) {
    return 'skipped';
  }

  if (isSupersededOutboxJob(job.idempotencyKey, job.task.syncVersion)) {
    await db.contactTaskOutbox.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        processedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: 'Skipped: superseded by newer task version',
      },
    });
    return 'skipped';
  }

  let result: TaskSyncOperationResult = {};

  try {
    if (job.provider === 'ghl') {
      result = await syncTaskToGhl(job, job.task);
    } else if (job.provider === 'google') {
      result = await syncTaskToGoogle(job, job.task);
    } else {
      throw new Error(`Unsupported provider: ${job.provider}`);
    }

    const isDelete = job.operation === 'delete';

    await db.contactTaskSync.upsert({
      where: {
        taskId_provider_providerAccountId: {
          taskId: job.taskId,
          provider: job.provider,
          providerAccountId: 'default',
        },
      },
      create: {
        taskId: job.taskId,
        provider: job.provider,
        providerAccountId: 'default',
        providerContainerId: result.providerContainerId || null,
        providerTaskId: isDelete ? null : result.providerTaskId || null,
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
        providerTaskId: isDelete ? null : (result.providerTaskId || undefined),
        status: 'synced',
        remoteUpdatedAt: result.remoteUpdatedAt || undefined,
        etag: result.etag || undefined,
        lastSyncedAt: now,
        lastAttemptAt: now,
        attemptCount: 0,
        lastError: null,
      },
    });

    await db.contactTaskOutbox.update({
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
    const retryable = isRetryableSyncError(job.provider as TaskProvider, error);
    const isDead = !retryable || attemptCount >= MAX_OUTBOX_ATTEMPTS;
    const nextRunAt = new Date(Date.now() + computeBackoffMs(attemptCount));

    await db.contactTaskSync.upsert({
      where: {
        taskId_provider_providerAccountId: {
          taskId: job.taskId,
          provider: job.provider,
          providerAccountId: 'default',
        },
      },
      create: {
        taskId: job.taskId,
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

    await db.contactTaskOutbox.update({
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

export async function enqueueTaskSyncJobs(options: {
  taskId: string;
  operation: TaskOutboxOperation;
  providers?: TaskProvider[];
  scheduledAt?: Date;
}) {
  const task = await db.contactTask.findUnique({
    where: { id: options.taskId },
    include: {
      location: {
        select: {
          id: true,
          ghlAccessToken: true,
          ghlLocationId: true,
        },
      },
      contact: {
        select: {
          id: true,
          ghlContactId: true,
        },
      },
      assignedUser: {
        select: {
          id: true,
          googleAccessToken: true,
          googleRefreshToken: true,
          googleTasklistId: true,
        },
      },
      createdByUser: {
        select: {
          id: true,
          googleAccessToken: true,
          googleRefreshToken: true,
          googleTasklistId: true,
        },
      },
      updatedByUser: {
        select: {
          id: true,
          googleAccessToken: true,
          googleRefreshToken: true,
          googleTasklistId: true,
        },
      },
    },
  });

  if (!task) {
    return { queued: 0, skippedProviders: options.providers || [] };
  }

  const availableProviders = getAvailableProviders(task);
  const targetProviders = options.providers?.length
    ? options.providers.filter((provider) => availableProviders.includes(provider))
    : availableProviders;

  const skippedProviders = options.providers?.filter((provider) => !targetProviders.includes(provider)) || [];

  let queued = 0;
  const scheduledAt = options.scheduledAt || new Date();

  for (const provider of targetProviders) {
    const idempotencyKey = `${task.id}:${provider}:${options.operation}:v${task.syncVersion}`;

    try {
      await db.contactTaskOutbox.create({
        data: {
          taskId: task.id,
          locationId: task.locationId,
          provider,
          operation: options.operation,
          status: 'pending',
          scheduledAt,
          idempotencyKey,
        },
      });
      queued += 1;

      await db.contactTaskSync.upsert({
        where: {
          taskId_provider_providerAccountId: {
            taskId: task.id,
            provider,
            providerAccountId: 'default',
          },
        },
        create: {
          taskId: task.id,
          provider,
          providerAccountId: 'default',
          status: 'pending',
          attemptCount: 0,
          lastError: null,
        },
        update: {
          status: 'pending',
          lastError: null,
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') {
        throw error;
      }
      const existingOutbox = await db.contactTaskOutbox.findUnique({
        where: {
          idempotencyKey,
        },
        select: {
          status: true,
        },
      });

      if (existingOutbox && (existingOutbox.status === 'pending' || existingOutbox.status === 'failed' || existingOutbox.status === 'processing')) {
        await db.contactTaskSync.upsert({
          where: {
            taskId_provider_providerAccountId: {
              taskId: task.id,
              provider,
              providerAccountId: 'default',
            },
          },
          create: {
            taskId: task.id,
            provider,
            providerAccountId: 'default',
            status: 'pending',
            attemptCount: 0,
            lastError: null,
          },
          update: {
            status: 'pending',
            lastError: null,
          },
        });
      }
      // Duplicate outbox entry for same version is intentional idempotency.
    }
  }

  return { queued, skippedProviders };
}

export async function processTaskSyncOutboxBatch(options?: {
  batchSize?: number;
  workerId?: string;
}): Promise<TaskSyncEngineStats> {
  const batchSize = Math.max(1, Math.min(options?.batchSize || 20, 100));
  const workerId = options?.workerId || `task-sync-${randomUUID()}`;
  const now = new Date();

  const stats: TaskSyncEngineStats = {
    scanned: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    skipped: 0,
  };

  const staleLockCutoff = new Date(now.getTime() - STALE_PROCESSING_LOCK_MS);
  await db.contactTaskOutbox.updateMany({
    where: {
      status: 'processing',
      lockedAt: {
        lte: staleLockCutoff,
      },
    },
    data: {
      status: 'failed',
      lockedAt: null,
      lockedBy: null,
      scheduledAt: now,
      lastError: 'Recovered stale processing lock; re-queued',
    },
  });

  const candidates = await db.contactTaskOutbox.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      scheduledAt: { lte: now },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
  });

  stats.scanned = candidates.length;

  for (const candidate of candidates) {
    const claim = await db.contactTaskOutbox.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['pending', 'failed'] },
      },
      data: {
        status: 'processing',
        lockedAt: now,
        lockedBy: workerId,
      },
    });

    if (claim.count === 0) {
      stats.skipped += 1;
      continue;
    }

    stats.claimed += 1;
    const result = await processSingleOutboxJob(candidate.id, workerId);

    if (result === 'success') stats.succeeded += 1;
    if (result === 'failed') stats.failed += 1;
    if (result === 'dead') stats.dead += 1;
    if (result === 'skipped') stats.skipped += 1;
  }

  return stats;
}
