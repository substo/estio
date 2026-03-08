"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Loader2, Search, Clipboard, MessageCircle, BadgeAlert, AlertTriangle, User, Phone, Mail, ExternalLink, FileText, Wand2, ListPlus, Trash2, ListTodo, Sparkles, Home } from "lucide-react";
import { toast } from "sonner";
import {
    applySuggestedTasksFromSelection,
    parseLeadFromText,
    createParsedLead,
    suggestTasksFromSelection,
    summarizeSelectionToCrmLog,
    runCustomSelectionPrompt,
    saveCustomSelectionToCrmLog,
    type ParsedLeadData,
    type LeadAnalysisTrace,
    type SelectionTaskSuggestion,
    suggestViewingsFromSelection,
} from "@/app/(main)/admin/conversations/actions";
import { openOrStartConversationForContact, searchContactsAction } from "@/app/(main)/admin/contacts/actions";
import { createContactTask } from "@/app/(main)/admin/tasks/actions";
import { cn } from "@/lib/utils";
import { TaskSuggestionFunnelMetrics } from "./task-suggestion-funnel-metrics";
import { ViewingsSuggestionDialog } from "./viewings-suggestion-dialog";

export type MessageSelectionActionTarget = {
    text: string;
    source: "message" | "email";
    rect: {
        top: number;
        left: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
};

export type SelectionBatchInput = {
    messageId?: string | null;
    text: string;
    source: "message" | "email";
};

export type SelectionBatchItem = SelectionBatchInput & {
    id: string;
    addedAt: number;
};

type ContactSearchResult = {
    id: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
    location?: { name?: string | null } | null;
    conversationId?: string | null;
    conversationStatus?: string | null;
    matchReason?: string | null;
};

type SuggestedTaskDraft = SelectionTaskSuggestion & {
    id: string;
    selected: boolean;
    dueAtInput: string;
};

interface MessageSelectionActionsProps {
    selection: MessageSelectionActionTarget | null;
    onClearSelection: () => void;
    conversationId?: string | null;
    aiModel?: string | null;
    messageId?: string;
    selectionBatch?: SelectionBatchItem[];
    onAddSelectionToBatch?: (item: SelectionBatchInput) => { added: boolean; total: number } | void;
    onRemoveSelectionBatchItem?: (id: string) => void;
    onClearSelectionBatch?: () => void;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function getConversationViewParam(status: string | null | undefined) {
    const s = String(status || "").toLowerCase();
    if (s === "archived") return "archived";
    if (s === "trash") return "trash";
    return null;
}

function getDisplayName(contact: ContactSearchResult) {
    if (contact.name) return contact.name;
    const combined = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
    return combined || contact.phone || contact.email || "Unnamed Contact";
}

function deriveSearchQueryFromSelection(text: string) {
    const raw = String(text || "").trim();
    if (!raw) return "";

    const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch?.[0]) return emailMatch[0];

    const phoneMatch = raw.match(/(?:\+?\d[\d\s().-]{5,}\d)/);
    if (phoneMatch?.[0]) return phoneMatch[0].trim();

    const firstLine = raw.split(/\n/).map((line) => line.trim()).find(Boolean) || raw;
    return firstLine.length > 80 ? firstLine.slice(0, 80).trim() : firstLine;
}

function getSelectionPreview(text: string) {
    const compact = String(text || "").replace(/\s+/g, " ").trim();
    if (compact.length <= 140) return compact;
    return `${compact.slice(0, 140)}...`;
}

function suggestTaskTitleFromSelection(text: string) {
    const compact = String(text || "").replace(/\s+/g, " ").trim();
    if (!compact) return "Follow up with contact";

    const firstSentence = compact.split(/[.!?]/).find(Boolean)?.trim() || compact;
    const normalized = firstSentence.length > 100 ? `${firstSentence.slice(0, 100).trim()}...` : firstSentence;
    return normalized || "Follow up with contact";
}

function buildBatchContextText(items: SelectionBatchItem[]) {
    return items
        .map((item, index) => `Snippet ${index + 1}:\n${item.text}`)
        .join("\n\n");
}

function toDateTimeLocalValue(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function getCurrentDateTimeLocalValue() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export function MessageSelectionActions({
    selection,
    onClearSelection,
    conversationId,
    aiModel,
    messageId,
    selectionBatch = [],
    onAddSelectionToBatch,
    onRemoveSelectionBatchItem,
    onClearSelectionBatch,
}: MessageSelectionActionsProps) {
    const router = useRouter();
    const toolbarRef = useRef<HTMLDivElement>(null);
    const suggestGenerationRunIdRef = useRef(0);

    const [pasteLeadOpen, setPasteLeadOpen] = useState(false);
    const [findContactOpen, setFindContactOpen] = useState(false);

    const [leadText, setLeadText] = useState("");
    const [isAnalyzingLead, setIsAnalyzingLead] = useState(false);
    const [isImportingLead, setIsImportingLead] = useState(false);
    const [parsedLead, setParsedLead] = useState<ParsedLeadData | null>(null);
    const [leadAnalysisTrace, setLeadAnalysisTrace] = useState<LeadAnalysisTrace | undefined>(undefined);

    const [contactQuery, setContactQuery] = useState("");
    const [findContactSelectionPreview, setFindContactSelectionPreview] = useState("");
    const [contactResults, setContactResults] = useState<ContactSearchResult[]>([]);
    const [searchingContacts, setSearchingContacts] = useState(false);
    const [openingConversationContactId, setOpeningConversationContactId] = useState<string | null>(null);

    const [createTaskOpen, setCreateTaskOpen] = useState(false);
    const [taskTitle, setTaskTitle] = useState("");
    const [taskDescription, setTaskDescription] = useState("");
    const [isCreatingTask, setIsCreatingTask] = useState(false);

    const [suggestTasksOpen, setSuggestTasksOpen] = useState(false);
    const [suggestSelectionText, setSuggestSelectionText] = useState("");
    const [taskSuggestions, setTaskSuggestions] = useState<SuggestedTaskDraft[]>([]);
    const [isSuggestingTasks, setIsSuggestingTasks] = useState(false);
    const [isApplyingSuggestedTasks, setIsApplyingSuggestedTasks] = useState(false);

    const [suggestViewingsOpen, setSuggestViewingsOpen] = useState(false);

    const [summarizeOpen, setSummarizeOpen] = useState(false);
    const [summarizeSelectionText, setSummarizeSelectionText] = useState("");
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summarySavedEntry, setSummarySavedEntry] = useState("");

    const [customOpen, setCustomOpen] = useState(false);
    const [customSelectionText, setCustomSelectionText] = useState("");
    const [customInstruction, setCustomInstruction] = useState("");
    const [customOutput, setCustomOutput] = useState("");
    const [isRunningCustom, setIsRunningCustom] = useState(false);
    const [isSavingCustom, setIsSavingCustom] = useState(false);
    const [customSavedEntry, setCustomSavedEntry] = useState("");
    const activeAiModel = typeof aiModel === "string" && aiModel.trim() ? aiModel.trim() : undefined;
    const hasBatchSelections = selectionBatch.length > 0;
    const batchContextText = hasBatchSelections ? buildBatchContextText(selectionBatch) : "";
    const selectedSuggestionCount = taskSuggestions.filter((item) => item.selected).length;

    const selectionVisible = !!selection && !pasteLeadOpen && !findContactOpen && !createTaskOpen && !suggestTasksOpen && !summarizeOpen && !customOpen;

    useEffect(() => {
        if (!selectionVisible) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && toolbarRef.current?.contains(target)) return;
            onClearSelection();
        };

        const clear = () => onClearSelection();

        document.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("resize", clear);
        window.addEventListener("scroll", clear, true);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("resize", clear);
            window.removeEventListener("scroll", clear, true);
        };
    }, [selectionVisible, onClearSelection]);

    useEffect(() => {
        if (!findContactOpen) return;
        const query = String(contactQuery || "").trim();
        if (query.length < 2) {
            setContactResults([]);
            setSearchingContacts(false);
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            setSearchingContacts(true);
            try {
                const results = await searchContactsAction(query);
                if (!cancelled) {
                    setContactResults((results || []) as ContactSearchResult[]);
                }
            } catch (error: any) {
                if (!cancelled) {
                    console.error("[SelectionActions] contact search failed", error);
                    toast.error(error?.message || "Failed to search contacts");
                    setContactResults([]);
                }
            } finally {
                if (!cancelled) setSearchingContacts(false);
            }
        }, 180);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [findContactOpen, contactQuery]);

    const openPasteLeadDialog = () => {
        if (!selection?.text?.trim()) return;
        setLeadText(selection.text.trim());
        setParsedLead(null);
        setLeadAnalysisTrace(undefined);
        setPasteLeadOpen(true);
        onClearSelection();
    };

    const openFindContactDialog = () => {
        if (!selection?.text?.trim()) return;
        const seed = deriveSearchQueryFromSelection(selection.text);
        setContactQuery(seed);
        setFindContactSelectionPreview(selection.text.trim());
        setContactResults([]);
        setFindContactOpen(true);
        onClearSelection();
    };

    const openCreateTaskDialog = () => {
        const text = String(selection?.text || "").trim();
        if (!text) return;

        setTaskTitle(suggestTaskTitleFromSelection(text));
        setTaskDescription(text);
        setCreateTaskOpen(true);
        onClearSelection();
    };

    const openSuggestTasksDialog = () => {
        const text = hasBatchSelections
            ? batchContextText
            : String(selection?.text || "").trim();
        if (!text) return;

        setSuggestSelectionText(text);
        setTaskSuggestions([]);
        setSuggestTasksOpen(true);
        void handleGenerateTaskSuggestions(text, false);
        if (selection?.text?.trim()) onClearSelection();
    };

    const openSuggestViewingsDialog = () => {
        const text = hasBatchSelections
            ? batchContextText
            : String(selection?.text || "").trim();
        if (!text) return;

        setSuggestSelectionText(text);
        setSuggestViewingsOpen(true);
        if (selection?.text?.trim()) onClearSelection();
    };

    const openSummarizeDialog = () => {
        const text = hasBatchSelections
            ? batchContextText
            : String(selection?.text || "").trim();
        if (!text) return;
        setSummarizeSelectionText(text);
        setSummarySavedEntry("");
        setSummarizeOpen(true);
        if (selection?.text?.trim()) onClearSelection();
    };

    const openCustomDialog = () => {
        const text = hasBatchSelections
            ? batchContextText
            : String(selection?.text || "").trim();
        if (!text) return;
        setCustomSelectionText(text);
        setCustomInstruction("");
        setCustomOutput("");
        setCustomSavedEntry("");
        setCustomOpen(true);
        if (selection?.text?.trim()) onClearSelection();
    };

    const handleAddSelectionToBatch = () => {
        if (!selection?.text?.trim() || !onAddSelectionToBatch) return;
        const result = onAddSelectionToBatch({
            messageId: messageId || null,
            text: selection.text.trim(),
            source: selection.source,
        });
        const added = !!result?.added;
        const total = typeof result?.total === "number" ? result.total : selectionBatch.length;
        if (added) {
            toast.success(`Added to summary batch (${total})`);
        } else {
            toast.message(`Selection already in batch (${total})`);
        }
        onClearSelection();
    };

    const handleAnalyzeLead = async () => {
        if (!leadText.trim()) return;
        setIsAnalyzingLead(true);
        try {
            const res = await parseLeadFromText(leadText, activeAiModel);
            if (!res.success || !res.data) {
                toast.error(res.error || "Failed to analyze selected text");
                return;
            }
            setParsedLead(res.data);
            setLeadAnalysisTrace(res.trace);
        } catch (error: any) {
            toast.error(error?.message || "Failed to analyze selected text");
        } finally {
            setIsAnalyzingLead(false);
        }
    };

    const handleImportLead = async () => {
        if (!parsedLead) return;
        setIsImportingLead(true);
        try {
            const res = await createParsedLead(parsedLead, leadText, leadAnalysisTrace);
            if (!res.success || !res.conversationId) {
                toast.error(res.error || "Failed to import lead");
                return;
            }

            toast.success("Lead imported");
            setPasteLeadOpen(false);
            router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
        } catch (error: any) {
            toast.error(error?.message || "Failed to import lead");
        } finally {
            setIsImportingLead(false);
        }
    };

    const handleCreateTaskFromSelection = async () => {
        if (!conversationId) {
            toast.error("Open a conversation first to create a contact task.");
            return;
        }
        if (!taskTitle.trim()) {
            toast.error("Task title is required.");
            return;
        }

        setIsCreatingTask(true);
        try {
            const res = await createContactTask({
                conversationId,
                title: taskTitle.trim(),
                description: taskDescription.trim() || undefined,
                priority: "medium",
                source: "ai_selection",
            });

            if (!res?.success) {
                toast.error(res?.error || "Failed to create task");
                return;
            }

            toast.success("Task created");
            window.dispatchEvent(new Event('estio-tasks-mutated'));
            setCreateTaskOpen(false);
        } catch (error: any) {
            toast.error(error?.message || "Failed to create task");
        } finally {
            setIsCreatingTask(false);
        }
    };

    const handleGenerateTaskSuggestions = async (
        selectionText?: string,
        showSuccessToast = true
    ) => {
        if (!conversationId) {
            toast.error("Open a conversation first to suggest tasks.");
            return;
        }
        const sourceText = String((selectionText ?? suggestSelectionText) || "").trim();
        if (!sourceText) {
            toast.error("Selected text is required.");
            return;
        }

        const runId = suggestGenerationRunIdRef.current + 1;
        suggestGenerationRunIdRef.current = runId;
        setIsSuggestingTasks(true);
        try {
            const res = await suggestTasksFromSelection(conversationId, sourceText, activeAiModel);
            if (suggestGenerationRunIdRef.current !== runId) return;
            if (!res?.success) {
                toast.error(res?.error || "Failed to generate task suggestions");
                return;
            }

            const suggestions = Array.isArray(res.suggestions) ? res.suggestions : [];
            const drafts: SuggestedTaskDraft[] = suggestions.map((suggestion, index) => ({
                id: `suggestion-${runId}-${index}`,
                selected: true,
                title: suggestion.title || "Follow up with contact",
                description: suggestion.description || "",
                priority: suggestion.priority || "medium",
                dueAt: suggestion.dueAt || null,
                dueAtInput: toDateTimeLocalValue(suggestion.dueAt) || getCurrentDateTimeLocalValue(),
                confidence: typeof suggestion.confidence === "number" ? suggestion.confidence : 0.5,
                reason: suggestion.reason || null,
            }));

            setTaskSuggestions(drafts);
            if (drafts.length === 0) {
                toast.message("No actionable tasks were suggested for this selection.");
            } else if (showSuccessToast) {
                toast.success(`Generated ${drafts.length} task suggestion${drafts.length > 1 ? "s" : ""}`);
            }
        } catch (error: any) {
            if (suggestGenerationRunIdRef.current !== runId) return;
            toast.error(error?.message || "Failed to generate task suggestions");
        } finally {
            if (suggestGenerationRunIdRef.current === runId) {
                setIsSuggestingTasks(false);
            }
        }
    };

    const handlePatchSuggestion = (id: string, patch: Partial<SuggestedTaskDraft>) => {
        setTaskSuggestions((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
    };

    const handleToggleAllSuggestions = (checked: boolean) => {
        setTaskSuggestions((prev) => prev.map((item) => ({ ...item, selected: checked })));
    };

    const handleApplySuggestedTasks = async () => {
        if (!conversationId) {
            toast.error("Open a conversation first to create contact tasks.");
            return;
        }

        const selected = taskSuggestions.filter((item) => item.selected && item.title.trim());
        if (selected.length === 0) {
            toast.error("Select at least one suggestion to create tasks.");
            return;
        }

        setIsApplyingSuggestedTasks(true);
        let created = 0;

        try {
            const res = await applySuggestedTasksFromSelection(
                conversationId,
                selected.map((suggestion) => ({
                    title: suggestion.title.trim(),
                    description: suggestion.description?.trim() || undefined,
                    dueAt: suggestion.dueAtInput || undefined,
                    priority: suggestion.priority,
                    confidence: suggestion.confidence,
                    reason: suggestion.reason || undefined,
                }))
            );

            if (!res?.success) {
                toast.error(res?.error || "Failed to create suggested tasks");
                return;
            }

            created = Math.max(0, Number(res.createdCount || 0));
            const failedCount = Math.max(0, Number(res.failedCount || 0));

            if (created > 0) {
                toast.success(`Created ${created} task${created > 1 ? "s" : ""} from suggestions`);
                window.dispatchEvent(new Event('estio-tasks-mutated'));
                setSuggestTasksOpen(false);
                if (hasBatchSelections) {
                    onClearSelectionBatch?.();
                }
            }

            if (failedCount > 0) {
                toast.error(`Failed to create ${failedCount} task${failedCount > 1 ? "s" : ""}`);
            }
        } catch (error: any) {
            toast.error(error?.message || "Failed to create suggested tasks");
        } finally {
            setIsApplyingSuggestedTasks(false);
        }
    };

    const handleSummarizeToCrmLog = async () => {
        if (!conversationId) {
            toast.error("Open a conversation first to save CRM logs.");
            return;
        }
        if (!summarizeSelectionText.trim()) return;

        setIsSummarizing(true);
        try {
            const res = await summarizeSelectionToCrmLog(conversationId, summarizeSelectionText, activeAiModel);
            if (!res?.success || !res?.entry) {
                toast.error(res?.error || "Failed to summarize and save to CRM log");
                return;
            }
            setSummarySavedEntry(res.entry);
            if (res?.skipped) {
                toast.message("No new info found. Skipped duplicate CRM log entry.");
            } else {
                toast.success("Summary saved to CRM log");
            }
            if (hasBatchSelections) {
                onClearSelectionBatch?.();
            }
        } catch (error: any) {
            toast.error(error?.message || "Failed to summarize and save to CRM log");
        } finally {
            setIsSummarizing(false);
        }
    };

    const handleRunCustomPrompt = async () => {
        if (!conversationId) {
            toast.error("Open a conversation first to run custom actions.");
            return;
        }
        if (!customSelectionText.trim()) return;
        if (!customInstruction.trim() || customInstruction.trim().length < 3) {
            toast.error("Type a short instruction for the custom action.");
            return;
        }

        setIsRunningCustom(true);
        try {
            const res = await runCustomSelectionPrompt(conversationId, customSelectionText, customInstruction, activeAiModel);
            if (!res?.success || !res?.output) {
                toast.error(res?.error || "Failed to run custom action");
                return;
            }
            setCustomOutput(res.output);
            setCustomSavedEntry("");
        } catch (error: any) {
            toast.error(error?.message || "Failed to run custom action");
        } finally {
            setIsRunningCustom(false);
        }
    };

    const handleSaveCustomToCrmLog = async () => {
        if (!conversationId) {
            toast.error("Open a conversation first to save CRM logs.");
            return;
        }
        if (!customOutput.trim()) {
            toast.error("Generate custom output first.");
            return;
        }

        setIsSavingCustom(true);
        try {
            const res = await saveCustomSelectionToCrmLog(conversationId, customOutput);
            if (!res?.success || !res?.entry) {
                toast.error(res?.error || "Failed to save custom output to CRM log");
                return;
            }
            setCustomSavedEntry(res.entry);
            if (res?.skipped) {
                toast.message("No new info found. Skipped duplicate CRM log entry.");
            } else {
                toast.success("Custom output saved to CRM log");
            }
            if (hasBatchSelections) {
                onClearSelectionBatch?.();
            }
        } catch (error: any) {
            toast.error(error?.message || "Failed to save custom output to CRM log");
        } finally {
            setIsSavingCustom(false);
        }
    };

    const handleOpenContact = (contactId: string) => {
        setFindContactOpen(false);
        router.push(`/admin/contacts/${contactId}/view`);
    };

    const handleOpenConversation = async (contact: ContactSearchResult) => {
        const existingConversationId = contact.conversationId || null;
        const existingView = getConversationViewParam(contact.conversationStatus);
        if (existingConversationId) {
            const query = new URLSearchParams({ id: existingConversationId });
            if (existingView) query.set("view", existingView);
            setFindContactOpen(false);
            router.push(`/admin/conversations?${query.toString()}`);
            return;
        }

        setOpeningConversationContactId(contact.id);
        try {
            const res = await openOrStartConversationForContact(contact.id);
            if (!res?.success || !res?.conversationId) {
                toast.error(res?.error || "Could not open conversation");
                return;
            }
            setFindContactOpen(false);
            router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
        } catch (error: any) {
            toast.error(error?.message || "Could not open conversation");
        } finally {
            setOpeningConversationContactId(null);
        }
    };

    const canUseCrmLogActions = !!conversationId;

    let toolbarNode: ReactNode = null;
    if (selectionVisible && selection && typeof document !== "undefined") {
        const centerX = selection.rect.left + (selection.rect.width / 2);
        const x = clamp(centerX, 16, window.innerWidth - 16);
        const showAbove = selection.rect.top > 80;
        const y = showAbove ? selection.rect.top - 8 : selection.rect.bottom + 8;

        toolbarNode = createPortal(
            <div
                ref={toolbarRef}
                className="fixed z-[80] pointer-events-auto"
                style={{
                    left: x,
                    top: y,
                    transform: showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
                }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1 shadow-lg">
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openPasteLeadDialog}
                    >
                        <Clipboard className="h-3.5 w-3.5" />
                        Paste Lead
                    </Button>
                    {onAddSelectionToBatch ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 px-2 text-xs"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={handleAddSelectionToBatch}
                            disabled={!selection?.text?.trim()}
                            title="Add this selection to a multi-message summary batch"
                        >
                            <ListPlus className="h-3.5 w-3.5" />
                            Add
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openFindContactDialog}
                    >
                        <Search className="h-3.5 w-3.5" />
                        Find Contact
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openCreateTaskDialog}
                        disabled={!canUseCrmLogActions}
                        title={canUseCrmLogActions ? "Create a contact task from this selection" : "Open a conversation to create tasks"}
                    >
                        <ListTodo className="h-3.5 w-3.5" />
                        Task
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openSuggestTasksDialog}
                        disabled={!canUseCrmLogActions}
                        title={canUseCrmLogActions ? "Generate AI task suggestions from this selection" : "Open a conversation to suggest tasks"}
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        Tasks
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openSuggestViewingsDialog}
                        disabled={!canUseCrmLogActions}
                        title={canUseCrmLogActions ? "Generate AI property viewing suggestions from this selection" : "Open a conversation to suggest viewings"}
                    >
                        <Home className="h-3.5 w-3.5" />
                        Viewings
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openSummarizeDialog}
                        disabled={!canUseCrmLogActions}
                        title={canUseCrmLogActions ? "Summarize selected text and save to CRM log" : "Open a conversation to save CRM logs"}
                    >
                        <FileText className="h-3.5 w-3.5" />
                        Summarize
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openCustomDialog}
                        disabled={!canUseCrmLogActions}
                        title={canUseCrmLogActions ? "Run custom AI prompt with selected text context" : "Open a conversation to run custom actions"}
                    >
                        <Wand2 className="h-3.5 w-3.5" />
                        Custom
                    </Button>
                </div>
            </div>,
            document.body
        );
    }

    return (
        <>
            {toolbarNode}

            <Dialog
                open={pasteLeadOpen}
                onOpenChange={(open) => {
                    setPasteLeadOpen(open);
                    if (!open) {
                        setIsAnalyzingLead(false);
                        setIsImportingLead(false);
                    }
                }}
            >
                <DialogContent className={cn("sm:max-w-lg", parsedLead && "sm:max-w-2xl")}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Clipboard className="h-4 w-4 text-indigo-600" />
                            Paste Lead From Selection
                        </DialogTitle>
                        <DialogDescription>
                            Analyze the selected text with the existing lead import flow, then review before importing.
                        </DialogDescription>
                    </DialogHeader>

                    {!parsedLead ? (
                        <div className="space-y-3">
                            <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                                <span className="font-medium text-slate-800">Selection:</span>{" "}
                                {getSelectionPreview(leadText)}
                            </div>
                            <Textarea
                                value={leadText}
                                onChange={(e) => setLeadText(e.target.value)}
                                className="min-h-[170px] font-mono text-sm"
                                placeholder="Selected text will appear here..."
                                disabled={isAnalyzingLead}
                            />
                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>Edit before analysis to remove signatures/disclaimers.</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="gap-2"
                                    onClick={handleAnalyzeLead}
                                    disabled={!leadText.trim() || isAnalyzingLead}
                                >
                                    {isAnalyzingLead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                                    Analyze Text
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Card className="p-3 bg-slate-50 space-y-1">
                                    <div className="text-xs font-medium text-gray-500 uppercase">Contact</div>
                                    <div className="font-medium text-sm">{parsedLead.contact?.name || "Unknown Name"}</div>
                                    <div className="text-sm">{parsedLead.contact?.phone || "No Phone"}</div>
                                    <div className="text-xs text-gray-500">{parsedLead.contact?.email || "No Email"}</div>
                                </Card>
                                <Card className="p-3 bg-slate-50 space-y-1">
                                    <div className="text-xs font-medium text-gray-500 uppercase">Requirements</div>
                                    <div className="text-sm font-medium">{parsedLead.requirements?.type || "Any Type"}</div>
                                    <div className="text-xs">{parsedLead.requirements?.location || "Any Location"}</div>
                                    <div className="text-xs">
                                        {parsedLead.requirements?.budget ? `Budget: ${parsedLead.requirements.budget}` : "Budget: Any"}
                                    </div>
                                </Card>
                            </div>

                            {parsedLead.messageContent ? (
                                <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3">
                                    <div className="mb-1 flex items-center gap-2">
                                        <MessageCircle className="h-3.5 w-3.5 text-indigo-600" />
                                        <span className="text-xs font-semibold text-indigo-900">Inbound Message (Will Trigger AI)</span>
                                    </div>
                                    <p className="text-sm italic text-indigo-800">"{parsedLead.messageContent}"</p>
                                </div>
                            ) : (
                                <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
                                    <div className="mb-1 flex items-center gap-2">
                                        <BadgeAlert className="h-3.5 w-3.5 text-amber-600" />
                                        <span className="text-xs font-semibold text-amber-900">Internal Notes Only (No Auto-Reply)</span>
                                    </div>
                                    <p className="text-sm text-amber-800">{parsedLead.internalNotes || "No notes extracted"}</p>
                                </div>
                            )}

                            {!parsedLead.contact?.phone && (
                                <div className="flex items-center gap-2 rounded bg-amber-50 p-2 text-xs text-amber-700">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    No phone detected. Email-only import can still work if an email was found.
                                </div>
                            )}

                            <DialogFooter className="gap-2 sm:justify-between">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setParsedLead(null)}
                                    disabled={isImportingLead}
                                >
                                    Back to Edit
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700"
                                    onClick={handleImportLead}
                                    disabled={isImportingLead}
                                >
                                    {isImportingLead ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {isImportingLead ? "Importing..." : "Confirm & Import"}
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog
                open={findContactOpen}
                onOpenChange={(open) => {
                    setFindContactOpen(open);
                    if (!open) {
                        setOpeningConversationContactId(null);
                    }
                }}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Search className="h-4 w-4 text-blue-600" />
                            Find Contact From Selection
                        </DialogTitle>
                        <DialogDescription>
                            Search contacts by phone, email, or full name using the selected text.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">Selected text:</span>{" "}
                            {findContactSelectionPreview ? getSelectionPreview(findContactSelectionPreview) : "Selection captured"}
                        </div>

                        <Command shouldFilter={false} className="rounded-lg border">
                            <div className="border-b px-2 py-2">
                                <CommandInput
                                    value={contactQuery}
                                    onValueChange={setContactQuery}
                                    placeholder="Search by phone, email, or full name..."
                                />
                            </div>
                            <CommandList className="max-h-[340px]">
                                {searchingContacts && (
                                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Searching contacts...
                                    </div>
                                )}

                                {!searchingContacts && contactQuery.trim().length < 2 && (
                                    <div className="px-3 py-6 text-sm text-slate-500">
                                        Type at least 2 characters.
                                    </div>
                                )}

                                {!searchingContacts && contactQuery.trim().length >= 2 && contactResults.length === 0 && (
                                    <CommandEmpty>No contact found.</CommandEmpty>
                                )}

                                {!searchingContacts && contactResults.map((contact) => {
                                    const isOpeningThisConversation = openingConversationContactId === contact.id;
                                    const hasConversation = !!contact.conversationId;
                                    const canOpenOrStartConversation = hasConversation || !!contact.phone;

                                    return (
                                        <CommandItem
                                            key={contact.id}
                                            value={`${getDisplayName(contact)} ${contact.phone || ""} ${contact.email || ""}`}
                                            onSelect={() => handleOpenContact(contact.id)}
                                            className="items-start gap-3 py-3 cursor-pointer"
                                        >
                                            <div className="mt-0.5 rounded-full bg-slate-100 p-2 text-slate-500">
                                                <User className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="truncate font-medium text-slate-900">
                                                        {getDisplayName(contact)}
                                                    </span>
                                                    {contact.matchReason ? (
                                                        <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                                                            {contact.matchReason}
                                                        </Badge>
                                                    ) : null}
                                                    {hasConversation ? (
                                                        <Badge variant="outline" className="h-5 px-2 text-[10px]">
                                                            Has Conversation
                                                        </Badge>
                                                    ) : null}
                                                </div>

                                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                                    {contact.phone ? (
                                                        <span className="flex items-center gap-1">
                                                            <Phone className="h-3 w-3" />
                                                            {contact.phone}
                                                        </span>
                                                    ) : null}
                                                    {contact.email ? (
                                                        <span className="flex items-center gap-1 truncate">
                                                            <Mail className="h-3 w-3" />
                                                            {contact.email}
                                                        </span>
                                                    ) : null}
                                                    {contact.location?.name ? (
                                                        <span className="truncate">{contact.location.name}</span>
                                                    ) : null}
                                                </div>

                                                <div className="pt-1 flex flex-wrap items-center gap-2">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 px-2 text-[11px]"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            handleOpenContact(contact.id);
                                                        }}
                                                    >
                                                        Open Contact
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        className="h-7 px-2 text-[11px]"
                                                        disabled={!canOpenOrStartConversation || isOpeningThisConversation}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            handleOpenConversation(contact);
                                                        }}
                                                    >
                                                        {isOpeningThisConversation ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : hasConversation ? (
                                                            <ExternalLink className="h-3 w-3" />
                                                        ) : null}
                                                        {hasConversation ? "Open Conversation" : "Start Conversation"}
                                                    </Button>
                                                </div>
                                            </div>
                                        </CommandItem>
                                    );
                                })}
                            </CommandList>
                        </Command>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={createTaskOpen}
                onOpenChange={(open) => {
                    setCreateTaskOpen(open);
                    if (!open) {
                        setIsCreatingTask(false);
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ListTodo className="h-4 w-4 text-blue-600" />
                            Create Task From Selection
                        </DialogTitle>
                        <DialogDescription>
                            Save this as an actionable task for the contact in Mission Control and Contact Tasks.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">Selected text:</span>{" "}
                            {taskDescription ? getSelectionPreview(taskDescription) : "Selection captured"}
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-slate-700">Task title</label>
                            <Input
                                value={taskTitle}
                                onChange={(event) => setTaskTitle(event.target.value)}
                                placeholder="e.g. Confirm viewing availability"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-slate-700">Task notes (optional)</label>
                            <Textarea
                                value={taskDescription}
                                onChange={(event) => setTaskDescription(event.target.value)}
                                className="min-h-[120px]"
                            />
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                className="gap-2"
                                onClick={handleCreateTaskFromSelection}
                                disabled={isCreatingTask || !taskTitle.trim() || !canUseCrmLogActions}
                            >
                                {isCreatingTask ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTodo className="h-4 w-4" />}
                                {isCreatingTask ? "Creating..." : "Create Task"}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={suggestTasksOpen}
                onOpenChange={(open) => {
                    setSuggestTasksOpen(open);
                    if (!open) {
                        suggestGenerationRunIdRef.current += 1;
                        setIsSuggestingTasks(false);
                        setIsApplyingSuggestedTasks(false);
                    }
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-violet-600" />
                            AI Task Suggestions
                        </DialogTitle>
                        <DialogDescription>
                            Generate actionable task suggestions from selected conversation text, then apply the ones you want.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">
                                {hasBatchSelections ? "Suggestion context batch:" : "Selected text:"}
                            </span>{" "}
                            {hasBatchSelections
                                ? `${selectionBatch.length} snippets queued across messages`
                                : (suggestSelectionText ? getSelectionPreview(suggestSelectionText) : "Selection captured")}
                        </div>

                        {hasBatchSelections ? (
                            <div className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="font-medium text-slate-700">Queued snippets</span>
                                    {onClearSelectionBatch ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-[11px]"
                                            onClick={onClearSelectionBatch}
                                        >
                                            Clear Batch
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="max-h-36 space-y-1 overflow-y-auto">
                                    {selectionBatch.map((item, index) => (
                                        <div key={item.id} className="flex items-start gap-1 rounded border border-slate-100 bg-slate-50 px-2 py-1">
                                            <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-slate-500">{index + 1}.</span>
                                            <span className="flex-1 text-[11px] text-slate-700">{getSelectionPreview(item.text)}</span>
                                            {onRemoveSelectionBatchItem ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-5 w-5 p-0 text-slate-400 hover:text-slate-700"
                                                    onClick={() => onRemoveSelectionBatchItem(item.id)}
                                                    title="Remove snippet from batch"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className="flex items-center justify-between gap-2">
                            <Button
                                type="button"
                                className="gap-2"
                                onClick={() => {
                                    void handleGenerateTaskSuggestions();
                                }}
                                disabled={isSuggestingTasks || !suggestSelectionText.trim() || !canUseCrmLogActions}
                            >
                                {isSuggestingTasks ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                {isSuggestingTasks
                                    ? "Generating..."
                                    : (taskSuggestions.length > 0 ? "Regenerate Suggestions" : "Generate Suggestions")}
                            </Button>

                            {taskSuggestions.length > 0 ? (
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={selectedSuggestionCount === taskSuggestions.length}
                                        onChange={(event) => handleToggleAllSuggestions(event.target.checked)}
                                    />
                                    Select all
                                </label>
                            ) : null}
                        </div>

                        <TaskSuggestionFunnelMetrics conversationId={conversationId} />

                        {isSuggestingTasks ? (
                            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                                Generating task suggestions...
                            </div>
                        ) : null}

                        {!isSuggestingTasks && taskSuggestions.length === 0 ? (
                            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                No suggestions yet. Use "Generate Suggestions" to retry if needed.
                            </div>
                        ) : null}

                        {taskSuggestions.length > 0 ? (
                            <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-md border p-2">
                                {taskSuggestions.map((suggestion, index) => (
                                    <div key={suggestion.id} className="rounded-md border bg-white p-2.5 space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <label className="flex items-start gap-2 flex-1 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={suggestion.selected}
                                                    onChange={(event) => handlePatchSuggestion(suggestion.id, { selected: event.target.checked })}
                                                    className="mt-0.5"
                                                />
                                                <span className="text-xs font-medium text-slate-700">Suggestion {index + 1}</span>
                                            </label>

                                            <Badge variant="outline" className="text-[10px]">
                                                {Math.round((suggestion.confidence || 0.5) * 100)}% confidence
                                            </Badge>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[11px] font-medium text-slate-600">Task title</label>
                                            <Input
                                                value={suggestion.title}
                                                onChange={(event) => handlePatchSuggestion(suggestion.id, { title: event.target.value })}
                                                placeholder="Task title"
                                            />
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[11px] font-medium text-slate-600">Task notes</label>
                                            <Textarea
                                                value={suggestion.description || ""}
                                                onChange={(event) => handlePatchSuggestion(suggestion.id, { description: event.target.value })}
                                                className="min-h-[84px]"
                                                placeholder="Optional notes"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-medium text-slate-600">Priority</label>
                                                <select
                                                    value={suggestion.priority}
                                                    onChange={(event) => handlePatchSuggestion(suggestion.id, { priority: event.target.value as "low" | "medium" | "high" })}
                                                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                                                >
                                                    <option value="low">low</option>
                                                    <option value="medium">medium</option>
                                                    <option value="high">high</option>
                                                </select>
                                            </div>

                                            <div className="space-y-1">
                                                <label className="text-[11px] font-medium text-slate-600">Due at</label>
                                                <Input
                                                    type="datetime-local"
                                                    step={300}
                                                    value={suggestion.dueAtInput || ""}
                                                    onChange={(event) => handlePatchSuggestion(suggestion.id, { dueAtInput: event.target.value })}
                                                />
                                            </div>
                                        </div>

                                        {suggestion.reason ? (
                                            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                                                <span className="font-medium text-slate-700">Why:</span> {suggestion.reason}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <DialogFooter>
                            <Button
                                type="button"
                                className="gap-2"
                                onClick={handleApplySuggestedTasks}
                                disabled={isApplyingSuggestedTasks || selectedSuggestionCount === 0 || !canUseCrmLogActions}
                            >
                                {isApplyingSuggestedTasks ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTodo className="h-4 w-4" />}
                                {isApplyingSuggestedTasks
                                    ? "Applying..."
                                    : `Create Selected Tasks${selectedSuggestionCount > 0 ? ` (${selectedSuggestionCount})` : ""}`}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={summarizeOpen}
                onOpenChange={(open) => {
                    setSummarizeOpen(open);
                    if (!open) {
                        setIsSummarizing(false);
                        setSummarySavedEntry("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-emerald-600" />
                            Summarize Selection to CRM Log
                        </DialogTitle>
                        <DialogDescription>
                            Generates a concise activity note and saves it to contact history using format: DD.MM.YY FirstName: summary.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">
                                {hasBatchSelections ? "Summary batch:" : "Selected text:"}
                            </span>{" "}
                            {hasBatchSelections
                                ? `${selectionBatch.length} snippets queued across messages`
                                : (summarizeSelectionText ? getSelectionPreview(summarizeSelectionText) : "Selection captured")}
                        </div>

                        {hasBatchSelections ? (
                            <div className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="font-medium text-slate-700">Queued snippets</span>
                                    {onClearSelectionBatch ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-[11px]"
                                            onClick={onClearSelectionBatch}
                                        >
                                            Clear Batch
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="max-h-36 space-y-1 overflow-y-auto">
                                    {selectionBatch.map((item, index) => (
                                        <div key={item.id} className="flex items-start gap-1 rounded border border-slate-100 bg-slate-50 px-2 py-1">
                                            <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-slate-500">{index + 1}.</span>
                                            <span className="flex-1 text-[11px] text-slate-700">{getSelectionPreview(item.text)}</span>
                                            {onRemoveSelectionBatchItem ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-5 w-5 p-0 text-slate-400 hover:text-slate-700"
                                                    onClick={() => onRemoveSelectionBatchItem(item.id)}
                                                    title="Remove snippet from batch"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <Button
                            type="button"
                            className="w-full gap-2"
                            onClick={handleSummarizeToCrmLog}
                            disabled={isSummarizing || !summarizeSelectionText.trim() || !canUseCrmLogActions}
                        >
                            {isSummarizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                            {isSummarizing ? "Summarizing..." : "Summarize & Save to CRM Log"}
                        </Button>

                        {summarySavedEntry ? (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                                <div className="mb-1 font-semibold">Saved Entry</div>
                                <p className="whitespace-pre-wrap">{summarySavedEntry}</p>
                            </div>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={customOpen}
                onOpenChange={(open) => {
                    setCustomOpen(open);
                    if (!open) {
                        setIsRunningCustom(false);
                        setIsSavingCustom(false);
                        setCustomInstruction("");
                        setCustomOutput("");
                        setCustomSavedEntry("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Wand2 className="h-4 w-4 text-violet-600" />
                            Custom Selection Action
                        </DialogTitle>
                        <DialogDescription>
                            Type what AI should do. The selected text is automatically passed as context.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">
                                {hasBatchSelections ? "Custom context batch:" : "Selected text:"}
                            </span>{" "}
                            {hasBatchSelections
                                ? `${selectionBatch.length} snippets queued across messages`
                                : (customSelectionText ? getSelectionPreview(customSelectionText) : "Selection captured")}
                        </div>

                        {hasBatchSelections ? (
                            <div className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="font-medium text-slate-700">Queued snippets</span>
                                    {onClearSelectionBatch ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-[11px]"
                                            onClick={onClearSelectionBatch}
                                        >
                                            Clear Batch
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="max-h-36 space-y-1 overflow-y-auto">
                                    {selectionBatch.map((item, index) => (
                                        <div key={item.id} className="flex items-start gap-1 rounded border border-slate-100 bg-slate-50 px-2 py-1">
                                            <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-slate-500">{index + 1}.</span>
                                            <span className="flex-1 text-[11px] text-slate-700">{getSelectionPreview(item.text)}</span>
                                            {onRemoveSelectionBatchItem ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-5 w-5 p-0 text-slate-400 hover:text-slate-700"
                                                    onClick={() => onRemoveSelectionBatchItem(item.id)}
                                                    title="Remove snippet from batch"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <Textarea
                            value={customInstruction}
                            onChange={(e) => setCustomInstruction(e.target.value)}
                            className="min-h-[92px] text-sm"
                            placeholder="Example: Write a 1-line follow-up note focused on next action and timeline."
                            disabled={isRunningCustom}
                        />

                        <Button
                            type="button"
                            className="w-full gap-2"
                            onClick={handleRunCustomPrompt}
                            disabled={isRunningCustom || !customInstruction.trim() || !canUseCrmLogActions}
                        >
                            {isRunningCustom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                            {isRunningCustom ? "Running..." : "Run Custom Prompt"}
                        </Button>

                        {customOutput ? (
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-slate-700">AI Output</label>
                                <Textarea
                                    value={customOutput}
                                    onChange={(e) => setCustomOutput(e.target.value)}
                                    className="min-h-[110px] text-sm"
                                    disabled={isSavingCustom}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full gap-2"
                                    onClick={handleSaveCustomToCrmLog}
                                    disabled={isSavingCustom || !customOutput.trim() || !canUseCrmLogActions}
                                >
                                    {isSavingCustom ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                    {isSavingCustom ? "Saving..." : "Save Output to CRM Log"}
                                </Button>
                            </div>
                        ) : null}

                        {customSavedEntry ? (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                                <div className="mb-1 font-semibold">Saved Entry</div>
                                <p className="whitespace-pre-wrap">{customSavedEntry}</p>
                            </div>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog >

            <ViewingsSuggestionDialog
                open={suggestViewingsOpen}
                onOpenChange={(open) => {
                    setSuggestViewingsOpen(open);
                    if (!open) {
                        setSuggestSelectionText("");
                    }
                }}
                selectionText={suggestSelectionText}
                conversationId={conversationId || undefined}
                activeAiModel={activeAiModel || undefined}
                anchorMessageId={messageId || undefined}
            />
        </>
    );
}
