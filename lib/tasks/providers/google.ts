import { ContactTask } from '@prisma/client';
import { google, tasks_v1 } from 'googleapis';
import { getValidAccessToken } from '@/lib/google/auth';
import { TaskSyncOperationResult } from '@/lib/tasks/types';

export const DEFAULT_GOOGLE_TASKLIST_ID = '@default';
const GOOGLE_TASKLIST_PAGE_SIZE = 100;
const GOOGLE_TASKLIST_MAX_RESULTS = 500;

type HubTaskForGoogle = Pick<ContactTask, 'title' | 'description' | 'dueAt' | 'status' | 'completedAt'>;

export type GoogleTasklistOption = {
  id: string;
  title: string;
  updatedAt: Date | null;
  isDefault: boolean;
};

async function getGoogleTasksClient(userId: string) {
  const auth = await getValidAccessToken(userId);
  return google.tasks({ version: 'v1', auth });
}

function normalizeTasklistTitle(title?: string | null): string {
  const trimmed = String(title || '').trim();
  return trimmed || 'Untitled List';
}

export async function listGoogleTasklists(options: {
  userId: string;
  includeDefault?: boolean;
}): Promise<GoogleTasklistOption[]> {
  const tasksClient = await getGoogleTasksClient(options.userId);
  const byId = new Map<string, GoogleTasklistOption>();

  let pageToken: string | undefined;
  let fetched = 0;

  do {
    const response = await tasksClient.tasklists.list({
      maxResults: GOOGLE_TASKLIST_PAGE_SIZE,
      pageToken,
    });

    const items = Array.isArray(response.data.items) ? response.data.items : [];
    for (const item of items) {
      if (!item.id) continue;
      const updatedAt = item.updated ? new Date(item.updated) : null;
      byId.set(item.id, {
        id: item.id,
        title: normalizeTasklistTitle(item.title),
        updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
        isDefault: item.id === DEFAULT_GOOGLE_TASKLIST_ID,
      });
      fetched += 1;
      if (fetched >= GOOGLE_TASKLIST_MAX_RESULTS) break;
    }

    pageToken = response.data.nextPageToken || undefined;
    if (fetched >= GOOGLE_TASKLIST_MAX_RESULTS) break;
  } while (pageToken);

  if (options.includeDefault !== false && !byId.has(DEFAULT_GOOGLE_TASKLIST_ID)) {
    byId.set(DEFAULT_GOOGLE_TASKLIST_ID, {
      id: DEFAULT_GOOGLE_TASKLIST_ID,
      title: 'Default',
      updatedAt: null,
      isDefault: true,
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.title.localeCompare(b.title);
  });
}

function toGoogleStatus(status: string): 'needsAction' | 'completed' {
  return status === 'completed' ? 'completed' : 'needsAction';
}

function toGoogleTaskBody(task: HubTaskForGoogle): tasks_v1.Schema$Task {
  return {
    title: task.title,
    notes: task.description || undefined,
    due: task.dueAt ? task.dueAt.toISOString() : undefined,
    status: toGoogleStatus(task.status),
    completed:
      task.status === 'completed'
        ? (task.completedAt ? task.completedAt.toISOString() : new Date().toISOString())
        : undefined,
  };
}

function toSyncResult(remote: tasks_v1.Schema$Task, tasklistId: string): TaskSyncOperationResult {
  const updatedRaw = remote.updated || null;
  const updated = updatedRaw ? new Date(updatedRaw) : null;
  return {
    providerTaskId: remote.id || null,
    providerContainerId: tasklistId,
    remoteUpdatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    etag: remote.etag || null,
  };
}

export async function createGoogleTask(options: {
  userId: string;
  task: HubTaskForGoogle;
  tasklistId?: string | null;
}): Promise<TaskSyncOperationResult> {
  const tasklist = options.tasklistId || DEFAULT_GOOGLE_TASKLIST_ID;
  const tasksClient = await getGoogleTasksClient(options.userId);
  const response = await tasksClient.tasks.insert({
    tasklist,
    requestBody: toGoogleTaskBody(options.task),
  });

  return toSyncResult(response.data, tasklist);
}

export async function updateGoogleTask(options: {
  userId: string;
  providerTaskId: string;
  task: HubTaskForGoogle;
  tasklistId?: string | null;
}): Promise<TaskSyncOperationResult> {
  const tasklist = options.tasklistId || DEFAULT_GOOGLE_TASKLIST_ID;
  const tasksClient = await getGoogleTasksClient(options.userId);
  const response = await tasksClient.tasks.update({
    tasklist,
    task: options.providerTaskId,
    requestBody: {
      ...toGoogleTaskBody(options.task),
      id: options.providerTaskId,
    },
  });

  return toSyncResult(response.data, tasklist);
}

export async function setGoogleTaskCompletion(options: {
  userId: string;
  providerTaskId: string;
  completed: boolean;
  tasklistId?: string | null;
}): Promise<TaskSyncOperationResult> {
  const tasklist = options.tasklistId || DEFAULT_GOOGLE_TASKLIST_ID;
  const tasksClient = await getGoogleTasksClient(options.userId);
  const response = await tasksClient.tasks.patch({
    tasklist,
    task: options.providerTaskId,
    requestBody: {
      status: options.completed ? 'completed' : 'needsAction',
      completed: options.completed ? new Date().toISOString() : null,
    },
  });

  return toSyncResult(response.data, tasklist);
}

export async function deleteGoogleTask(options: {
  userId: string;
  providerTaskId: string;
  tasklistId?: string | null;
}): Promise<void> {
  const tasklist = options.tasklistId || DEFAULT_GOOGLE_TASKLIST_ID;
  const tasksClient = await getGoogleTasksClient(options.userId);
  await tasksClient.tasks.delete({
    tasklist,
    task: options.providerTaskId,
  });
}
