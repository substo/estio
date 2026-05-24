"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Clipboard, FileText, Home, Languages, ListPlus, ListTodo, MoreHorizontal, Search, Sparkles, Wand2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { EmailFrameSelection } from "./email-frame";
import {
    MessageSelectionActions,
    type MessageSelectionActionTarget,
    type SelectionBatchInput,
    type SelectionBatchItem,
} from "./message-selection-actions";
import { buildPlainLeadTextFromHtml } from "./paste-lead-rich-text";
import { getSharedContactReadableMessage } from "@/lib/contacts/vcard";

type MessageBubbleActionsOptions = {
    messageId: string;
    conversationId?: string | null;
    body: string;
    isEmail: boolean;
    isContactMessage: boolean;
    isExpanded: boolean;
    translationReset?: {
        translation: unknown;
        translations: unknown;
        preferredDisplayLanguage: unknown;
    };
    aiModel?: string | null;
    selectionBatch?: SelectionBatchItem[];
    onAddSelectionToBatch?: (item: SelectionBatchInput) => { added: boolean; total: number } | void;
    onRemoveSelectionBatchItem?: (id: string) => void;
    onClearSelectionBatch?: () => void;
};

type MessageBubbleActionsMenuProps = {
    isOutbound: boolean;
    canShow: boolean;
    hasConversation: boolean;
    canTranslate: boolean;
    canAddSelectionToBatch: boolean;
    onTranslateMessage: () => void;
    contextMenuButtonRef: RefObject<HTMLButtonElement | null>;
    onContextMenuAction: (action: string) => void;
};

type MessageBubbleSelectionActionsProps = Pick<
    MessageBubbleActionsOptions,
    "messageId" | "conversationId" | "aiModel" | "selectionBatch" | "onAddSelectionToBatch" | "onRemoveSelectionBatchItem" | "onClearSelectionBatch"
> & {
    selectionTarget: MessageSelectionActionTarget | null;
    pendingAction: string | null;
    clearSelectionTarget: () => void;
    clearPendingAction: () => void;
};

export function useMessageBubbleActions({
    messageId,
    conversationId,
    body,
    isEmail,
    isContactMessage,
    isExpanded,
    translationReset,
    aiModel,
    selectionBatch,
    onAddSelectionToBatch,
    onRemoveSelectionBatchItem,
    onClearSelectionBatch,
}: MessageBubbleActionsOptions) {
    const [selectionTarget, setSelectionTarget] = useState<MessageSelectionActionTarget | null>(null);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const contextMenuButtonRef = useRef<HTMLButtonElement>(null);

    const clearSelectionTarget = useCallback(() => setSelectionTarget(null), []);
    const clearPendingAction = useCallback(() => setPendingAction(null), []);

    useEffect(() => {
        setSelectionTarget(null);
        setPendingAction(null);
    }, [
        messageId,
        isExpanded,
        translationReset?.translation,
        translationReset?.translations,
        translationReset?.preferredDisplayLanguage,
    ]);

    const setSelectionFromRect = useCallback((
        rawText: string,
        rect: { top: number; left: number; right: number; bottom: number; width: number; height: number },
        source: "message" | "email"
    ) => {
        const text = String(rawText || "").replace(/\u00a0/g, " ").trim();
        if (!text || text.length < 2 || (!rect.width && !rect.height)) {
            setSelectionTarget((prev) => (prev?.source === source ? null : prev));
            return;
        }

        setSelectionTarget({
            text,
            source,
            rect,
        });
    }, []);

    useEffect(() => {
        const contentNode = contentRef.current;
        if (!contentNode) return;

        let timer: ReturnType<typeof setTimeout> | null = null;

        const onSelectionChange = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) {
                    setSelectionTarget((prev) => (prev?.source === "message" ? null : prev));
                    return;
                }

                const range = sel.getRangeAt(0);
                let intersects = false;
                try { intersects = range.intersectsNode(contentNode); } catch { intersects = false; }
                if (!intersects) return;

                const rect = range.getBoundingClientRect();
                setSelectionFromRect(sel.toString(), {
                    top: rect.top,
                    left: rect.left,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                }, "message");
            }, 200);
        };

        document.addEventListener("selectionchange", onSelectionChange);
        return () => {
            document.removeEventListener("selectionchange", onSelectionChange);
            if (timer) clearTimeout(timer);
        };
    }, [setSelectionFromRect]);

    const getActionableText = useCallback(() => {
        if (selectionTarget?.text?.trim()) return selectionTarget.text.trim();
        if (isContactMessage) return getSharedContactReadableMessage(body);
        if (isEmail) {
            const plainEmailText = buildPlainLeadTextFromHtml(body);
            if (plainEmailText.trim()) return plainEmailText.trim();
        }
        return String(body || "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }, [selectionTarget, isContactMessage, isEmail, body]);

    const handleContextMenuAction = useCallback((action: string) => {
        const text = getActionableText();
        if (!text || text.length < 2) return;
        const button = contextMenuButtonRef.current;
        const rect = button?.getBoundingClientRect() || { top: 200, left: 200, right: 220, bottom: 220, width: 20, height: 20 };
        setSelectionTarget({
            text,
            source: "message",
            rect: {
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            },
        });
        setPendingAction(action);
    }, [getActionableText]);

    const handleEmailSelectionChange = useCallback((selection: EmailFrameSelection | null) => {
        if (!selection) {
            setSelectionTarget((prev) => (prev?.source === "email" ? null : prev));
            return;
        }
        setSelectionFromRect(selection.text, selection.rect, "email");
    }, [setSelectionFromRect]);

    const selectionActions = (
        <MessageBubbleSelectionActions
            selectionTarget={selectionTarget}
            pendingAction={pendingAction}
            clearSelectionTarget={clearSelectionTarget}
            clearPendingAction={clearPendingAction}
            conversationId={conversationId}
            aiModel={aiModel}
            messageId={messageId}
            selectionBatch={selectionBatch}
            onAddSelectionToBatch={onAddSelectionToBatch}
            onRemoveSelectionBatchItem={onRemoveSelectionBatchItem}
            onClearSelectionBatch={onClearSelectionBatch}
        />
    );

    return {
        contentRef,
        contextMenuButtonRef,
        handleContextMenuAction,
        handleEmailSelectionChange,
        selectionActions,
    };
}

export function MessageBubbleActionsMenu({
    isOutbound,
    canShow,
    hasConversation,
    canTranslate,
    canAddSelectionToBatch,
    onTranslateMessage,
    contextMenuButtonRef,
    onContextMenuAction,
}: MessageBubbleActionsMenuProps) {
    if (!canShow) return null;

    return (
        <div className={cn(
            "absolute top-1.5 z-10 transition-opacity duration-150",
            isOutbound ? "left-1.5" : "right-1.5",
            "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        )}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        ref={contextMenuButtonRef}
                        type="button"
                        className={cn(
                            "h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                            isOutbound
                                ? "bg-blue-500/40 hover:bg-blue-500/60 text-white"
                                : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                        )}
                        onClick={(e) => e.stopPropagation()}
                        title="Message actions"
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isOutbound ? "start" : "end"} className="w-44" data-no-pane-swipe>
                    <DropdownMenuItem onClick={() => onContextMenuAction("pasteLead")} className="gap-2 text-xs">
                        <Clipboard className="h-3.5 w-3.5" />
                        Paste Lead
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onContextMenuAction("findContact")} className="gap-2 text-xs">
                        <Search className="h-3.5 w-3.5" />
                        Find Contact
                    </DropdownMenuItem>
                    {canTranslate && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onTranslateMessage} className="gap-2 text-xs text-blue-600 focus:text-blue-700">
                                <Languages className="h-3.5 w-3.5" />
                                Translate Message
                            </DropdownMenuItem>
                        </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onClick={() => onContextMenuAction("summarize")}
                        className="gap-2 text-xs"
                        disabled={!hasConversation}
                    >
                        <FileText className="h-3.5 w-3.5" />
                        Summarize
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => onContextMenuAction("custom")}
                        className="gap-2 text-xs"
                        disabled={!hasConversation}
                    >
                        <Wand2 className="h-3.5 w-3.5" />
                        Custom
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onClick={() => onContextMenuAction("createTask")}
                        className="gap-2 text-xs"
                        disabled={!hasConversation}
                    >
                        <ListTodo className="h-3.5 w-3.5" />
                        Create Task
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => onContextMenuAction("suggestTasks")}
                        className="gap-2 text-xs"
                        disabled={!hasConversation}
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Tasks
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => onContextMenuAction("suggestViewings")}
                        className="gap-2 text-xs"
                        disabled={!hasConversation}
                    >
                        <Home className="h-3.5 w-3.5" />
                        Suggest Viewings
                    </DropdownMenuItem>
                    {canAddSelectionToBatch && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onContextMenuAction("addBatch")} className="gap-2 text-xs">
                                <ListPlus className="h-3.5 w-3.5" />
                                Add to Batch
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

function MessageBubbleSelectionActions({
    selectionTarget,
    pendingAction,
    clearSelectionTarget,
    clearPendingAction,
    conversationId,
    aiModel,
    messageId,
    selectionBatch,
    onAddSelectionToBatch,
    onRemoveSelectionBatchItem,
    onClearSelectionBatch,
}: MessageBubbleSelectionActionsProps) {
    return (
        <MessageSelectionActions
            selection={selectionTarget}
            onClearSelection={clearSelectionTarget}
            conversationId={conversationId || null}
            aiModel={aiModel || null}
            messageId={messageId}
            selectionBatch={selectionBatch}
            onAddSelectionToBatch={onAddSelectionToBatch}
            onRemoveSelectionBatchItem={onRemoveSelectionBatchItem}
            onClearSelectionBatch={onClearSelectionBatch}
            triggerAction={pendingAction}
            onTriggerActionHandled={clearPendingAction}
        />
    );
}
