'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Loader2, CheckCircle2, Circle, Clock3, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
    listLocationTasks,
    setContactTaskCompletion,
    updateContactTask,
    deleteContactTask,
} from '@/app/(main)/admin/tasks/actions';

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

function formatDatetimeLocal(input?: Date | string | null) {
    if (!input) return '';
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    // Format as YYYY-MM-DDTHH:mm for datetime-local input
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

    // Edit dialog state
    const [editTask, setEditTask] = useState<any | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editDueAt, setEditDueAt] = useState('');
    const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');
    const [saving, setSaving] = useState(false);

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
                window.dispatchEvent(new Event('estio-tasks-mutated'));
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

    const openEditDialog = (e: React.MouseEvent, task: any) => {
        e.stopPropagation();
        setEditTask(task);
        setEditTitle(task.title || '');
        setEditDescription(task.description || '');
        setEditDueAt(formatDatetimeLocal(task.dueAt));
        setEditPriority(task.priority || 'medium');
    };

    const handleSaveEdit = async () => {
        if (!editTask || !editTitle.trim()) return;
        setSaving(true);
        try {
            const res = await updateContactTask({
                taskId: editTask.id,
                title: editTitle.trim(),
                description: editDescription.trim() || undefined,
                dueAt: editDueAt || null,
                priority: editPriority,
            });
            if (res.success) {
                setEditTask(null);
                window.dispatchEvent(new Event('estio-tasks-mutated'));
                await loadTasks();
            }
        } catch (e) {
            console.error("Failed to update task:", e);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, taskId: string) => {
        e.stopPropagation();
        setBusyTaskIds(prev => ({ ...prev, [taskId]: true }));
        try {
            const res = await deleteContactTask(taskId);
            if (res.success) {
                setTasks(prev => prev.filter(t => t.id !== taskId));
                window.dispatchEvent(new Event('estio-tasks-mutated'));
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
        <>
            <div className="flex-1 overflow-y-auto">
                {tasks.map((task) => {
                    const convId =
                        task.conversation?.ghlConversationId
                        || task.contact?.conversations?.[0]?.ghlConversationId;
                    const isSelected = convId === selectedConversationId;
                    const isBusy = !!busyTaskIds[task.id];
                    const dueLabel = formatDueLabel(task.dueAt);

                    return (
                        <div
                            key={task.id}
                            onClick={() => {
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
                                    <div className="flex items-start justify-between gap-1">
                                        <div className="font-semibold text-sm truncate pr-1">
                                            {task.title}
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                                                onClick={(e) => openEditDialog(e, task)}
                                                title="Edit task"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                                                onClick={(e) => handleDelete(e, task.id)}
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

                                    {task.description && (
                                        <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                                            {task.description}
                                        </div>
                                    )}

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

            {/* Edit Task Dialog */}
            <Dialog
                open={!!editTask}
                onOpenChange={(open) => {
                    if (!open && !saving) setEditTask(null);
                }}
            >
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                        <DialogTitle>Edit Task</DialogTitle>
                        <DialogDescription>
                            Update task details. Changes sync to connected providers.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-slate-700 mb-1 block">Title</label>
                            <Input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                placeholder="Task title"
                                className="h-9 text-sm"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-700 mb-1 block">Description</label>
                            <Textarea
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                placeholder="Optional description"
                                className="min-h-[80px] text-sm"
                            />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="text-xs font-medium text-slate-700 mb-1 block">Due Date</label>
                                <Input
                                    type="datetime-local"
                                    value={editDueAt}
                                    onChange={(e) => setEditDueAt(e.target.value)}
                                    className="h-9 text-xs"
                                />
                            </div>
                            <div className="w-[130px]">
                                <label className="text-xs font-medium text-slate-700 mb-1 block">Priority</label>
                                <Select value={editPriority} onValueChange={(v) => setEditPriority(v as any)}>
                                    <SelectTrigger className="h-9 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="low">Low</SelectItem>
                                        <SelectItem value="medium">Medium</SelectItem>
                                        <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setEditTask(null)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={saving || !editTitle.trim()}
                        >
                            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
