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

export async function streamDraftViaApi(
    args: DraftStreamArgs,
    fetchImpl: typeof fetch = fetch
): Promise<GenerateDraftResult | null> {
    const response = await fetchImpl("/api/conversations/draft-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const fallbackMessage = `Draft stream request failed (${response.status})`;
        throw new Error(payload?.error || payload?.message || fallbackMessage);
    }

    if (!response.body) {
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

    if (args.onChunk) {
        try {
            result = await (args.streamDraft || streamDraftViaApi)({
                conversationId: args.conversationId,
                contactId: args.contactId,
                instruction: args.instruction,
                model: args.model,
                mode: args.mode,
                dealId: args.dealId ?? undefined,
                draftLanguage: args.draftLanguage,
                onChunk: args.onChunk,
            });
        } catch (error) {
            args.onStreamError?.(error);
        }
    }

    if (result) {
        return result;
    }

    return args.generateDraft(
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
}
