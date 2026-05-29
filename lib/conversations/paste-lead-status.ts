export type PasteLeadImportStatusEvent =
    | "paste_lead_import_started"
    | "lead_parse_started"
    | "lead_parse_completed"
    | "lead_parse_failed"
    | "auth_location_failed"
    | "contact_lookup_started"
    | "contact_lookup_completed"
    | "contact_create_failed"
    | "contact_created"
    | "contact_updated"
    | "conversation_lookup_started"
    | "conversation_created"
    | "conversation_updated"
    | "conversation_create_failed"
    | "message_created"
    | "note_created"
    | "property_ref_detected"
    | "property_ref_skipped"
    | "property_existing_lookup_started"
    | "property_existing_linked"
    | "property_import_queued"
    | "property_import_already_queued"
    | "property_import_skipped"
    | "property_import_failed_to_queue"
    | "google_autosync_queued"
    | "google_autosync_skipped"
    | "channel_verification_queued"
    | "channel_verification_skipped"
    | "background_enrichment_queued"
    | "background_enrichment_skipped"
    | "background_task_started"
    | "background_task_completed"
    | "background_task_failed"
    | "orchestration_queued"
    | "orchestration_skipped"
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
    auth_location_failed: "Auth/location failed",
    contact_lookup_started: "Finding contact",
    contact_lookup_completed: "Contact lookup complete",
    contact_create_failed: "Contact create failed",
    contact_created: "Contact created",
    contact_updated: "Contact updated",
    conversation_lookup_started: "Opening conversation",
    conversation_created: "Conversation created",
    conversation_updated: "Conversation updated",
    conversation_create_failed: "Conversation create failed",
    message_created: "Message created",
    note_created: "Note created",
    property_ref_detected: "Property ref detected",
    property_ref_skipped: "No property refs detected",
    property_existing_lookup_started: "Checking existing property",
    property_existing_linked: "Existing property linked",
    property_import_queued: "Old CRM import queued",
    property_import_already_queued: "Old CRM import already queued",
    property_import_skipped: "Old CRM import skipped",
    property_import_failed_to_queue: "Old CRM import queue failed",
    google_autosync_queued: "Google auto sync queued",
    google_autosync_skipped: "Google auto sync skipped",
    channel_verification_queued: "Channel verification queued",
    channel_verification_skipped: "Channel verification skipped",
    background_enrichment_queued: "Background enrichment queued",
    background_enrichment_skipped: "Background enrichment skipped",
    background_task_started: "Background work started",
    background_task_completed: "Background work completed",
    background_task_failed: "Background work failed",
    orchestration_queued: "AI follow-up queued",
    orchestration_skipped: "AI follow-up skipped",
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
    | "message"
    | "propertyDetect"
    | "propertyLink"
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
    { key: "conversation", label: "Opening conversation", state: "pending" },
    { key: "message", label: "Adding message/note", state: "pending" },
    { key: "propertyDetect", label: "Detecting property refs", state: "pending" },
    { key: "propertyLink", label: "Linking/queueing properties", state: "pending" },
    { key: "background", label: "Queuing background enrichment", state: "pending" },
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
        case "auth_location_failed":
            return { key: "parse", state: "failed" };
        case "contact_lookup_started":
            return { key: "contact", state: "running" };
        case "contact_lookup_completed":
            return { key: "contact", state: "running" };
        case "contact_created":
        case "contact_updated":
            return { key: "contact", state: "completed" };
        case "contact_create_failed":
            return { key: "contact", state: "failed" };
        case "conversation_lookup_started":
            return { key: "conversation", state: "running" };
        case "conversation_created":
        case "conversation_updated":
            return { key: "conversation", state: "completed" };
        case "conversation_create_failed":
            return { key: "conversation", state: "failed" };
        case "message_created":
        case "note_created":
            return { key: "message", state: "completed" };
        case "background_enrichment_queued":
        case "orchestration_queued":
            return { key: "background", state: "running" };
        case "property_ref_detected":
            return { key: "propertyDetect", state: "completed" };
        case "property_ref_skipped":
            return { key: "propertyDetect", state: "skipped" };
        case "property_existing_lookup_started":
            return { key: "propertyLink", state: "running" };
        case "property_existing_linked":
        case "property_import_queued":
        case "property_import_already_queued":
            return { key: "propertyLink", state: "completed" };
        case "property_import_skipped":
            return { key: "propertyLink", state: "skipped" };
        case "property_import_failed_to_queue":
            return { key: "propertyLink", state: "failed" };
        case "google_autosync_queued":
        case "channel_verification_queued":
        case "background_task_started":
            return { key: "background", state: "running" };
        case "google_autosync_skipped":
        case "channel_verification_skipped":
        case "background_enrichment_skipped":
        case "orchestration_skipped":
            return { key: "background", state: "skipped" };
        case "background_task_completed":
        case "orchestration_completed":
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

function shouldReplaceStepState(
    current: PasteLeadImportStatusState,
    next: PasteLeadImportStatusState
) {
    if (current === "failed" && next !== "failed") return false;
    if (current === "running" && next === "skipped") return false;
    if (current === "completed" && next === "running") return false;
    if (current === "completed" && next === "skipped") return false;
    return true;
}

export function buildPasteLeadProgressSteps(statuses: PasteLeadImportStatus[]): PasteLeadProgressStep[] {
    const steps = STEP_DEFAULTS.map((step) => ({ ...step }));
    const byKey = new Map(steps.map((step) => [step.key, step]));

    for (const status of statuses) {
        const mapped = stepStateFromEvent(status.event);
        if (!mapped) continue;
        const step = byKey.get(mapped.key);
        if (!step) continue;

        if (shouldReplaceStepState(step.state, mapped.state)) {
            step.state = mapped.state;
        }
        if (status.detail) step.detail = status.detail;
    }

    return steps;
}

export function createPasteLeadStatusesForBackgroundJobs(args: {
    pasteLeadTraceId?: string;
    backgroundJobsQueued?: string[];
    backgroundJobsSkipped?: string[];
}) {
    const statuses: PasteLeadImportStatus[] = [];
    for (const job of args.backgroundJobsQueued || []) {
        if (job === "googleAutoSync") {
            statuses.push(createPasteLeadStatus("google_autosync_queued", "running", {
                pasteLeadTraceId: args.pasteLeadTraceId,
                detail: "contact sync",
            }));
        } else if (job === "channelVerification") {
            statuses.push(createPasteLeadStatus("channel_verification_queued", "running", {
                pasteLeadTraceId: args.pasteLeadTraceId,
                detail: "WhatsApp/SMS check",
            }));
        } else if (job === "propertyEnrichment" || job === "tracePersistence") {
            statuses.push(createPasteLeadStatus("background_enrichment_queued", "running", {
                pasteLeadTraceId: args.pasteLeadTraceId,
                detail: job,
            }));
        } else if (job === "orchestration") {
            statuses.push(createPasteLeadStatus("orchestration_queued", "running", {
                pasteLeadTraceId: args.pasteLeadTraceId,
            }));
        } else if (job.startsWith("legacyPropertyImportQueue:")) {
            statuses.push(createPasteLeadStatus("property_import_queued", "completed", {
                pasteLeadTraceId: args.pasteLeadTraceId,
                detail: job.replace("legacyPropertyImportQueue:", "refs: "),
            }));
        }
    }

    for (const job of args.backgroundJobsSkipped || []) {
        if (job.startsWith("legacyPropertyImport:")) {
            statuses.push(createPasteLeadStatus("property_import_skipped", "skipped", {
                pasteLeadTraceId: args.pasteLeadTraceId,
                detail: job.replace("legacyPropertyImport:", "").replace(/_/g, " "),
            }));
        } else if (job.startsWith("orchestration:")) {
            statuses.push(createPasteLeadStatus("orchestration_skipped", "skipped", {
                pasteLeadTraceId: args.pasteLeadTraceId,
                detail: job.replace("orchestration:", "").replace(/_/g, " "),
            }));
        }
    }

    return statuses;
}
