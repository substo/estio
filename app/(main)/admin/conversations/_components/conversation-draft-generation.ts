type DraftMode = "chat" | "deal";

export type GenerateDraftResult = {
    draft?: string | null;
    reasoning?: string | null;
};

type DraftStreamArgs = {
    conversationId: string;
    contactId: string;
    instruction?: string;
    model?: string;
    mode: DraftMode;
    dealId?: string | null;
    draftLanguage?: string | null;
    onChunk?: (chunk: string) => void;
    timeoutMs?: number;
};

type DraftFallbackArgs = {
    conversationId: string;
    contactId: string;
    instruction?: string;
    model?: string;
    options: {
        mode: DraftMode;
        dealId?: string;
        draftLanguage?: string | null;
    };
};

const DEFAULT_DRAFT_STREAM_TIMEOUT_MS = 12_000;

function logDraftTiming(event: string, fields: Record<string, unknown> = {}) {
    if (typeof console === "undefined") return;
    console.info("[AI Draft Timing]", JSON.stringify({
        event,
        ts: new Date().toISOString(),
        ...fields,
    }));
}

function describeError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error || "Unknown error");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error(`Draft stream timed out after ${timeoutMs}ms.`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function streamDraftViaApi(
    args: DraftStreamArgs,
    fetchImpl: typeof fetch = fetch
): Promise<GenerateDraftResult | null> {
    const startedAt = Date.now();
    let firstChunkMs: number | null = null;
    const timeoutMs = args.timeoutMs ?? DEFAULT_DRAFT_STREAM_TIMEOUT_MS;
    const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = abortController
        ? setTimeout(() => abortController.abort(), timeoutMs)
        : null;

    logDraftTiming("stream_request_start", {
        conversationId: args.conversationId,
        mode: args.mode,
        timeoutMs,
    });

    let response: Response;
    try {
        response = await fetchImpl("/api/conversations/draft-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController?.signal,
            body: JSON.stringify({
                conversationId: args.conversationId,
                contactId: args.contactId,
                instruction: args.instruction,
                model: args.model,
                options: {
                    mode: args.mode,
                    dealId: args.dealId,
                    draftLanguage: args.draftLanguage ?? null,
                },
            }),
        });
    } catch (error) {
        if (timeout) clearTimeout(timeout);
        logDraftTiming("stream_failure", {
            conversationId: args.conversationId,
            elapsedMs: Date.now() - startedAt,
            reason: abortController?.signal.aborted ? `stream_timeout_${timeoutMs}ms` : describeError(error),
        });
        throw error;
    }

    if (!response.ok) {
        if (timeout) clearTimeout(timeout);
        const payload = await response.json().catch(() => null);
        const fallbackMessage = `Draft stream request failed (${response.status})`;
        logDraftTiming("stream_failure", {
            conversationId: args.conversationId,
            status: response.status,
            elapsedMs: Date.now() - startedAt,
            reason: payload?.error || payload?.message || fallbackMessage,
        });
        throw new Error(payload?.error || payload?.message || fallbackMessage);
    }

    if (!response.body) {
        if (timeout) clearTimeout(timeout);
        logDraftTiming("stream_failure", {
            conversationId: args.conversationId,
            elapsedMs: Date.now() - startedAt,
            reason: "empty_response_body",
        });
        throw new Error("Draft stream response body was empty.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: GenerateDraftResult | null = null;

    const parseLine = (line: string) => {
        if (!line.trim()) return;
        let payload: any = null;
        try {
            payload = JSON.parse(line);
        } catch {
            return;
        }

        if (payload?.type === "chunk" && typeof payload.text === "string") {
            if (firstChunkMs === null) {
                firstChunkMs = Date.now() - startedAt;
                logDraftTiming("first_stream_chunk", {
                    conversationId: args.conversationId,
                    firstChunkMs,
                });
            }
            args.onChunk?.(payload.text);
            return;
        }

        if (payload?.type === "error") {
            throw new Error(String(payload?.message || "Draft stream failed."));
        }

        if (payload?.type === "complete") {
            finalResult = payload.result || null;
        }
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                parseLine(line);
                newlineIndex = buffer.indexOf("\n");
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
            parseLine(buffer.trim());
        }
    } catch (error) {
        logDraftTiming("stream_failure", {
            conversationId: args.conversationId,
            elapsedMs: Date.now() - startedAt,
            firstChunkMs,
            reason: abortController?.signal.aborted ? `stream_timeout_${timeoutMs}ms` : describeError(error),
        });
        throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
    }

    logDraftTiming("stream_complete", {
        conversationId: args.conversationId,
        elapsedMs: Date.now() - startedAt,
        firstChunkMs,
        hasFinalResult: !!finalResult?.draft,
    });

    return finalResult;
}

export async function generateDraftWithStreamingFallback(args: {
    conversationId: string;
    contactId: string;
    instruction?: string;
    model?: string;
    mode: DraftMode;
    dealId?: string;
    draftLanguage?: string | null;
    onChunk?: (chunk: string) => void;
    streamTimeoutMs?: number;
    streamDraft?: (args: DraftStreamArgs) => Promise<GenerateDraftResult | null>;
    generateDraft: (
        conversationId: string,
        contactId: string,
        instruction?: string,
        model?: string,
        options?: DraftFallbackArgs["options"]
    ) => Promise<GenerateDraftResult>;
    onStreamError?: (error: unknown) => void;
}): Promise<GenerateDraftResult> {
    let result: GenerateDraftResult | null = null;
    let fallbackReason = args.onChunk ? "stream_not_attempted" : "streaming_unavailable";

    if (args.onChunk) {
        try {
            const streamStartedAt = Date.now();
            const timeoutMs = args.streamTimeoutMs ?? DEFAULT_DRAFT_STREAM_TIMEOUT_MS;
            result = await withTimeout((args.streamDraft || streamDraftViaApi)({
                conversationId: args.conversationId,
                contactId: args.contactId,
                instruction: args.instruction,
                model: args.model,
                mode: args.mode,
                dealId: args.dealId ?? undefined,
                draftLanguage: args.draftLanguage,
                onChunk: args.onChunk,
                timeoutMs,
            }), timeoutMs);
            fallbackReason = result?.draft ? "" : "stream_completed_without_final_result";
            logDraftTiming("stream_path_end", {
                conversationId: args.conversationId,
                elapsedMs: Date.now() - streamStartedAt,
                hasDraft: !!result?.draft,
                fallbackReason: fallbackReason || null,
            });
        } catch (error) {
            fallbackReason = describeError(error);
            args.onStreamError?.(error);
        }
    }

    if (result?.draft) {
        return result;
    }

    const fallbackStartedAt = Date.now();
    logDraftTiming("fallback_server_action_start", {
        conversationId: args.conversationId,
        mode: args.mode,
        reason: fallbackReason,
    });
    const fallbackResult = await args.generateDraft(
        args.conversationId,
        args.contactId,
        args.instruction,
        args.model,
        {
            mode: args.mode,
            dealId: args.dealId || undefined,
            draftLanguage: args.draftLanguage,
        }
    );
    logDraftTiming("fallback_server_action_end", {
        conversationId: args.conversationId,
        elapsedMs: Date.now() - fallbackStartedAt,
        hasDraft: !!fallbackResult?.draft,
        reason: fallbackReason,
    });
    return fallbackResult;
}
