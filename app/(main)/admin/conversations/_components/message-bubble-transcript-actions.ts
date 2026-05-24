export type TranscriptStatus = "pending" | "processing" | "completed" | "failed" | string | null | undefined;

export type TranscriptActionLabelInput = {
    activeAttachmentId?: string | null;
    attachmentId?: string;
    mode?: "start" | "regenerate" | "retry";
    status?: TranscriptStatus;
};

export type ExtractionActionLabelInput = {
    activeAttachmentId?: string | null;
    attachmentId?: string;
    hasExtraction?: boolean;
    retry?: boolean;
};

export type ExtractionSummary = {
    prospects: string;
    requirements: string;
    budget: string;
    locations: string;
    objections: string;
    nextActions: string;
};

export function isPendingStatus(status: TranscriptStatus): boolean {
    return status === "pending" || status === "processing";
}

export function getTranscriptStatusTone(status: TranscriptStatus, isOutboundBubble: boolean): string | false {
    if (status === "completed") {
        return isOutboundBubble ? "bg-emerald-500/25 text-emerald-100" : "bg-emerald-100 text-emerald-700";
    }
    if (status === "failed") {
        return isOutboundBubble ? "bg-red-500/25 text-red-100" : "bg-red-100 text-red-700";
    }
    if (isPendingStatus(status)) {
        return isOutboundBubble ? "bg-amber-500/25 text-amber-100" : "bg-amber-100 text-amber-700";
    }
    return false;
}

export function getExtractionStatusTone(status: TranscriptStatus, isOutboundBubble: boolean): string | false {
    return getTranscriptStatusTone(status, isOutboundBubble);
}

export function getTranscriptPreviewText(text: string | null | undefined, expanded: boolean, maxLength = 280): string {
    const value = String(text || "");
    if (expanded || value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}

export function shouldShowTranscriptToggle(text: string | null | undefined, maxLength = 280): boolean {
    return String(text || "").length > maxLength;
}

export function getTranscriptActionLabel({
    activeAttachmentId,
    attachmentId,
    mode,
    status,
}: TranscriptActionLabelInput): string {
    const resolvedMode = mode || (status === "failed" ? "retry" : "regenerate");
    const isActive = !!attachmentId && activeAttachmentId === attachmentId;

    if (resolvedMode === "start") return isActive ? "Starting..." : "Transcribe now";
    if (resolvedMode === "retry") return isActive ? "Retrying..." : "Retry transcript";
    return isActive ? "Regenerating..." : "Regenerate transcript";
}

export function getExtractionActionLabel({
    activeAttachmentId,
    attachmentId,
    hasExtraction = false,
    retry = false,
}: ExtractionActionLabelInput): string {
    const isActive = !!attachmentId && activeAttachmentId === attachmentId;

    if (retry) return isActive ? "Retrying..." : "Retry extraction";
    if (isActive) return hasExtraction ? "Regenerating notes..." : "Extracting...";
    return hasExtraction ? "Regenerate notes" : "Extract viewing notes";
}

export function formatExtractionList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || "").trim())
        .filter((item) => !!item);
}

export function formatExtractionSummary(payload: unknown): ExtractionSummary {
    const value = (payload || {}) as {
        prospects?: unknown;
        requirements?: unknown;
        budget?: unknown;
        locations?: unknown;
        objections?: unknown;
        nextActions?: unknown;
    };

    return {
        prospects: formatExtractionList(value.prospects).join("; ") || "None",
        requirements: formatExtractionList(value.requirements).join("; ") || "None",
        budget: String(value.budget || "").trim() || "Not specified",
        locations: formatExtractionList(value.locations).join("; ") || "None",
        objections: formatExtractionList(value.objections).join("; ") || "None",
        nextActions: formatExtractionList(value.nextActions).join("; ") || "None",
    };
}
