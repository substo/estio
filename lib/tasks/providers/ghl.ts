import { ContactTask } from '@prisma/client';
import { ghlFetch } from '@/lib/ghl/client';
import { TaskSyncOperationResult } from '@/lib/tasks/types';

type HubTaskForGhl = Pick<ContactTask, 'title' | 'description' | 'dueAt' | 'assignedUserId' | 'status'>;

type GhlTaskEnvelope = {
  id?: string;
  task?: {
    id?: string;
    dateUpdated?: string;
    etag?: string;
  };
  dateUpdated?: string;
};

function toRequiredDueDate(dueAt: Date | null): string {
  const value = dueAt || new Date();
  return value.toISOString();
}

function toGhlTaskPayload(task: HubTaskForGhl) {
  const completed = task.status === 'completed';
  return {
    title: task.title,
    body: task.description || undefined,
    dueDate: toRequiredDueDate(task.dueAt),
    assignedTo: task.assignedUserId || undefined,
    completed,
  };
}

function pickGhlTaskId(response: GhlTaskEnvelope): string | null {
  return response.task?.id || response.id || null;
}

function pickRemoteUpdatedAt(response: GhlTaskEnvelope): Date | null {
  const raw = response.task?.dateUpdated || response.dateUpdated;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function createGhlTaskForContact(options: {
  accessToken: string;
  ghlContactId: string;
  task: HubTaskForGhl;
}): Promise<TaskSyncOperationResult> {
  const response = await ghlFetch<GhlTaskEnvelope>(
    `/contacts/${options.ghlContactId}/tasks`,
    options.accessToken,
    {
      method: 'POST',
      body: JSON.stringify(toGhlTaskPayload(options.task)),
    }
  );

  return {
    providerTaskId: pickGhlTaskId(response),
    remoteUpdatedAt: pickRemoteUpdatedAt(response),
    etag: response.task?.etag || null,
  };
}

export async function updateGhlTaskForContact(options: {
  accessToken: string;
  ghlContactId: string;
  providerTaskId: string;
  task: HubTaskForGhl;
}): Promise<TaskSyncOperationResult> {
  const response = await ghlFetch<GhlTaskEnvelope>(
    `/contacts/${options.ghlContactId}/tasks/${options.providerTaskId}`,
    options.accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(toGhlTaskPayload(options.task)),
    }
  );

  return {
    providerTaskId: pickGhlTaskId(response) || options.providerTaskId,
    remoteUpdatedAt: pickRemoteUpdatedAt(response),
    etag: response.task?.etag || null,
  };
}

export async function setGhlTaskCompletionForContact(options: {
  accessToken: string;
  ghlContactId: string;
  providerTaskId: string;
  completed: boolean;
}): Promise<TaskSyncOperationResult> {
  try {
    const response = await ghlFetch<GhlTaskEnvelope>(
      `/contacts/${options.ghlContactId}/tasks/${options.providerTaskId}/completed`,
      options.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ completed: options.completed }),
      }
    );

    return {
      providerTaskId: pickGhlTaskId(response) || options.providerTaskId,
      remoteUpdatedAt: pickRemoteUpdatedAt(response),
      etag: response.task?.etag || null,
    };
  } catch {
    // Some tenants may not expose the completed endpoint consistently; fallback to standard update payload.
    const response = await ghlFetch<GhlTaskEnvelope>(
      `/contacts/${options.ghlContactId}/tasks/${options.providerTaskId}`,
      options.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          dueDate: new Date().toISOString(),
          completed: options.completed,
        }),
      }
    );

    return {
      providerTaskId: pickGhlTaskId(response) || options.providerTaskId,
      remoteUpdatedAt: pickRemoteUpdatedAt(response),
      etag: response.task?.etag || null,
    };
  }
}

export async function deleteGhlTaskForContact(options: {
  accessToken: string;
  ghlContactId: string;
  providerTaskId: string;
}): Promise<void> {
  await ghlFetch<Record<string, never>>(
    `/contacts/${options.ghlContactId}/tasks/${options.providerTaskId}`,
    options.accessToken,
    {
      method: 'DELETE',
    }
  );
}
