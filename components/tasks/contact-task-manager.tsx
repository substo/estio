'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Plus, Trash2, Circle, CheckCircle2, Clock3, AlertCircle, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  createContactTask,
  deleteContactTask,
  listContactTasks,
  setContactTaskCompletion,
} from '@/app/(main)/admin/tasks/actions';

type TaskFilter = 'open' | 'completed' | 'all';

type ContactTaskManagerProps = {
  contactId: string;
  conversationId?: string | null;
  compact?: boolean;
  className?: string;
};

const TASK_SYNC_MAX_ATTEMPTS = 6;

type SyncRecord = {
  provider: string;
  status?: string | null;
  lastSyncedAt?: string | Date | null;
  lastError?: string | null;
};

type OutboxJob = {
  provider: string;
  status?: string | null;
  operation?: string | null;
  attemptCount?: number | null;
  scheduledAt?: string | Date | null;
  lastError?: string | null;
  createdAt?: string | Date | null;
};

type ProviderSyncStatus = 'synced' | 'error' | 'pending' | 'processing' | 'retrying' | 'dead' | 'disabled';

type ProviderBadge = {
  provider: string;
  key: string;
  status: ProviderSyncStatus;
  attemptsText?: string;
  title?: string;
};

type TaskCounts = {
  all: number;
  open: number;
  completed: number;
};

const PROVIDER_ICON_SOURCES: Record<string, { src: string; alt: string }> = {
  ghl: {
    src: 'https://www.gohighlevel.com/favicon.ico',
    alt: 'GoHighLevel',
  },
  google: {
    src: 'https://www.gstatic.com/images/branding/productlogos/tasks/v9/192px.svg',
    alt: 'Google Tasks',
  },
};

function formatDueLabel(input?: Date | string | null) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'PPp');
}

function getPriorityTone(priority: string) {
  if (priority === 'high') return 'bg-red-100 text-red-700 border-red-200';
  if (priority === 'low') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function getProviderSyncTone(status: ProviderSyncStatus) {
  if (status === 'synced') return 'bg-emerald-50 border-emerald-200';
  if (status === 'processing') return 'bg-blue-50 border-blue-200';
  if (status === 'pending') return 'bg-sky-50 border-sky-200';
  if (status === 'retrying') return 'bg-amber-50 border-amber-200';
  if (status === 'dead' || status === 'error') return 'bg-red-50 border-red-200';
  if (status === 'disabled') return 'bg-zinc-50 border-zinc-200';
  return 'bg-slate-50 border-slate-200';
}

function getProviderName(provider: string) {
  const normalized = String(provider || '').toLowerCase();
  if (normalized === 'ghl') return 'GoHighLevel';
  if (normalized === 'google') return 'Google Tasks';
  return provider.toUpperCase();
}

function getProviderStatusLabel(status: ProviderSyncStatus, attemptsText?: string) {
  if (status === 'synced') return 'synced';
  if (status === 'processing') return 'syncing now';
  if (status === 'retrying') return attemptsText ? `retrying (${attemptsText})` : 'retrying';
  if (status === 'pending') return 'queued';
  if (status === 'disabled') return 'disabled';
  if (status === 'dead') return 'attention required';
  return 'sync error';
}

function renderProviderStatusIcon(status: ProviderSyncStatus) {
  if (status === 'synced') return <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
  if (status === 'processing') return <Loader2 className="h-3 w-3 animate-spin text-blue-600" />;
  if (status === 'pending') return <Clock3 className="h-3 w-3 text-sky-600" />;
  if (status === 'retrying') return <Clock3 className="h-3 w-3 text-amber-600" />;
  if (status === 'disabled') return <Ban className="h-3 w-3 text-zinc-600" />;
  return <AlertCircle className="h-3 w-3 text-red-600" />;
}

function ProviderPlatformIcon({ provider }: { provider: string }) {
  const normalized = String(provider || '').toLowerCase();
  const source = PROVIDER_ICON_SOURCES[normalized];
  const [failedToLoad, setFailedToLoad] = useState(false);

  if (!source || failedToLoad) {
    return (
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-slate-200 text-[9px] font-semibold text-slate-700">
        {normalized.slice(0, 2).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    <img
      src={source.src}
      alt={source.alt}
      className="h-3.5 w-3.5 shrink-0 rounded-[2px]"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedToLoad(true)}
    />
  );
}

function pickProviderOutboxState(outboxJobs: OutboxJob[]) {
  if (!outboxJobs.length) return null;

  const byPriority = ['dead', 'failed', 'processing', 'pending'];
  for (const status of byPriority) {
    const match = outboxJobs
      .filter((job) => (job.status || '').toLowerCase() === status)
      .sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0))[0];

    if (match) return match;
  }

  return null;
}

function buildProviderBadges(syncRecords: SyncRecord[], outboxJobs: OutboxJob[]): ProviderBadge[] {
  const providers = new Set<string>();
  syncRecords.forEach((record) => providers.add(String(record.provider || '').toLowerCase()));
  outboxJobs.forEach((job) => providers.add(String(job.provider || '').toLowerCase()));

  const badges: ProviderBadge[] = [];

  for (const provider of providers) {
    if (!provider) continue;

    const syncRecord = syncRecords.find((record) => String(record.provider || '').toLowerCase() === provider);
    const providerOutbox = outboxJobs.filter((job) => String(job.provider || '').toLowerCase() === provider);
    const outboxState = pickProviderOutboxState(providerOutbox);

    if (outboxState) {
      const status = String(outboxState.status || '').toLowerCase();

      if (status === 'dead') {
        badges.push({
          provider,
          key: `${provider}-dead`,
          status: 'dead',
          title: outboxState.lastError || 'Sync is dead; requires manual intervention',
        });
        continue;
      }

      if (status === 'failed') {
        const attempts = Math.max(1, Number(outboxState.attemptCount || 1));
        const nextRetry = formatDueLabel(outboxState.scheduledAt || null);
        const retryTitle = nextRetry
          ? `Retry ${attempts}/${TASK_SYNC_MAX_ATTEMPTS} scheduled for ${nextRetry}`
          : `Retry ${attempts}/${TASK_SYNC_MAX_ATTEMPTS} scheduled`;

        badges.push({
          provider,
          key: `${provider}-retrying`,
          status: 'retrying',
          attemptsText: `${attempts}/${TASK_SYNC_MAX_ATTEMPTS}`,
          title: outboxState.lastError ? `${retryTitle}\n${outboxState.lastError}` : retryTitle,
        });
        continue;
      }

      if (status === 'processing') {
        badges.push({
          provider,
          key: `${provider}-processing`,
          status: 'processing',
          title: 'Sync operation in progress',
        });
        continue;
      }

      badges.push({
        provider,
        key: `${provider}-pending`,
        status: 'pending',
        title: 'Sync queued',
      });
      continue;
    }

    const syncStatus = String(syncRecord?.status || '').toLowerCase();
    if (syncStatus === 'synced') {
      badges.push({
        provider,
        key: `${provider}-synced`,
        status: 'synced',
        title: syncRecord?.lastSyncedAt ? `Last synced ${formatDueLabel(syncRecord.lastSyncedAt)}` : 'Synced',
      });
      continue;
    }

    if (syncStatus === 'disabled') {
      badges.push({
        provider,
        key: `${provider}-disabled`,
        status: 'disabled',
        title: syncRecord?.lastError || 'Sync disabled',
      });
      continue;
    }

    if (syncStatus === 'error') {
      badges.push({
        provider,
        key: `${provider}-error`,
        status: 'error',
        title: syncRecord?.lastError || 'Last sync attempt failed',
      });
      continue;
    }

    badges.push({
      provider,
      key: `${provider}-pending`,
      status: 'pending',
      title: 'Awaiting first successful sync',
    });
  }

  return badges.sort((a, b) => a.provider.localeCompare(b.provider));
}

function normalizeTask(task: any) {
  return {
    ...task,
    syncRecords: Array.isArray(task?.syncRecords) ? task.syncRecords : [],
    outboxJobs: Array.isArray(task?.outboxJobs) ? task.outboxJobs : [],
  };
}

function isCompletedTask(task: any) {
  return String(task?.status || '').toLowerCase() === 'completed';
}

function clampCount(value: number) {
  return Math.max(0, value);
}

function incrementOpenTaskCounts(prev: TaskCounts): TaskCounts {
  return {
    all: prev.all + 1,
    open: prev.open + 1,
    completed: prev.completed,
  };
}

function decrementTaskCounts(prev: TaskCounts, task: any): TaskCounts {
  const completed = isCompletedTask(task);
  return {
    all: clampCount(prev.all - 1),
    open: completed ? prev.open : clampCount(prev.open - 1),
    completed: completed ? clampCount(prev.completed - 1) : prev.completed,
  };
}

function transitionCompletionCounts(prev: TaskCounts, toCompleted: boolean): TaskCounts {
  if (toCompleted) {
    return {
      all: prev.all,
      open: clampCount(prev.open - 1),
      completed: prev.completed + 1,
    };
  }

  return {
    all: prev.all,
    open: prev.open + 1,
    completed: clampCount(prev.completed - 1),
  };
}

export function ContactTaskManager({
  contactId,
  conversationId,
  compact = false,
  className,
}: ContactTaskManagerProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [counts, setCounts] = useState({ all: 0, open: 0, completed: 0 });
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [dueAtInput, setDueAtInput] = useState('');
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false);
  const [busyTaskIds, setBusyTaskIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);

  const setTaskBusyState = useCallback((taskId: string, isBusy: boolean) => {
    setBusyTaskIds((prev) => {
      if (isBusy) {
        return { ...prev, [taskId]: true };
      }

      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  const loadTasks = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!contactId) return;
    const requestId = ++loadRequestIdRef.current;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await listContactTasks(contactId, filter);
      if (requestId !== loadRequestIdRef.current) return;

      if (!res?.success) {
        if (!silent) {
          setTasks([]);
          setCounts({ all: 0, open: 0, completed: 0 });
        }
        setError(res?.error || 'Failed to load tasks');
        return;
      }

      setTasks(Array.isArray(res.tasks) ? res.tasks.map(normalizeTask) : []);
      setCounts(res.counts || { all: 0, open: 0, completed: 0 });
    } catch (e: any) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(e?.message || 'Failed to load tasks');
    } finally {
      if (requestId !== loadRequestIdRef.current) return;
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [contactId, filter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const canSubmit = useMemo(() => titleInput.trim().length > 0 && !submitting, [titleInput, submitting]);

  const handleCreateTask = async () => {
    const trimmedTitle = titleInput.trim();
    if (!trimmedTitle) return;

    const previousTasks = tasks;
    const previousCounts = counts;
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTask = normalizeTask({
      id: optimisticId,
      title: trimmedTitle,
      description: descriptionInput.trim() || null,
      dueAt: dueAtInput || null,
      priority: 'medium',
      status: 'open',
      completedAt: null,
      syncRecords: [],
      outboxJobs: [],
      _optimistic: true,
    });

    if (filter !== 'completed') {
      setTasks((prev) => [optimisticTask, ...prev]);
    }
    setCounts((prev) => incrementOpenTaskCounts(prev));

    setSubmitting(true);
    setError(null);

    try {
      const res = await createContactTask({
        contactId,
        conversationId: conversationId || undefined,
        title: trimmedTitle,
        description: descriptionInput.trim() || undefined,
        dueAt: dueAtInput || undefined,
        priority: 'medium',
        source: 'manual',
      });

      if (!res?.success) {
        setTasks(previousTasks);
        setCounts(previousCounts);
        setError(res?.error || 'Failed to create task');
        return;
      }

      const createdTask = normalizeTask(res.task);

      setTasks((prev) => {
        if (filter === 'completed') return prev;
        if (prev.some((task) => task.id === optimisticId)) {
          return prev.map((task) => (task.id === optimisticId ? createdTask : task));
        }
        if (prev.some((task) => task.id === createdTask.id)) return prev;
        return [createdTask, ...prev];
      });

      setTitleInput('');
      setDescriptionInput('');
      setDueAtInput('');
      setAddTaskModalOpen(false);
      void loadTasks({ silent: true });
    } catch (e: any) {
      setTasks(previousTasks);
      setCounts(previousCounts);
      setError(e?.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleComplete = async (taskId: string, completed: boolean) => {
    const previousTasks = tasks;
    const previousCounts = counts;
    const targetTask = previousTasks.find((task) => task.id === taskId);
    if (!targetTask) return;

    setTaskBusyState(taskId, true);
    setError(null);

    const wasCompleted = isCompletedTask(targetTask);
    if (wasCompleted !== completed) {
      setCounts((prev) => transitionCompletionCounts(prev, completed));
    }

    setTasks((prev) =>
      prev.flatMap((task) => {
        if (task.id !== taskId) return [task];

        const nextTask = normalizeTask({
          ...task,
          status: completed ? 'completed' : 'open',
          completedAt: completed ? new Date().toISOString() : null,
        });

        if (filter === 'open' && completed) return [];
        if (filter === 'completed' && !completed) return [];
        return [nextTask];
      })
    );

    try {
      const res = await setContactTaskCompletion(taskId, completed);
      if (!res?.success) {
        setTasks(previousTasks);
        setCounts(previousCounts);
        setError(res?.error || 'Failed to update task');
        return;
      }

      const updatedTask = normalizeTask(res.task);
      setTasks((prev) => prev.map((task) => (task.id === taskId ? updatedTask : task)));
      void loadTasks({ silent: true });
    } catch (e: any) {
      setTasks(previousTasks);
      setCounts(previousCounts);
      setError(e?.message || 'Failed to update task');
    } finally {
      setTaskBusyState(taskId, false);
    }
  };

  const handleDelete = async (taskId: string) => {
    const previousTasks = tasks;
    const previousCounts = counts;
    const taskToDelete = previousTasks.find((task) => task.id === taskId);
    if (!taskToDelete) return;

    setError(null);
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    setCounts((prev) => decrementTaskCounts(prev, taskToDelete));

    try {
      const res = await deleteContactTask(taskId);
      if (!res?.success) {
        setTasks(previousTasks);
        setCounts(previousCounts);
        setError(res?.error || 'Failed to delete task');
        return;
      }

      void loadTasks({ silent: true });
    } catch (e: any) {
      setTasks(previousTasks);
      setCounts(previousCounts);
      setError(e?.message || 'Failed to delete task');
    }
  };

  const showBlockingLoader = loading && tasks.length === 0;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-end gap-1 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            setError(null);
            setAddTaskModalOpen(true);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add task
        </Button>
        {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={filter === 'open' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setFilter('open')}
          >
            Open ({counts.open})
          </Button>
          <Button
            type="button"
            variant={filter === 'completed' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setFilter('completed')}
          >
            Done ({counts.completed})
          </Button>
          <Button
            type="button"
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setFilter('all')}
          >
            All ({counts.all})
          </Button>
        </div>
      </div>

      <Dialog
        open={addTaskModalOpen}
        onOpenChange={(open) => {
          setAddTaskModalOpen(open);
          if (!open && !submitting) {
            setTitleInput('');
            setDescriptionInput('');
            setDueAtInput('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
            <DialogDescription>Create a new task for this contact.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              placeholder="Add task title"
              className="h-9 text-sm"
              autoFocus
            />
            {!compact && (
              <Textarea
                value={descriptionInput}
                onChange={(event) => setDescriptionInput(event.target.value)}
                placeholder="Optional description"
                className="min-h-[96px] text-sm"
              />
            )}
            <Input
              type="datetime-local"
              value={dueAtInput}
              onChange={(event) => setDueAtInput(event.target.value)}
              className="h-9 text-xs"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAddTaskModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateTask}
              disabled={!canSubmit}
            >
              {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Add task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="space-y-2">
        {showBlockingLoader ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No tasks in this view.</div>
        ) : (
          tasks.map((task) => {
            const isCompleted = task.status === 'completed';
            const dueLabel = formatDueLabel(task.dueAt);
            const syncRecords: SyncRecord[] = Array.isArray(task.syncRecords) ? task.syncRecords : [];
            const outboxJobs: OutboxJob[] = Array.isArray(task.outboxJobs) ? task.outboxJobs : [];
            const providerBadges = buildProviderBadges(syncRecords, outboxJobs);
            const isBusy = Boolean(busyTaskIds[task.id]);

            return (
              <div key={task.id} className="rounded-md border bg-card p-2.5 text-xs space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className={cn('flex items-start gap-2 text-left flex-1', isBusy && 'opacity-70 cursor-not-allowed')}
                    onClick={() => handleToggleComplete(task.id, !isCompleted)}
                    disabled={isBusy}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    )}
                    <span className={cn('font-medium text-sm', isCompleted && 'line-through text-muted-foreground')}>
                      {task.title}
                    </span>
                  </button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(task.id)}
                    disabled={isBusy}
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>

                {task.description && (
                  <div className="text-muted-foreground whitespace-pre-wrap pl-6 text-[11px]">{task.description}</div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 pl-6">
                  <Badge variant="outline" className={cn('text-[10px] h-5', getPriorityTone(task.priority || 'medium'))}>
                    {task.priority || 'medium'}
                  </Badge>

                  {dueLabel && (
                    <Badge variant="outline" className="text-[10px] h-5 bg-blue-50 text-blue-700 border-blue-200">
                      <Clock3 className="h-3 w-3 mr-1" />
                      {dueLabel}
                    </Badge>
                  )}

                  {providerBadges.map((badge) => (
                    <span
                      key={`${task.id}-${badge.key}`}
                      className={cn(
                        'inline-flex h-5 items-center gap-1 rounded-md border px-1.5',
                        getProviderSyncTone(badge.status),
                      )}
                      aria-label={`${getProviderName(badge.provider)} ${getProviderStatusLabel(badge.status, badge.attemptsText)}`}
                      title={badge.title}
                    >
                      <ProviderPlatformIcon provider={badge.provider} />
                      {renderProviderStatusIcon(badge.status)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
