'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2, Trash2, Pencil, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { deleteContactTask, getTaskDetail, setContactTaskCompletion } from '@/app/(main)/admin/tasks/actions';
import { reminderOffsetLabel } from '@/lib/tasks/reminder-config';
import { Button } from '@/components/ui/button';
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
import { TaskEditorDialog } from '@/components/tasks/task-editor-dialog';

type TaskDetailDialogProps = {
  taskId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskMutated?: (taskId: string) => void;
  onOpenConversation?: (conversationId: string) => void;
};

function formatDateTime(input?: Date | string | null, timeZone?: string | null) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getPriorityTone(priority: string) {
  if (priority === 'high') return 'bg-red-100 text-red-700 border-red-200';
  if (priority === 'low') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function getReminderStatusTone(status: string) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'failed' || status === 'dead') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'canceled') return 'bg-zinc-50 text-zinc-700 border-zinc-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function TaskDetailDialog({
  taskId,
  open,
  onOpenChange,
  onTaskMutated,
  onOpenConversation,
}: TaskDetailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    if (!open || !taskId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    getTaskDetail(taskId)
      .then((result) => {
        if (cancelled) return;
        if (!result?.success) {
          setTask(null);
          setError(result?.error || 'Failed to load task details');
          return;
        }
        setTask(result.task);
      })
      .catch((nextError) => {
        if (cancelled) return;
        console.error('Failed to load task detail:', nextError);
        setError(nextError?.message || 'Failed to load task details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, taskId]);

  const assigneeTimeZone = task?.assignedUser?.timeZone || null;
  const dueLabel = formatDateTime(task?.dueAt, assigneeTimeZone);
  const createdAtLabel = formatDateTime(task?.createdAt);
  const updatedAtLabel = formatDateTime(task?.updatedAt);
  const completedAtLabel = formatDateTime(task?.completedAt);

  const pendingReminderJobs = useMemo(
    () => (Array.isArray(task?.reminderJobs) ? task.reminderJobs : []).filter((job: any) => job.status !== 'canceled'),
    [task]
  );

  async function handleToggleComplete() {
    if (!task?.id) return;
    setBusy(true);
    try {
      const result = await setContactTaskCompletion(task.id, String(task.status || '').toLowerCase() !== 'completed');
      if (!result?.success) {
        toast.error(String(result?.error || 'Failed to update task'));
        return;
      }
      onTaskMutated?.(task.id);
      onOpenChange(false);
    } catch (nextError: any) {
      console.error('Failed to toggle task completion:', nextError);
      toast.error(nextError?.message || 'Failed to update task');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!task?.id) return;
    setBusy(true);
    try {
      const result = await deleteContactTask(task.id);
      if (!result?.success) {
        toast.error(String(result?.error || 'Failed to delete task'));
        return;
      }
      onTaskMutated?.(task.id);
      onOpenChange(false);
    } catch (nextError: any) {
      console.error('Failed to delete task:', nextError);
      toast.error(nextError?.message || 'Failed to delete task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{task?.title || 'Task details'}</DialogTitle>
            <DialogDescription>
              Deadline reminder state, assignment, provider sync, and related contact/conversation context.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading task details...
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : !task ? (
            <div className="text-sm text-muted-foreground">Task not found.</div>
          ) : (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('capitalize', getPriorityTone(task.priority || 'medium'))}>
                  {task.priority || 'medium'}
                </Badge>
                <Badge variant="outline" className={cn(String(task.status || '').toLowerCase() === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200')}>
                  {task.status || 'open'}
                </Badge>
                <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                  {task.assignedUser?.name || task.assignedUser?.email || 'Unassigned'}
                </Badge>
                {dueLabel ? (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    Due {dueLabel}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-zinc-50 text-zinc-700 border-zinc-200">
                    No due date
                  </Badge>
                )}
                <Badge variant="outline" className={cn(String(task.reminderMode || 'default') === 'off' ? 'bg-zinc-50 text-zinc-700 border-zinc-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                  Reminders: {task.reminderMode || 'default'}
                </Badge>
              </div>

              {task.description ? (
                <div className="rounded-lg border bg-slate-50 px-4 py-3 whitespace-pre-wrap text-slate-700">
                  {task.description}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="font-semibold">Contact</div>
                  <div>{task.contact?.name || 'Unknown contact'}</div>
                  {task.contact?.email ? <div className="text-muted-foreground">{task.contact.email}</div> : null}
                  {task.contact?.phone ? <div className="text-muted-foreground">{task.contact.phone}</div> : null}
                  {task.contact?.id ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/admin/contacts/${task.contact.id}/view`}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open contact
                      </Link>
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-lg border p-4">
                  <div className="font-semibold">Conversation</div>
                  {task.conversation?.ghlConversationId ? (
                    <>
                      <div className="text-muted-foreground">Linked conversation available for this task.</div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenConversation?.(task.conversation.ghlConversationId)}
                        >
                          Open in workspace
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/conversations?id=${encodeURIComponent(task.conversation.ghlConversationId)}`}>
                            Full page
                          </Link>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">No linked conversation.</div>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="font-semibold">Reminder schedule</div>
                {pendingReminderJobs.length === 0 ? (
                  <div className="text-muted-foreground">
                    {String(task.reminderMode || 'default') === 'off'
                      ? 'This task has reminders turned off.'
                      : !task.assignedUserId
                        ? 'No reminders until assigned.'
                        : !task.dueAt
                          ? 'No reminders until a due date is set.'
                          : 'No pending reminder jobs found.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingReminderJobs.map((job: any) => (
                      <div key={job.id} className="rounded-md border px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn(getReminderStatusTone(job.status || 'pending'))}>
                            {job.status}
                          </Badge>
                          <span className="font-medium">{reminderOffsetLabel(Number(job.offsetMinutes || 0))}</span>
                          <span className="text-muted-foreground">
                            {formatDateTime(job.scheduledFor, assigneeTimeZone)}
                          </span>
                        </div>
                        {job.notification?.deliveries?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {job.notification.deliveries.map((delivery: any) => (
                              <Badge key={`${job.id}-${delivery.channel}`} variant="outline">
                                {delivery.channel}: {delivery.status}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        {job.lastError ? (
                          <div className="mt-2 text-xs text-red-600">{job.lastError}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="font-semibold">Provider sync</div>
                <div className="flex flex-wrap gap-2">
                  {(task.syncRecords || []).map((record: any) => (
                    <Badge key={`${record.provider}-${record.status}`} variant="outline">
                      {record.provider}: {record.status}
                    </Badge>
                  ))}
                  {(task.syncRecords || []).length === 0 ? (
                    <span className="text-muted-foreground">No provider sync records yet.</span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2 rounded-lg border p-4 text-xs text-muted-foreground md:grid-cols-2">
                <div>Created: {createdAtLabel || 'Unknown'}</div>
                <div>Updated: {updatedAtLabel || 'Unknown'}</div>
                <div>Completed: {completedAtLabel || 'Not completed'}</div>
                <div>Created by: {task.createdByUser?.name || task.createdByUser?.email || 'Unknown'}</div>
                <div>Updated by: {task.updatedByUser?.name || task.updatedByUser?.email || 'Unknown'}</div>
              </div>
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditorOpen(true)}
                disabled={!task?.id || busy || loading}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleToggleComplete}
                disabled={!task?.id || busy || loading}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {String(task?.status || '').toLowerCase() === 'completed' ? 'Reopen' : 'Mark done'}
              </Button>
            </div>

            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={!task?.id || busy || loading}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode="edit"
        task={task}
        contactId={task?.contactId}
        conversationId={task?.conversationId}
        onSaved={() => {
          if (!task?.id) return;
          onTaskMutated?.(task.id);
          getTaskDetail(task.id).then((result) => {
            if (result?.success) {
              setTask(result.task);
            }
          });
        }}
      />
    </>
  );
}
