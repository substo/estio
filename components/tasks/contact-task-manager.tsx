'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Plus, Trash2, Circle, CheckCircle2, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  title?: string;
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

type ProviderBadge = {
  provider: string;
  key: string;
  label: string;
  tone: string;
  title?: string;
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

function getProviderSyncTone(status: 'synced' | 'error' | 'pending' | 'processing' | 'retrying' | 'dead' | 'disabled') {
  if (status === 'synced') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'processing') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (status === 'pending') return 'bg-sky-100 text-sky-700 border-sky-200';
  if (status === 'retrying') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'dead' || status === 'error') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'disabled') return 'bg-zinc-100 text-zinc-700 border-zinc-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
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
          label: `${provider}:attention`,
          tone: getProviderSyncTone('dead'),
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
          label: `${provider}:retry ${attempts}/${TASK_SYNC_MAX_ATTEMPTS}`,
          tone: getProviderSyncTone('retrying'),
          title: outboxState.lastError ? `${retryTitle}\n${outboxState.lastError}` : retryTitle,
        });
        continue;
      }

      if (status === 'processing') {
        badges.push({
          provider,
          key: `${provider}-processing`,
          label: `${provider}:syncing`,
          tone: getProviderSyncTone('processing'),
          title: 'Sync operation in progress',
        });
        continue;
      }

      badges.push({
        provider,
        key: `${provider}-pending`,
        label: `${provider}:queued`,
        tone: getProviderSyncTone('pending'),
        title: 'Sync queued',
      });
      continue;
    }

    const syncStatus = String(syncRecord?.status || '').toLowerCase();
    if (syncStatus === 'synced') {
      badges.push({
        provider,
        key: `${provider}-synced`,
        label: `${provider}:synced`,
        tone: getProviderSyncTone('synced'),
        title: syncRecord?.lastSyncedAt ? `Last synced ${formatDueLabel(syncRecord.lastSyncedAt)}` : 'Synced',
      });
      continue;
    }

    if (syncStatus === 'disabled') {
      badges.push({
        provider,
        key: `${provider}-disabled`,
        label: `${provider}:disabled`,
        tone: getProviderSyncTone('disabled'),
        title: syncRecord?.lastError || 'Sync disabled',
      });
      continue;
    }

    if (syncStatus === 'error') {
      badges.push({
        provider,
        key: `${provider}-error`,
        label: `${provider}:error`,
        tone: getProviderSyncTone('error'),
        title: syncRecord?.lastError || 'Last sync attempt failed',
      });
      continue;
    }

    badges.push({
      provider,
      key: `${provider}-pending`,
      label: `${provider}:pending`,
      tone: getProviderSyncTone('pending'),
      title: 'Awaiting first successful sync',
    });
  }

  return badges.sort((a, b) => a.provider.localeCompare(b.provider));
}

export function ContactTaskManager({
  contactId,
  conversationId,
  compact = false,
  className,
  title = 'Tasks',
}: ContactTaskManagerProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [counts, setCounts] = useState({ all: 0, open: 0, completed: 0 });
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [dueAtInput, setDueAtInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listContactTasks(contactId, filter);
      if (!res?.success) {
        setTasks([]);
        setCounts({ all: 0, open: 0, completed: 0 });
        setError(res?.error || 'Failed to load tasks');
        return;
      }

      setTasks(res.tasks || []);
      setCounts(res.counts || { all: 0, open: 0, completed: 0 });
    } catch (e: any) {
      setError(e?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [contactId, filter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const canSubmit = useMemo(() => titleInput.trim().length > 0 && !submitting, [titleInput, submitting]);

  const handleCreateTask = async () => {
    if (!titleInput.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await createContactTask({
        contactId,
        conversationId: conversationId || undefined,
        title: titleInput.trim(),
        description: descriptionInput.trim() || undefined,
        dueAt: dueAtInput || undefined,
        priority: 'medium',
        source: 'manual',
      });

      if (!res?.success) {
        setError(res?.error || 'Failed to create task');
        return;
      }

      setTitleInput('');
      setDescriptionInput('');
      setDueAtInput('');
      await loadTasks();
    } catch (e: any) {
      setError(e?.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleComplete = async (taskId: string, completed: boolean) => {
    try {
      const res = await setContactTaskCompletion(taskId, completed);
      if (!res?.success) {
        setError(res?.error || 'Failed to update task');
        return;
      }
      await loadTasks();
    } catch (e: any) {
      setError(e?.message || 'Failed to update task');
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      const res = await deleteContactTask(taskId);
      if (!res?.success) {
        setError(res?.error || 'Failed to delete task');
        return;
      }
      await loadTasks();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete task');
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
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

      <div className="rounded-md border bg-background p-2 space-y-2">
        <Input
          value={titleInput}
          onChange={(event) => setTitleInput(event.target.value)}
          placeholder="Add task title"
          className="h-8 text-sm"
        />
        {!compact && (
          <Textarea
            value={descriptionInput}
            onChange={(event) => setDescriptionInput(event.target.value)}
            placeholder="Optional description"
            className="min-h-[70px] text-sm"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <Input
            type="datetime-local"
            value={dueAtInput}
            onChange={(event) => setDueAtInput(event.target.value)}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={handleCreateTask}
            disabled={!canSubmit}
          >
            {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            Add
          </Button>
        </div>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="space-y-2">
        {loading ? (
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

            return (
              <div key={task.id} className="rounded-md border bg-card p-2.5 text-xs space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="flex items-start gap-2 text-left flex-1"
                    onClick={() => handleToggleComplete(task.id, !isCompleted)}
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
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
                    <Badge
                      key={`${task.id}-${badge.key}`}
                      variant="outline"
                      className={cn('text-[10px] h-5 uppercase', badge.tone)}
                      title={badge.title}
                    >
                      {badge.label}
                    </Badge>
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
