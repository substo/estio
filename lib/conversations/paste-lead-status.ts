export type PasteLeadImportStatusEvent =
    | "paste_lead_import_started"
    | "lead_parse_started"
    | "lead_parse_completed"
    | "lead_parse_failed"
    | "contact_lookup_started"
    | "contact_created"
    | "contact_updated"
    | "conversation_created"
    | "conversation_updated"
    | "message_created"
    | "property_ref_detected"
    | "property_existing_lookup_started"
    | "property_existing_linked"
    | "property_import_queued"
    | "property_import_already_queued"
    | "property_import_failed_to_queue"
    | "background_task_started"
    | "background_task_completed"
    | "background_task_failed"
    | "orchestration_queued"
    | "orchestration_completed"
    | "paste_lead_import_completed"
    | "paste_lead_import_failed";

export type PasteLeadImportStatusState = "pending" | "running" | "completed" | "failed" | "skipped";

export type PasteLeadImportStatus = {
    event: PasteLeadImportStatusEvent;
    state: PasteLeadImportStatusState;
    label: string;
    detail?: string;
    at: string;
    latencyMs?: number;
    pasteLeadTraceId?: string;
};

export type PasteLeadImportDebugMetadata = {
    pasteLeadTraceId: string;
    parseLatencyMs?: number;
    importLatencyMs?: number;
    totalLatencyMs?: number;
    backgroundJobsQueued: string[];
    backgroundJobsSkipped: string[];
    statuses: PasteLeadImportStatus[];
};

const EVENT_LABELS: Record<PasteLeadImportStatusEvent, string> = {
    paste_lead_import_started: "Import started",
    lead_parse_started: "Parsing lead",
    lead_parse_completed: "Lead parsed",
    lead_parse_failed: "Lead parse failed",
    contact_lookup_started: "Finding contact",
    contact_created: "Contact created",
    contact_updated: "Contact updated",
    conversation_created: "Conversation created",
    conversation_updated: "Conversation updated",
    message_created: "Message created",
    property_ref_detected: "Property ref detected",
    property_existing_lookup_started: "Checking existing property",
    property_existing_linked: "Existing property linked",
    property_import_queued: "Old CRM import queued",
    property_import_already_queued: "Old CRM import already queued",
    property_import_failed_to_queue: "Old CRM import queue failed",
    background_task_started: "Background work started",
    background_task_completed: "Background work completed",
    background_task_failed: "Background work failed",
    orchestration_queued: "AI follow-up queued",
    orchestration_completed: "AI follow-up completed",
    paste_lead_import_completed: "Import completed",
    paste_lead_import_failed: "Import failed",
};

export function createPasteLeadStatus(
    event: PasteLeadImportStatusEvent,
    state: PasteLeadImportStatusState,
    options?: {
        pasteLeadTraceId?: string;
        detail?: string;
        latencyMs?: number;
        at?: Date;
    }
): PasteLeadImportStatus {
    return {
        event,
        state,
        label: EVENT_LABELS[event],
        detail: options?.detail,
        latencyMs: options?.latencyMs,
        pasteLeadTraceId: options?.pasteLeadTraceId,
        at: (options?.at || new Date()).toISOString(),
    };
}

export function formatPasteLeadStatusForLog(status: PasteLeadImportStatus) {
    return {
        pasteLeadTraceId: status.pasteLeadTraceId,
        event: status.event,
        state: status.state,
        label: status.label,
        detail: status.detail,
        latencyMs: status.latencyMs,
        at: status.at,
    };
}

export function createPasteLeadStatusRecorder(args: {
    pasteLeadTraceId?: string;
    statuses?: PasteLeadImportStatus[];
    logPrefix?: string;
}) {
    return (
        event: PasteLeadImportStatusEvent,
        state: PasteLeadImportStatusState,
        detail?: string,
        latencyMs?: number
    ) => {
        const status = createPasteLeadStatus(event, state, {
            pasteLeadTraceId: args.pasteLeadTraceId,
            detail,
            latencyMs,
        });
        args.statuses?.push(status);
        if (args.logPrefix) {
            console.log(args.logPrefix, JSON.stringify(formatPasteLeadStatusForLog(status)));
        }
        return status;
    };
}

export type PasteLeadProgressStepKey =
    | "parse"
    | "contact"
    | "conversation"
    | "property"
    | "background"
    | "done";

export type PasteLeadProgressStep = {
    key: PasteLeadProgressStepKey;
    label: string;
    state: PasteLeadImportStatusState;
    detail?: string;
};

const STEP_DEFAULTS: PasteLeadProgressStep[] = [
    { key: "parse", label: "Parsing lead", state: "pending" },
    { key: "contact", label: "Creating/updating contact", state: "pending" },
    { key: "conversation", label: "Creating/updating conversation", state: "pending" },
    { key: "property", label: "Detecting property refs", state: "pending" },
    { key: "background", label: "Running background enrichment", state: "pending" },
    { key: "done", label: "Done", state: "pending" },
];

function stepStateFromEvent(event: PasteLeadImportStatusEvent): { key: PasteLeadProgressStepKey; state: PasteLeadImportStatusState } | null {
    switch (event) {
        case "paste_lead_import_started":
        case "lead_parse_started":
            return { key: "parse", state: "running" };
        case "lead_parse_completed":
            return { key: "parse", state: "completed" };
        case "lead_parse_failed":
            return { key: "parse", state: "failed" };
        case "contact_lookup_started":
            return { key: "contact", state: "running" };
        case "contact_created":
        case "contact_updated":
            return { key: "contact", state: "completed" };
        case "conversation_created":
        case "conversation_updated":
            return { key: "conversation", state: "completed" };
        case "message_created":
        case "orchestration_queued":
        case "orchestration_completed":
            return { key: "background", state: "running" };
        case "property_ref_detected":
        case "property_existing_lookup_started":
            return { key: "property", state: "running" };
        case "property_existing_linked":
        case "property_import_queued":
        case "property_import_already_queued":
            return { key: "property", state: "completed" };
        case "property_import_failed_to_queue":
            return { key: "property", state: "failed" };
        case "background_task_started":
            return { key: "background", state: "running" };
        case "background_task_completed":
            return { key: "background", state: "completed" };
        case "background_task_failed":
            return { key: "background", state: "failed" };
        case "paste_lead_import_completed":
            return { key: "done", state: "completed" };
        case "paste_lead_import_failed":
            return { key: "done", state: "failed" };
        default:
            return null;
    }
}

export function buildPasteLeadProgressSteps(statuses: PasteLeadImportStatus[]): PasteLeadProgressStep[] {
    const steps = STEP_DEFAULTS.map((step) => ({ ...step }));
    const byKey = new Map(steps.map((step) => [step.key, step]));

    for (const status of statuses) {
        const mapped = stepStateFromEvent(status.event);
        if (!mapped) continue;
        const step = byKey.get(mapped.key);
        if (!step) continue;

        step.state = mapped.state;
        if (status.detail) step.detail = status.detail;
    }

    return steps;
}
