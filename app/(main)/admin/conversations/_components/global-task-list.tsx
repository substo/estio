'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Circle, Clock3, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TaskDetailDialog } from '@/components/tasks/task-detail-dialog';
import { TaskEditorDialog } from '@/components/tasks/task-editor-dialog';
import { cn } from '@/lib/utils';
import {
  deleteContactTask,
  listLocationTasks,
  setContactTaskCompletion,
} from '@/app/(main)/admin/tasks/actions';

type GlobalTaskListProps = {
  selectedConversationId?: string | null;
  onSelectConversation: (id: string) => void;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string | null, conversationId?: string | null) => void;
};

function formatDueLabel(input?: Date | string | null) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'MMM d, h:mm a');
}

function getPriorityTone(priority: string) {
  if (priority === 'high') return 'bg-red-100 text-red-700 border-red-200';
  if (priority === 'low') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function getUrgencyColors(dueAt: Date | string | null) {
  if (!dueAt) return 'bg-slate-50 text-slate-700 border-slate-200';

  const date = new Date(dueAt);
  const now = new Date();

  if (date < now) {
    return 'bg-red-50 text-red-700 border-red-200';
  }

  if (date.toDateString() === now.toDateString()) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }

  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function GlobalTaskList({
  selectedConversationId,
  onSelectConversation,
  selectedTaskId = null,
  onSelectTask,
}: GlobalTaskListProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTaskIds, setBusyTaskIds] = useState<Record<string, boolean>>({});
  const [editorTask, setEditorTask] = useState<any | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listLocationTasks('open');
      if (res.success && res.tasks) {
        setTasks(res.tasks);
      }
    } catch (error) {
      console.error('Failed to load global tasks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();

    const debounceRef = { timer: null as ReturnType<typeof setTimeout> | null };
    const handleMutated = () => {
      if (debounceRef.timer) clearTimeout(debounceRef.timer);
      debounceRef.timer = setTimeout(() => void loadTasks(), 300);
    };

    window.addEventListener('estio-tasks-mutated', handleMutated);
    return () => {
      window.removeEventListener('estio-tasks-mutated', handleMutated);
      if (debounceRef.timer) clearTimeout(debounceRef.timer);
    };
  }, [loadTasks]);

  const handleToggleComplete = async (event: React.MouseEvent, taskId: string, completed: boolean) => {
    event.stopPropagation();

    // Optimistic: remove from list immediately
    const previousTasks = tasks;
    if (completed) {
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      if (selectedTaskId === taskId) {
        onSelectTask?.(null);
      }
    }

    setBusyTaskIds((prev) => ({ ...prev, [taskId]: true }));

    try {
      const res = await setContactTaskCompletion(taskId, completed);
      if (!res.success) {
        // Roll back on failure
        setTasks(previousTasks);
        return;
      }
      window.dispatchEvent(new Event('estio-tasks-mutated'));
    } catch (error) {
      console.error(error);
      // Roll back on error
      setTasks(previousTasks);
    } finally {
      setBusyTaskIds((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  };

  const handleDelete = async (event: React.MouseEvent, taskId: string) => {
    event.stopPropagation();

    // Optimistic: remove from list immediately
    const previousTasks = tasks;
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    if (selectedTaskId === taskId) {
      onSelectTask?.(null);
    }

    setBusyTaskIds((prev) => ({ ...prev, [taskId]: true }));
    try {
      const res = await deleteContactTask(taskId);
      if (!res.success) {
        // Roll back on failure
        setTasks(previousTasks);
        return;
      }
      window.dispatchEvent(new Event('estio-tasks-mutated'));
    } catch (error) {
      console.error(error);
      // Roll back on error
      setTasks(previousTasks);
    } finally {
      setBusyTaskIds((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading Tasks...
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground text-sm">
        No open tasks in this location.
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {tasks.map((task) => {
          const convId =
            task.conversation?.ghlConversationId
            || task.contact?.conversations?.[0]?.ghlConversationId
            || null;
          const isConversationSelected = convId === selectedConversationId;
          const isTaskSelected = task.id === selectedTaskId;
          const isBusy = !!busyTaskIds[task.id];
          const dueLabel = formatDueLabel(task.dueAt);

          return (
            <div
              key={task.id}
              onClick={() => {
                if (convId) {
                  onSelectConversation(convId);
                }
                onSelectTask?.(task.id, convId);
              }}
              className={cn(
                'p-3 border-b cursor-pointer transition-colors hover:bg-slate-50 relative group',
                (isConversationSelected || isTaskSelected) && 'bg-slate-50 border-l-4 border-l-blue-600 pl-2',
                !(isConversationSelected || isTaskSelected) && 'border-l-4 border-l-transparent pl-2',
                isBusy && 'opacity-60 pointer-events-none'
              )}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors"
                  onClick={(event) => handleToggleComplete(event, task.id, true)}
                  disabled={isBusy}
                >
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <div className="font-semibold text-sm truncate pr-1">
                      {task.title}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditorTask(task);
                        }}
                        title="Edit task"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                        onClick={(event) => handleDelete(event, task.id)}
                        title="Delete task"
                        disabled={isBusy}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                    {task.contact?.name || task.contact?.firstName || 'Unknown Contact'}
                  </div>

                  {task.description ? (
                    <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                      {task.description}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {dueLabel ? (
                      <Badge variant="outline" className={cn('text-[10px] h-5 py-0', getUrgencyColors(task.dueAt))}>
                        <Clock3 className="w-3 h-3 mr-1 shrink-0" />
                        <span className="truncate max-w-[120px]">{dueLabel}</span>
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className={cn('text-[10px] h-5 py-0 capitalize', getPriorityTone(task.priority || 'medium'))}>
                      {task.priority || 'medium'}
                    </Badge>
                    {task.assignedUser?.name || task.assignedUser?.email ? (
                      <Badge variant="outline" className="text-[10px] h-5 py-0 bg-violet-50 text-violet-700 border-violet-200">
                        {task.assignedUser?.name || task.assignedUser?.email}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] h-5 py-0 bg-zinc-50 text-zinc-700 border-zinc-200">
                        Unassigned
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <TaskEditorDialog
        open={!!editorTask}
        onOpenChange={(open) => {
          if (!open) setEditorTask(null);
        }}
        mode="edit"
        task={editorTask}
        onSaved={() => {
          setEditorTask(null);
          window.dispatchEvent(new Event('estio-tasks-mutated'));
          void loadTasks();
        }}
      />

      <TaskDetailDialog
        taskId={selectedTaskId}
        open={!!selectedTaskId}
        onOpenChange={(open) => {
          if (!open) {
            onSelectTask?.(null, selectedConversationId || null);
          }
        }}
        onTaskMutated={(taskId) => {
          window.dispatchEvent(new Event('estio-tasks-mutated'));
          if (selectedTaskId === taskId) {
            onSelectTask?.(null, selectedConversationId || null);
          }
        }}
        onOpenConversation={(conversationId) => {
          onSelectConversation(conversationId);
          onSelectTask?.(selectedTaskId, conversationId);
        }}
      />
    </>
  );
}
