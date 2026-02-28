import { ContactTask } from '@prisma/client';
import { google, tasks_v1 } from 'googleapis';
import { getValidAccessToken } from '@/lib/google/auth';
import { TaskSyncOperationResult } from '@/lib/tasks/types';

export const DEFAULT_GOOGLE_TASKLIST_ID = '@default';

type HubTaskForGoogle = Pick<ContactTask, 'title' | 'description' | 'dueAt' | 'status' | 'completedAt'>;

async function getGoogleTasksClient(userId: string) {
  const auth = await getValidAccessToken(userId);
  return google.tasks({ version: 'v1', auth });
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
