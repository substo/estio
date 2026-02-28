export const TASK_PROVIDERS = ['ghl', 'google'] as const;
export type TaskProvider = (typeof TASK_PROVIDERS)[number];

export const TASK_OUTBOX_OPERATIONS = ['create', 'update', 'complete', 'uncomplete', 'delete'] as const;
export type TaskOutboxOperation = (typeof TASK_OUTBOX_OPERATIONS)[number];

export const TASK_SYNC_TERMINAL_OUTBOX_STATUSES = ['completed', 'dead'] as const;

export type TaskSyncOperationResult = {
  providerTaskId?: string | null;
  providerContainerId?: string | null;
  remoteUpdatedAt?: Date | null;
  etag?: string | null;
};

export type TaskSyncEngineStats = {
  scanned: number;
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  skipped: number;
};
