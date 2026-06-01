import type { Prisma } from '@prisma/client';

export type ContactTaskStatusFilter = 'open' | 'completed' | 'all';

export type TaskCounts = {
  all: number;
  open: number;
  completed: number;
};

type StatusCountRow = {
  status: string;
  _count: { _all: number };
};

type TaskRowWithConversationFallback = {
  conversation?: { id: string } | null;
  contact?: { id: string } | null;
};

type FallbackConversation = {
  id: string;
  ghlConversationId: string | null;
  contactId: string;
};

export const EMPTY_TASK_COUNTS: TaskCounts = {
  all: 0,
  open: 0,
  completed: 0,
};

export const CONTACT_TASK_ORDER_BY: Prisma.ContactTaskOrderByWithRelationInput[] = [
  { status: 'asc' },
  { dueAt: 'asc' },
  { createdAt: 'desc' },
  { id: 'asc' },
];

export const CONTACT_TASK_ASSIGNEE_SELECT = {
  id: true,
  name: true,
  email: true,
} as const;

export const CONTACT_TASK_PROVIDER_STATE_SELECT: Pick<Prisma.ContactTaskSelect, 'syncRecords' | 'outboxJobs'> = {
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
};

export function buildTaskStatusWhere(filter: ContactTaskStatusFilter): Prisma.ContactTaskWhereInput {
  if (filter === 'open') return { status: { not: 'completed' } };
  if (filter === 'completed') return { status: 'completed' };
  return {};
}

export function buildTaskCounts(statusCounts: StatusCountRow[]): TaskCounts {
  let all = 0;
  let completed = 0;

  for (const row of statusCounts) {
    const count = Number(row._count?._all || 0);
    all += count;
    if (String(row.status || '').toLowerCase() === 'completed') {
      completed += count;
    }
  }

  return {
    all,
    completed,
    open: Math.max(0, all - completed),
  };
}

export function normalizeTaskListPagination(
  options: { limit?: number; offset?: number } = {},
  defaults: { defaultLimit?: number; maxLimit?: number } = {},
) {
  const defaultLimit = defaults.defaultLimit ?? 100;
  const maxLimit = defaults.maxLimit ?? 250;
  const requestedLimit = Number(options.limit || defaultLimit);
  const requestedOffset = Number(options.offset || 0);

  return {
    limit: Math.min(maxLimit, Math.max(1, Math.trunc(requestedLimit))),
    offset: Math.max(0, Math.trunc(requestedOffset)),
  };
}

export function getContactIdsNeedingFallbackConversation<T extends TaskRowWithConversationFallback>(
  tasks: T[],
) {
  return Array.from(new Set(
    tasks
      .filter((task) => !task.conversation?.id && task.contact?.id)
      .map((task) => task.contact!.id)
  ));
}

export function attachFallbackConversationsToTasks<T extends TaskRowWithConversationFallback>(
  tasks: T[],
  fallbackConversations: FallbackConversation[],
) {
  const fallbackConversationByContactId = new Map(
    fallbackConversations.map((conversation) => [
      conversation.contactId,
      { id: conversation.id, ghlConversationId: conversation.ghlConversationId },
    ])
  );

  return tasks.map((task) => {
    const fallbackConversation = task.contact && !task.conversation?.id
      ? fallbackConversationByContactId.get(task.contact.id) || null
      : null;

    return {
      ...task,
      contact: task.contact
        ? {
          ...task.contact,
          conversations: fallbackConversation ? [fallbackConversation] : [],
        }
        : task.contact,
    };
  });
}
