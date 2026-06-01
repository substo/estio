'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Circle, Clock3, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TaskDetailDialog } from '@/components/tasks/task-detail-dialog';
import { TaskEditorDialog } from '@/components/tasks/task-editor-dialog';
import { notifyTasksMutated, useTasksMutatedRefresh } from '@/components/tasks/task-list-events';
import { formatTaskDueLabel, getTaskPriorityTone, getTaskUrgencyTone } from '@/components/tasks/task-list-utils';
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

export function GlobalTaskList({
  selectedConversationId,
  onSelectConversation,
  selectedTaskId = null,
  onSelectTask,
}: GlobalTaskListProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTaskIds, setBusyTaskIds] = useState<Record<string, boolean>>({});
  const [editorTask, setEditorTask] = useState<any | null>(null);
  const loadRequestIdRef = useRef(0);

  const loadTasks = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const requestId = ++loadRequestIdRef.current;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await listLocationTasks('open', {
        includeCounts: false,
        includeProviderState: false,
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (res.success && res.tasks) {
        setTasks(res.tasks);
      }
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      console.error('Failed to load global tasks:', error);
    } finally {
      if (requestId !== loadRequestIdRef.current) return;
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const refreshTasksOnMutation = useCallback(() => void loadTasks({ silent: true }), [loadTasks]);
  useTasksMutatedRefresh(refreshTasksOnMutation);

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
      notifyTasksMutated();
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
      notifyTasksMutated();
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
      <div className="flex-1 min-h-0 overflow-y-auto">
        {refreshing ? (
          <div className="sticky top-0 z-10 flex justify-end bg-background/75 px-3 py-1 backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {tasks.map((task) => {
          const convId =
            task.conversation?.id
            || task.contact?.conversations?.[0]?.id
            || null;
          const isConversationSelected = convId === selectedConversationId;
          const isTaskSelected = task.id === selectedTaskId;
          const isBusy = !!busyTaskIds[task.id];
          const dueLabel = formatTaskDueLabel(task.dueAt, 'MMM d, h:mm a');

          return (
            <div
              key={task.id}
              onClick={() => {
                if (convId) {
                  onSelectConversation(convId);
                }
                setTimeout(() => onSelectTask?.(task.id, convId), 0);
              }}
              className={cn(
                'p-3 border-b cursor-pointer transition-colors hover:bg-slate-50 relative group',
                isTaskSelected && 'bg-slate-50 border-l-4 border-l-blue-600 pl-2',
                !isTaskSelected && 'border-l-4 border-l-transparent pl-2',
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
                      <Badge variant="outline" className={cn('text-[10px] h-5 py-0', getTaskUrgencyTone(task.dueAt))}>
                        <Clock3 className="w-3 h-3 mr-1 shrink-0" />
                        <span className="truncate max-w-[120px]">{dueLabel}</span>
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className={cn('text-[10px] h-5 py-0 capitalize', getTaskPriorityTone(task.priority || 'medium'))}>
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
          notifyTasksMutated();
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
          notifyTasksMutated();
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
