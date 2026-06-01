import { format } from 'date-fns';

export type TaskCounts = {
  all: number;
  open: number;
  completed: number;
};

export function formatTaskDueLabel(input?: Date | string | null, pattern = 'PPp') {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, pattern);
}

export function getTaskPriorityTone(priority: string) {
  if (priority === 'high') return 'bg-red-100 text-red-700 border-red-200';
  if (priority === 'low') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

export function getTaskUrgencyTone(dueAt: Date | string | null) {
  if (!dueAt) return 'bg-slate-50 text-slate-700 border-slate-200';

  const date = new Date(dueAt);
  const now = new Date();

  if (date < now) return 'bg-red-50 text-red-700 border-red-200';
  if (date.toDateString() === now.toDateString()) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function normalizeTask(task: any) {
  return {
    ...task,
    syncRecords: Array.isArray(task?.syncRecords) ? task.syncRecords : [],
    outboxJobs: Array.isArray(task?.outboxJobs) ? task.outboxJobs : [],
  };
}

export function isCompletedTask(task: any) {
  return String(task?.status || '').toLowerCase() === 'completed';
}

function clampCount(value: number) {
  return Math.max(0, value);
}

export function decrementTaskCounts(prev: TaskCounts, task: any): TaskCounts {
  const completed = isCompletedTask(task);
  return {
    all: clampCount(prev.all - 1),
    open: completed ? prev.open : clampCount(prev.open - 1),
    completed: completed ? clampCount(prev.completed - 1) : prev.completed,
  };
}

export function transitionCompletionCounts(prev: TaskCounts, toCompleted: boolean): TaskCounts {
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
