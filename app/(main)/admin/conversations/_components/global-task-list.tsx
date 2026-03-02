'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Loader2, CheckCircle2, Circle, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { listLocationTasks, setContactTaskCompletion } from '@/app/(main)/admin/tasks/actions';

type GlobalTaskListProps = {
    selectedConversationId?: string | null;
    onSelectConversation: (id: string) => void;
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

    // Past due
    if (date < now) {
        return 'bg-red-50 text-red-700 border-red-200';
    }

    // Due today
    if (date.toDateString() === now.toDateString()) {
        return 'bg-amber-50 text-amber-700 border-amber-200';
    }

    return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function GlobalTaskList({ selectedConversationId, onSelectConversation }: GlobalTaskListProps) {
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyTaskIds, setBusyTaskIds] = useState<Record<string, boolean>>({});

    const loadTasks = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listLocationTasks('open');
            if (res.success && res.tasks) {
                setTasks(res.tasks);
            }
        } catch (e) {
            console.error("Failed to load global tasks:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTasks();

        const handleMutated = () => {
            loadTasks();
        };

        window.addEventListener('estio-tasks-mutated', handleMutated);
        return () => window.removeEventListener('estio-tasks-mutated', handleMutated);
    }, [loadTasks]);

    const handleToggleComplete = async (e: React.MouseEvent, taskId: string, isCompleted: boolean) => {
        e.stopPropagation(); // prevent row click
        setBusyTaskIds(prev => ({ ...prev, [taskId]: true }));

        try {
            const res = await setContactTaskCompletion(taskId, isCompleted);
            if (res.success) {
                if (isCompleted) {
                    // Remove from open list
                    setTasks(prev => prev.filter(t => t.id !== taskId));
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setBusyTaskIds(prev => {
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
        <div className="flex-1 overflow-y-auto">
            {tasks.map((task) => {
                const isSelected = task.conversation?.id === selectedConversationId;
                const isBusy = !!busyTaskIds[task.id];
                const dueLabel = formatDueLabel(task.dueAt);

                return (
                    <div
                        key={task.id}
                        onClick={() => {
                            const convId =
                                task.conversation?.ghlConversationId
                                || task.contact?.conversations?.[0]?.ghlConversationId;
                            if (convId) {
                                onSelectConversation(convId);
                            }
                        }}
                        className={cn(
                            "p-3 border-b cursor-pointer transition-colors hover:bg-slate-50 relative group",
                            isSelected && "bg-slate-50 border-l-4 border-l-blue-600 pl-2",
                            !isSelected && "border-l-4 border-l-transparent pl-2",
                            isBusy && "opacity-60 pointer-events-none"
                        )}
                    >
                        <div className="flex items-start gap-3">
                            <button
                                type="button"
                                className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors"
                                onClick={(e) => handleToggleComplete(e, task.id, true)}
                                disabled={isBusy}
                            >
                                {isBusy ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Circle className="w-4 h-4" />
                                )}
                            </button>

                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm truncate pr-2">
                                    {task.title}
                                </div>
                                <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                                    {task.contact?.name || task.contact?.firstName || 'Unknown Contact'}
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    {dueLabel && (
                                        <Badge variant="outline" className={cn("text-[10px] h-5 py-0", getUrgencyColors(task.dueAt))}>
                                            <Clock3 className="w-3 h-3 mr-1 shrink-0" />
                                            <span className="truncate max-w-[120px]">{dueLabel}</span>
                                        </Badge>
                                    )}
                                    <Badge variant="outline" className={cn("text-[10px] h-5 py-0 capitalize", getPriorityTone(task.priority || 'medium'))}>
                                        {task.priority || 'medium'}
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
