'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Message } from '@/lib/ghl/conversations';
import { THREAD_REFRESH_MESSAGES_OPTIONS } from '@/lib/conversations/thread-hydration';

type ToastInput = {
    title: string;
    description?: string;
    variant?: 'default' | 'destructive';
};

type TranscriptActionResult = {
    success: boolean;
    error?: unknown;
};

export function getMessageSignature(messages: Message[]): string {
    if (!messages || messages.length === 0) return '0';
    const compact = messages.map((message) => {
        const attachmentSignature = (message.attachments || []).map((attachment) => {
            if (typeof attachment === "string") return `s:${attachment.length}`;
            const transcript = attachment.transcript;
            const extraction = transcript?.extraction;
            return [
                attachment.id || "",
                transcript?.status || "",
                String(transcript?.text || "").length,
                String(transcript?.error || "").length,
                transcript?.updatedAt || "",
                extraction?.status || "",
                extraction?.updatedAt || "",
                String(extraction?.error || "").length,
                extraction?.payload ? JSON.stringify(extraction.payload).length : 0,
            ].join(":");
        }).join(",");

        return [
            message.id,
            message.status,
            message.dateAdded,
            String(message.body || "").length,
            attachmentSignature,
        ].join("|");
    }).join(";");

    return `${messages.length}:${compact}`;
}

export function hasPendingTranscripts(messages: Message[]): boolean {
    return (messages || []).some((message) =>
        (message.attachments || []).some((attachment) =>
            typeof attachment !== "string"
            && !!attachment.transcript
            && (
                attachment.transcript.status === "pending"
                || attachment.transcript.status === "processing"
                || attachment.transcript.extraction?.status === "pending"
                || attachment.transcript.extraction?.status === "processing"
            )
        )
    );
}

export function getTranscriptActionModeLabel(mode: unknown): string {
    return mode === "inline-fallback" ? "inline fallback" : String(mode);
}

export async function refreshMessagesAfterTranscriptAction(args: {
    conversationId: string;
    activeConversationId: string | null;
    fetchMessages: (conversationId: string, options?: { take?: number | null }) => Promise<Message[]>;
    mergeMessages?: (conversationId: string, snapshotMessages: Message[]) => Message[];
    setMessages: Dispatch<SetStateAction<Message[]>>;
    messageSignatureRef: MutableRefObject<string>;
}): Promise<void> {
    const refreshed = await args.fetchMessages(args.conversationId, THREAD_REFRESH_MESSAGES_OPTIONS);
    if (args.activeConversationId === args.conversationId) {
        const nextMessages = args.mergeMessages
            ? args.mergeMessages(args.conversationId, refreshed)
            : refreshed;
        args.setMessages(nextMessages);
        args.messageSignatureRef.current = getMessageSignature(nextMessages);
    }
}

export async function runTranscriptAction<Result extends TranscriptActionResult>(args: {
    run: () => Promise<Result>;
    refresh: () => Promise<void>;
    toast: (input: ToastInput) => void;
    failureTitle: string;
    failureDescription: string;
    unexpectedFailureDescription: string;
    onSuccess: (result: Extract<Result, { success: true }>) => void;
}): Promise<void> {
    try {
        const result = await args.run();
        if (!result?.success) {
            args.toast({
                title: args.failureTitle,
                description: String(result?.error || args.failureDescription),
                variant: "destructive",
            });
            return;
        }

        args.onSuccess(result as Extract<Result, { success: true }>);
        await args.refresh();
    } catch (error: any) {
        args.toast({
            title: args.failureTitle,
            description: String(error?.message || args.unexpectedFailureDescription),
            variant: "destructive",
        });
    }
}
