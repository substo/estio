import assert from "node:assert/strict";
import test from "node:test";

import {
    buildPasteLeadProgressSteps,
    createPasteLeadStatus,
} from "./paste-lead-status";

test("buildPasteLeadProgressSteps maps successful paste lead import statuses", () => {
    const traceId = "paste_lead_test";
    const steps = buildPasteLeadProgressSteps([
        createPasteLeadStatus("paste_lead_import_started", "running", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("lead_parse_completed", "completed", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("contact_created", "completed", { pasteLeadTraceId: traceId }),
        createPasteLeadStatus("conversation_created", "completed", { pasteLeadTraceId: traceId }),
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
    assert.equal(steps.find((step) => step.key === "property")?.state, "completed");
    assert.equal(steps.find((step) => step.key === "property")?.detail, "DT4837");
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

    assert.equal(steps.find((step) => step.key === "property")?.state, "failed");
    assert.equal(steps.find((step) => step.key === "property")?.detail, "DT4837: Redis unavailable");
    assert.equal(steps.find((step) => step.key === "done")?.state, "completed");
});
