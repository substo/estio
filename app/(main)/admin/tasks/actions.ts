'use server';

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { getLocationContext } from '@/lib/auth/location-context';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';
import { isLocalDateTimeWithoutZone } from '@/lib/tasks/datetime-local';
import { normalizeReminderOffsets } from '@/lib/tasks/reminder-config';
import { rebuildTaskReminderJobs } from '@/lib/tasks/reminders';
import { enqueueTaskSyncJobs } from '@/lib/tasks/sync-engine';
import { parseViewingDateTimeInput } from '@/lib/viewings/datetime';

const statusFilterSchema = z.enum(['open', 'completed', 'all']).default('all');
const reminderModeSchema = z.enum(['default', 'custom', 'off']).default('default');
const reminderOffsetsSchema = z.array(z.number().int().min(0).max(7 * 24 * 60)).max(10).optional();

const createTaskSchema = z.object({
  contactId: z.string().optional(),
  conversationId: z.string().optional(),
  title: z.string().trim().min(1, 'Task title is required').max(200, 'Task title is too long'),
  description: z.string().trim().max(8000, 'Description is too long').optional(),
  dueAt: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  assignedUserId: z.string().optional(),
  reminderMode: reminderModeSchema,
  reminderOffsets: reminderOffsetsSchema,
  source: z.enum(['manual', 'ai_selection', 'automation']).default('manual'),
}).refine((value) => Boolean(value.contactId || value.conversationId), {
  message: 'contactId or conversationId is required',
});

const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(8000).optional(),
  dueAt: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  assignedUserId: z.string().optional().nullable(),
  reminderMode: reminderModeSchema.optional(),
  reminderOffsets: reminderOffsetsSchema.nullable().optional(),
});

async function getCurrentUserRecord(clerkUserId: string) {
  return db.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true, timeZone: true },
  });
}

async function getAuthContext() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) throw new Error('Unauthorized');

  const location = await getLocationContext();
  if (!location?.id) throw new Error('No location context');

  const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, location.id);
  if (!hasAccess) throw new Error('Unauthorized');

  const user = await getCurrentUserRecord(clerkUserId);

  if (!user?.id) throw new Error('User not found');

  return {
    location,
    userId: user.id,
    currentUserTimeZone: user.timeZone || location.timeZone || 'UTC',
  };
}

async function resolveContact(locationId: string, contactIdOrGhlId: string) {
  return db.contact.findFirst({
    where: {
      locationId,
      OR: [{ id: contactIdOrGhlId }, { ghlContactId: contactIdOrGhlId }],
    },
    select: { id: true },
  });
}

async function resolveConversationId(locationId: string, conversationId?: string | null) {
  if (!conversationId) return null;

  const conversation = await db.conversation.findFirst({
    where: {
      locationId,
      OR: [{ id: conversationId }, { ghlConversationId: conversationId }],
    },
    select: { id: true },
  });

  return conversation?.id || null;
}

function parseDueAt(input?: string | null, timeZone?: string | null): Date | null {
  if (!input) return null;
  if (timeZone && isLocalDateTimeWithoutZone(input)) {
    try {
      return parseViewingDateTimeInput({
        scheduledAtIso: input,
        scheduledTimeZone: timeZone,
      }).utcDate;
    } catch {
      return null;
    }
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function listContactTasks(contactId: string, statusFilter?: 'open' | 'completed' | 'all') {
  const { location } = await getAuthContext();
  const resolvedContact = await resolveContact(location.id, String(contactId || '').trim());
  if (!resolvedContact) {
    return {
      success: false,
      error: 'Contact not found',
      tasks: [],
      counts: { all: 0, open: 0, completed: 0 },
    };
  }

  const filter = statusFilterSchema.parse(statusFilter || 'all');

  const baseWhere = {
    locationId: location.id,
    contactId: resolvedContact.id,
    deletedAt: null,
  } as const;

  const [allCount, openCount, completedCount, tasks] = await Promise.all([
    db.contactTask.count({ where: baseWhere }),
    db.contactTask.count({
      where: {
        ...baseWhere,
        status: { not: 'completed' },
      },
    }),
    db.contactTask.count({
      where: {
        ...baseWhere,
        status: 'completed',
      },
    }),
    db.contactTask.findMany({
      where: {
        ...baseWhere,
        ...(filter === 'open' ? { status: { not: 'completed' } } : {}),
        ...(filter === 'completed' ? { status: 'completed' } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { dueAt: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        syncRecords: {
          select: {
            provider: true,
            status: true,
            lastSyncedAt: true,
            lastError: true,
          },
        },
        outboxJobs: {
          where: {
            status: {
              in: ['pending', 'processing', 'failed', 'dead'],
            },
          },
          orderBy: [
            { status: 'asc' },
            { scheduledAt: 'asc' },
            { createdAt: 'desc' },
          ],
          select: {
            provider: true,
            status: true,
            operation: true,
            attemptCount: true,
            scheduledAt: true,
            lastError: true,
            createdAt: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    success: true,
    tasks,
    counts: {
      all: allCount,
      open: openCount,
      completed: completedCount,
    },
  };
}

export async function listLocationTasks(statusFilter?: 'open' | 'completed' | 'all') {
  const { location } = await getAuthContext();
  const filter = statusFilterSchema.parse(statusFilter || 'all');

  const baseWhere = {
    locationId: location.id,
    deletedAt: null,
  } as const;

  const [allCount, openCount, completedCount, tasks] = await Promise.all([
    db.contactTask.count({ where: baseWhere }),
    db.contactTask.count({
      where: {
        ...baseWhere,
        status: { not: 'completed' },
      },
    }),
    db.contactTask.count({
      where: {
        ...baseWhere,
        status: 'completed',
      },
    }),
    db.contactTask.findMany({
      where: {
        ...baseWhere,
        ...(filter === 'open' ? { status: { not: 'completed' } } : {}),
        ...(filter === 'completed' ? { status: 'completed' } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { dueAt: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            conversations: {
              select: { ghlConversationId: true },
              take: 1,
              orderBy: { lastMessageAt: 'desc' as const },
            },
          }
        },
        conversation: {
          select: {
            id: true,
            ghlConversationId: true,
          }
        },
        syncRecords: {
          select: {
            provider: true,
            status: true,
            lastSyncedAt: true,
            lastError: true,
          },
        },
        outboxJobs: {
          where: {
            status: {
              in: ['pending', 'processing', 'failed', 'dead'],
            },
          },
          orderBy: [
            { status: 'asc' },
            { scheduledAt: 'asc' },
            { createdAt: 'desc' },
          ],
          select: {
            provider: true,
            status: true,
            operation: true,
            attemptCount: true,
            scheduledAt: true,
            lastError: true,
            createdAt: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    success: true,
    tasks,
    counts: {
      all: allCount,
      open: openCount,
      completed: completedCount,
    },
  };
}

export async function listTaskAssignableUsers() {
  const { location, userId, currentUserTimeZone } = await getAuthContext();

  const users = await db.user.findMany({
    where: {
      locations: {
        some: { id: location.id },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      timeZone: true,
    },
    orderBy: [
      { name: 'asc' },
      { email: 'asc' },
    ],
  });

  return {
    success: true as const,
    currentUserId: userId,
    currentUserTimeZone,
    users: users.map((candidate) => ({
      ...candidate,
      effectiveTimeZone: candidate.timeZone || location.timeZone || 'UTC',
    })),
  };
}

export async function getTaskDetail(taskId: string) {
  const { location } = await getAuthContext();
  const id = String(taskId || '').trim();
  if (!id) {
    return { success: false as const, error: 'Task ID is required' };
  }

  const task = await db.contactTask.findFirst({
    where: {
      id,
      locationId: location.id,
      deletedAt: null,
    },
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      conversation: {
        select: {
          id: true,
          ghlConversationId: true,
        },
      },
      assignedUser: {
        select: {
          id: true,
          name: true,
          email: true,
          timeZone: true,
          taskReminderPreference: true,
        },
      },
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      updatedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      syncRecords: {
        select: {
          provider: true,
          status: true,
          lastSyncedAt: true,
          lastError: true,
          attemptCount: true,
        },
      },
      outboxJobs: {
        where: {
          status: {
            in: ['pending', 'processing', 'failed', 'dead'],
          },
        },
        orderBy: [
          { status: 'asc' },
          { scheduledAt: 'asc' },
          { createdAt: 'desc' },
        ],
        select: {
          provider: true,
          status: true,
          operation: true,
          attemptCount: true,
          scheduledAt: true,
          lastError: true,
          createdAt: true,
        },
      },
      reminderJobs: {
        orderBy: [
          { scheduledFor: 'asc' },
          { createdAt: 'asc' },
        ],
        take: 12,
        include: {
          notification: {
            include: {
              deliveries: {
                select: {
                  channel: true,
                  status: true,
                  deliveredAt: true,
                  lastAttemptAt: true,
                  lastError: true,
                },
              },
            },
          },
        },
      },
      notifications: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          deliveries: {
            select: {
              channel: true,
              status: true,
              deliveredAt: true,
              lastAttemptAt: true,
              lastError: true,
            },
          },
        },
      },
    },
  });

  if (!task) {
    return { success: false as const, error: 'Task not found' };
  }

  return { success: true as const, task };
}

export async function createContactTask(input: z.input<typeof createTaskSchema>) {
  const { location, userId, currentUserTimeZone } = await getAuthContext();
  const parsed = createTaskSchema.parse(input);

  const conversationId = await resolveConversationId(location.id, parsed.conversationId || null);
  let contactId: string | null = null;

  if (parsed.contactId) {
    const contact = await resolveContact(location.id, parsed.contactId);
    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }
    contactId = contact.id;
  } else if (conversationId) {
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, locationId: location.id },
      select: { contactId: true },
    });
    contactId = conversation?.contactId || null;
  }

  if (!contactId) {
    return { success: false, error: 'Contact not found for task' };
  }

  let assignedUserId: string | null = null;
  if (parsed.assignedUserId) {
    const assignee = await db.user.findFirst({
      where: {
        id: parsed.assignedUserId,
        locations: { some: { id: location.id } },
      },
      select: { id: true },
    });
    assignedUserId = assignee?.id || null;
  }

  const dueAt = parseDueAt(parsed.dueAt || null, currentUserTimeZone);
  const reminderOffsets = parsed.reminderMode === 'custom'
    ? normalizeReminderOffsets(parsed.reminderOffsets)
    : Prisma.JsonNull;

  const task = await db.contactTask.create({
    data: {
      locationId: location.id,
      contactId,
      conversationId,
      title: parsed.title,
      description: parsed.description || null,
      dueAt,
      priority: parsed.priority,
      source: parsed.source,
      assignedUserId,
      reminderMode: parsed.reminderMode,
      reminderOffsets,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
    include: {
      syncRecords: true,
    },
  });

  // Fire-and-forget: sync + reminders run in the background
  void Promise.allSettled([
    enqueueTaskSyncJobs({ taskId: task.id, operation: 'create' }),
    rebuildTaskReminderJobs(task.id),
  ]).catch((err) => console.error('[task-sync] background enqueue error (create):', err));

  return { success: true, task };
}

export async function updateContactTask(input: z.input<typeof updateTaskSchema>) {
  const { location, userId, currentUserTimeZone } = await getAuthContext();
  const parsed = updateTaskSchema.parse(input);

  const existing = await db.contactTask.findFirst({
    where: {
      id: parsed.taskId,
      locationId: location.id,
      deletedAt: null,
    },
    select: {
      id: true,
      dueAt: true,
    },
  });

  if (!existing) {
    return { success: false, error: 'Task not found' };
  }

  let assignedUserId: string | null | undefined = undefined;
  if (parsed.assignedUserId !== undefined) {
    if (!parsed.assignedUserId) {
      assignedUserId = null;
    } else {
      const assignee = await db.user.findFirst({
        where: {
          id: parsed.assignedUserId,
          locations: { some: { id: location.id } },
        },
        select: { id: true },
      });
      assignedUserId = assignee?.id || null;
    }
  }

  const dueAt = parsed.dueAt === undefined
    ? undefined
    : parseDueAt(parsed.dueAt, currentUserTimeZone);
  const reminderOffsets = parsed.reminderMode === undefined
    ? undefined
    : parsed.reminderMode === 'custom'
      ? normalizeReminderOffsets(parsed.reminderOffsets)
      : Prisma.JsonNull;

  const task = await db.contactTask.update({
    where: { id: existing.id },
    data: {
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description || null } : {}),
      ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      ...(dueAt !== undefined ? { dueAt } : {}),
      ...(assignedUserId !== undefined ? { assignedUserId } : {}),
      ...(parsed.reminderMode !== undefined ? { reminderMode: parsed.reminderMode } : {}),
      ...(reminderOffsets !== undefined ? { reminderOffsets } : {}),
      updatedByUserId: userId,
      syncVersion: { increment: 1 },
    },
    include: {
      syncRecords: true,
    },
  });

  // Fire-and-forget: sync + reminders run in the background
  void Promise.allSettled([
    enqueueTaskSyncJobs({ taskId: task.id, operation: 'update' }),
    rebuildTaskReminderJobs(task.id),
  ]).catch((err) => console.error('[task-sync] background enqueue error (update):', err));

  return { success: true, task };
}

export async function setContactTaskCompletion(taskId: string, completed: boolean) {
  const { location, userId } = await getAuthContext();

  const existing = await db.contactTask.findFirst({
    where: {
      id: taskId,
      locationId: location.id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!existing) {
    return { success: false, error: 'Task not found' };
  }

  const task = await db.contactTask.update({
    where: { id: existing.id },
    data: {
      status: completed ? 'completed' : 'open',
      completedAt: completed ? new Date() : null,
      updatedByUserId: userId,
      syncVersion: { increment: 1 },
    },
    include: {
      syncRecords: true,
    },
  });

  // Fire-and-forget: sync + reminders run in the background
  void Promise.allSettled([
    enqueueTaskSyncJobs({ taskId: task.id, operation: completed ? 'complete' : 'uncomplete' }),
    rebuildTaskReminderJobs(task.id),
  ]).catch((err) => console.error('[task-sync] background enqueue error (completion):', err));

  return { success: true, task };
}

export async function deleteContactTask(taskId: string) {
  const { location, userId } = await getAuthContext();

  const existing = await db.contactTask.findFirst({
    where: {
      id: taskId,
      locationId: location.id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!existing) {
    return { success: false, error: 'Task not found' };
  }

  const task = await db.contactTask.update({
    where: { id: existing.id },
    data: {
      deletedAt: new Date(),
      status: 'canceled',
      updatedByUserId: userId,
      syncVersion: { increment: 1 },
    },
  });

  // Fire-and-forget: sync + reminders run in the background
  void Promise.allSettled([
    enqueueTaskSyncJobs({ taskId: task.id, operation: 'delete' }),
    rebuildTaskReminderJobs(task.id),
  ]).catch((err) => console.error('[task-sync] background enqueue error (delete):', err));

  return { success: true, task };
}
