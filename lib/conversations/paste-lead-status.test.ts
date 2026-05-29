import assert from "node:assert/strict";
import test from "node:test";

import {
    buildPasteLeadProgressSteps,
    createPasteLeadStatusesForBackgroundJobs,
    createPasteLeadStatus,
} from "./paste-lead-status";

test("buildPasteLeadProgressSteps maps successful paste lead import statuses", () => {
    const traceId = "paste_lead_test";
    const steps = buildPasteLeadProgressSteps([
        createPasteLeadStatus("paste_lead_import_started", "running", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("lead_parse_completed", "completed", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("contact_created", "completed", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("conversation_created", "completed", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("message_created", "completed", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("property_ref_detected", "completed", {
            pasteLeadTraceId: traceId,
            detail: "DT4837",
        }),
        createPasteLeadStatus("property_import_queued", "completed", {
            pasteLeadTraceId: traceId,
            detail: "DT4837",
        }),
        createPasteLeadStatus("background_task_started", "running", {
            pasteLeadTraceId: traceId,
            detail: "paste_lead_orchestrate:conversation",
        }),
        createPasteLeadStatus("paste_lead_import_completed", "completed", { pasteLeadTraceId: traceId }),
    ]);

    assert.equal(steps.find((step) => step.key === "parse")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "contact")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "conversation")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "message")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "propertyDetect")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "propertyLink")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "propertyLink")?.detail, "DT4837");
    assert.equal(steps.find((step) => step.key === "background")?.state, "running");
    assert.equal(steps.find((step) => step.key === "done")?.state, "completed");
});

test("buildPasteLeadProgressSteps keeps a property queue failure visible", () => {
    const steps = buildPasteLeadProgressSteps([
        createPasteLeadStatus("lead_parse_completed", "completed"),
        createPasteLeadStatus("contact_updated", "completed"),
        createPasteLeadStatus("conversation_updated", "completed"),
        createPasteLeadStatus("property_import_failed_to_queue", "failed", {
            detail: "DT4837: Redis unavailable",
        }),
        createPasteLeadStatus("paste_lead_import_completed", "completed"),
    ]);

    assert.equal(steps.find((step) => step.key === "propertyLink")?.state, "failed");
    assert.equal(steps.find((step) => step.key === "propertyLink")?.detail, "DT4837: Redis unavailable");
    assert.equal(steps.find((step) => step.key === "done")?.state, "completed");
});

test("buildPasteLeadProgressSteps maps failed parse status", () => {
    const steps = buildPasteLeadProgressSteps([
        createPasteLeadStatus("paste_lead_import_started", "running"),
        createPasteLeadStatus("lead_parse_started", "running"),
        createPasteLeadStatus("lead_parse_failed", "failed", { detail: "Could not parse lead text" }),
        createPasteLeadStatus("paste_lead_import_failed", "failed", { detail: "Could not parse lead text" }),
    ]);

    assert.equal(steps.find((step) => step.key === "parse")?.state, "failed");
    assert.equal(steps.find((step) => step.key === "parse")?.detail, "Could not parse lead text");
    assert.equal(steps.find((step) => step.key === "done")?.state, "failed");
});

test("buildPasteLeadProgressSteps maps background queued and skipped labels", () => {
    const steps = buildPasteLeadProgressSteps([
        createPasteLeadStatus("google_autosync_queued", "running", { detail: "contact-1" }),
        createPasteLeadStatus("channel_verification_queued", "running", { detail: "conversation-1" }),
        createPasteLeadStatus("orchestration_skipped", "skipped", { detail: "no callback" }),
    ]);

    assert.equal(steps.find((step) => step.key === "background")?.state, "running");
    assert.equal(steps.find((step) => step.key === "background")?.detail, "no callback");
});

test("createPasteLeadStatusesForBackgroundJobs maps Old CRM import queued and skipped metadata", () => {
    const statuses = createPasteLeadStatusesForBackgroundJobs({
        pasteLeadTraceId: "trace-1",
        backgroundJobsQueued: ["legacyPropertyImportQueue:2", "googleAutoSync"],
        backgroundJobsSkipped: ["legacyPropertyImport:capability_unavailable"],
    });

    assert.deepEqual(statuses.map((status) => [status.event, status.state, status.detail, status.pasteLeadTraceId]), [
        ["property_import_queued", "completed", "refs: 2", "trace-1"],
        ["google_autosync_queued", "running", "contact sync", "trace-1"],
        ["property_import_skipped", "skipped", "capability unavailable", "trace-1"],
    ]);
});
