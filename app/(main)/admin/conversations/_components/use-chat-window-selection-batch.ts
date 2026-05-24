import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { summarizeSelectionToCrmLog } from "@/app/(main)/admin/conversations/actions";
import type { SelectionBatchInput, SelectionBatchItem } from "./message-selection-actions";

function normalizeSelectionForBatch(text: string) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function hashString(input: string) {
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function buildSelectionBatchId(conversationId: string, item: SelectionBatchInput, normalizedText: string) {
    return `${conversationId}:${item.messageId || "no-message"}:${hashString(`${item.source}:${normalizedText.toLowerCase()}`)}`;
}

function buildBatchContextText(items: SelectionBatchItem[]) {
    return items.map((item, index) => `Snippet ${index + 1}:\n${item.text}`).join("\n\n");
}

export type SummarizeStreamParseResult = {
    entry: string;
    skipped: boolean;
};

export async function parseSummarizeStreamResponse(response: Response): Promise<SummarizeStreamParseResult> {
    if (!response.ok || !response.body) {
        throw new Error("Stream unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalEntry = "";
    let finalSkipped = false;
    let streamError: string | null = null;

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.trim()) {
                try {
                    const payload = JSON.parse(line);
                    if (payload?.type === "complete") {
                        finalEntry = String(payload.entry || "");
                        finalSkipped = !!payload.skipped;
                    }
                    if (payload?.type === "error") {
                        streamError = String(payload.message || "Stream error");
                    }
                } catch { /* ignore parse errors */ }
            }
            newlineIndex = buffer.indexOf("\n");
        }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
        try {
            const payload = JSON.parse(buffer.trim());
            if (payload?.type === "complete") {
                finalEntry = String(payload.entry || "");
                finalSkipped = !!payload.skipped;
            }
            if (payload?.type === "error") {
                streamError = String(payload.message || "Stream error");
            }
        } catch { /* ignore */ }
    }

    if (streamError) throw new Error(streamError);

    return {
        entry: finalEntry,
        skipped: finalSkipped,
    };
}

type UseChatWindowSelectionBatchArgs = {
    conversationId: string;
    selectedModel: string;
};

export function useChatWindowSelectionBatch({
    conversationId,
    selectedModel,
}: UseChatWindowSelectionBatchArgs) {
    const [selectionBatch, setSelectionBatch] = useState<SelectionBatchItem[]>([]);
    const [isSummarizingBatch, setIsSummarizingBatch] = useState(false);

    useEffect(() => {
        setSelectionBatch([]);
    }, [conversationId]);

    const handleAddSelectionToBatch = useCallback((item: SelectionBatchInput) => {
        const normalizedText = normalizeSelectionForBatch(item.text);
        if (!normalizedText) {
            return { added: false, total: selectionBatch.length };
        }

        const id = buildSelectionBatchId(conversationId, item, normalizedText);
        if (selectionBatch.some((existing) => existing.id === id)) {
            return { added: false, total: selectionBatch.length };
        }

        const next = [
            ...selectionBatch,
            {
                id,
                messageId: item.messageId || null,
                text: normalizedText,
                source: item.source,
                addedAt: Date.now(),
            },
        ];
        setSelectionBatch(next);
        return { added: true, total: next.length };
    }, [conversationId, selectionBatch]);

    const handleRemoveSelectionBatchItem = useCallback((id: string) => {
        setSelectionBatch((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const handleClearSelectionBatch = useCallback(() => {
        setSelectionBatch([]);
    }, []);

    const batchContextText = useMemo(() => buildBatchContextText(selectionBatch), [selectionBatch]);

    const handleSummarizeBatch = useCallback(async () => {
        if (!selectionBatch.length) return;
        setIsSummarizingBatch(true);
        const modelOverride = typeof selectedModel === "string" && selectedModel.trim() ? selectedModel.trim() : undefined;

        try {
            const response = await fetch("/api/conversations/summarize-stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId,
                    selectedText: batchContextText,
                    model: modelOverride,
                }),
            });

            const result = await parseSummarizeStreamResponse(response);

            if (result.entry) {
                if (result.skipped) {
                    toast.message("No new info found. Skipped duplicate CRM log entry.");
                } else {
                    toast.success("Batch summary saved to CRM log");
                }
                setSelectionBatch([]);
            } else {
                toast.error("Failed to summarize batch");
            }
        } catch (streamErr: any) {
            console.warn("[Summarize Batch] Stream failed, falling back to server action.", streamErr);
            try {
                const res = await summarizeSelectionToCrmLog(conversationId, batchContextText, modelOverride);
                if (!res?.success || !res?.entry) {
                    toast.error(res?.error || "Failed to summarize batch");
                    return;
                }
                if (res?.skipped) {
                    toast.message("No new info found. Skipped duplicate CRM log entry.");
                } else {
                    toast.success("Batch summary saved to CRM log");
                }
                setSelectionBatch([]);
            } catch (fallbackErr: any) {
                toast.error(fallbackErr?.message || "Failed to summarize batch");
            }
        } finally {
            setIsSummarizingBatch(false);
        }
    }, [batchContextText, conversationId, selectedModel, selectionBatch.length]);

    return {
        selectionBatch,
        isSummarizingBatch,
        handleAddSelectionToBatch,
        handleRemoveSelectionBatchItem,
        handleClearSelectionBatch,
        batchContextText,
        handleSummarizeBatch,
    };
}
