'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { createContactTask, listTaskAssignableUsers, updateContactTask } from '@/app/(main)/admin/tasks/actions';
import { AVAILABLE_TASK_REMINDER_OFFSETS_MINUTES, DEFAULT_TASK_REMINDER_OFFSETS_MINUTES, normalizeReminderOffsets, reminderOffsetLabel } from '@/lib/tasks/reminder-config';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type ReminderMode = 'default' | 'custom' | 'off';
type TaskPriority = 'low' | 'medium' | 'high';

type TaskEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  contactId?: string;
  conversationId?: string | null;
  task?: any | null;
  onSaved?: (task: any) => void;
};

function toDateTimeLocalValue(input?: Date | string | null) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTaskReminderMode(task: any): ReminderMode {
  const value = String(task?.reminderMode || 'default').toLowerCase();
  if (value === 'custom' || value === 'off') return value;
  return 'default';
}

export function TaskEditorDialog({
  open,
  onOpenChange,
  mode,
  contactId,
  conversationId,
  task,
  onSaved,
}: TaskEditorDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignedUserId, setAssignedUserId] = useState<string>('unassigned');
  const [reminderMode, setReminderMode] = useState<ReminderMode>('default');
  const [customOffsets, setCustomOffsets] = useState<number[]>([...DEFAULT_TASK_REMINDER_OFFSETS_MINUTES]);
  const [saving, setSaving] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<Array<{
    id: string;
    name: string | null;
    email: string;
    timeZone: string | null;
    effectiveTimeZone: string;
  }>>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUsersLoading(true);
    listTaskAssignableUsers()
      .then((result) => {
        if (cancelled || !result?.success) return;
        setUsers(result.users || []);
        setCurrentUserId(result.currentUserId || null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load assignable users:', error);
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && task) {
      setTitle(String(task.title || ''));
      setDescription(String(task.description || ''));
      setDueAt(toDateTimeLocalValue(task.dueAt));
      setPriority((task.priority || 'medium') as TaskPriority);
      setAssignedUserId(task.assignedUserId || 'unassigned');
      setReminderMode(parseTaskReminderMode(task));
      setCustomOffsets(normalizeReminderOffsets(task.reminderOffsets));
      return;
    }

    setTitle('');
    setDescription('');
    setDueAt('');
    setPriority('medium');
    setAssignedUserId(currentUserId || 'unassigned');
    setReminderMode('default');
    setCustomOffsets([...DEFAULT_TASK_REMINDER_OFFSETS_MINUTES]);
  }, [open, mode, task, currentUserId]);

  const canSave = useMemo(() => title.trim().length > 0 && !saving, [title, saving]);
  const remindersEligible = Boolean(dueAt && assignedUserId && assignedUserId !== 'unassigned' && reminderMode !== 'off');

  function toggleCustomOffset(offsetMinutes: number, checked: boolean) {
    setCustomOffsets((prev) => {
      const next = checked
        ? normalizeReminderOffsets([...prev, offsetMinutes])
        : prev.filter((value) => value !== offsetMinutes);
      return next;
    });
  }

  async function handleSave() {
    if (!canSave) return;

    setSaving(true);
    const reminderOffsets = reminderMode === 'custom'
      ? normalizeReminderOffsets(customOffsets)
      : undefined;

    try {
      const result = mode === 'edit' && task?.id
        ? await updateContactTask({
            taskId: task.id,
            title: title.trim(),
            description: description.trim() || undefined,
            dueAt: dueAt || null,
            priority,
            assignedUserId: assignedUserId === 'unassigned' ? null : assignedUserId,
            reminderMode,
            reminderOffsets,
          })
        : await createContactTask({
            contactId,
            conversationId: conversationId || undefined,
            title: title.trim(),
            description: description.trim() || undefined,
            dueAt: dueAt || undefined,
            priority,
            assignedUserId: assignedUserId === 'unassigned' ? undefined : assignedUserId,
            reminderMode,
            reminderOffsets,
            source: 'manual',
          });

      if (!result?.success) {
        toast.error(String(result?.error || 'Failed to save task'));
        return;
      }

      onSaved?.(result.task);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to save task:', error);
      toast.error(error?.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  }

  const selectedAssignee = users.find((candidate) => candidate.id === assignedUserId);
  const assigneeTimeZone = selectedAssignee?.effectiveTimeZone || null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (saving && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit Task' : 'Add Task'}</DialogTitle>
          <DialogDescription>
            Save the task locally first, then the sync engine updates connected providers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Call landlord about updated documents"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional extra context for the assignee"
              className="min-h-[110px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-due-at">Due at</Label>
              <Input
                id="task-due-at"
                type="datetime-local"
                step={300}
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assigned user</Label>
            <Select value={assignedUserId} onValueChange={setAssignedUserId}>
              <SelectTrigger>
                <SelectValue placeholder={usersLoading ? 'Loading users...' : 'Select assignee'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {(candidate.name || candidate.email)}{candidate.effectiveTimeZone ? ` (${candidate.effectiveTimeZone})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="space-y-1">
              <Label>Reminders</Label>
              <p className="text-xs text-muted-foreground">
                Reminders are created only when the task has both an assignee and a due date.
              </p>
            </div>

            <Select value={reminderMode} onValueChange={(value) => setReminderMode(value as ReminderMode)}>
              <SelectTrigger>
                <SelectValue placeholder="Reminder mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Use my default reminders</SelectItem>
                <SelectItem value="custom">Custom reminder schedule</SelectItem>
                <SelectItem value="off">No reminders for this task</SelectItem>
              </SelectContent>
            </Select>

            {reminderMode === 'custom' && (
              <div className="grid gap-2 sm:grid-cols-2">
                {AVAILABLE_TASK_REMINDER_OFFSETS_MINUTES.map((offsetMinutes) => {
                  const checked = customOffsets.includes(offsetMinutes);
                  return (
                    <label key={offsetMinutes} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => toggleCustomOffset(offsetMinutes, nextChecked === true)}
                      />
                      <span>{reminderOffsetLabel(offsetMinutes)}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {reminderMode === 'off'
                ? 'This task will not generate deadline reminders.'
                : !dueAt
                  ? 'Reminders start after you set a due date.'
                  : assignedUserId === 'unassigned'
                    ? 'No reminders until assigned.'
                    : `Reminder recipient: ${selectedAssignee?.name || selectedAssignee?.email || 'Assigned user'}${assigneeTimeZone ? ` • ${assigneeTimeZone}` : ''}`}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : mode === 'edit' ? (
              <Save className="mr-2 h-4 w-4" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {mode === 'edit' ? 'Save changes' : 'Create task'}
          </Button>
        </DialogFooter>

        {remindersEligible ? null : (
          <div className="text-[11px] text-muted-foreground">
            Reminders remain unscheduled until both an assignee and a due date are present.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
