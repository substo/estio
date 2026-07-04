import assert from "node:assert/strict";
import test from "node:test";

import { resolveManualDraftSkillRouting } from "./manual-draft-routing";

test("manual draft routing defaults to Northstar lead intake", () => {
    assert.deepEqual(resolveManualDraftSkillRouting("Draft the best next reply"), {
        forceSkillId: "lead_intake_booking",
        objectiveHint: "book_viewing",
        reason: "northstar_default_lead_intake",
    });
});

test("manual draft routing sends booking language to viewing management", () => {
    assert.deepEqual(resolveManualDraftSkillRouting("Ask what time works tomorrow for the viewing"), {
        forceSkillId: "viewing_management",
        objectiveHint: "book_viewing",
        reason: "booking_or_viewing_language",
    });
});

test("manual draft routing sends property matching language to property search", () => {
    assert.deepEqual(resolveManualDraftSkillRouting("Find similar 2 bedroom apartments within budget"), {
        forceSkillId: "property_search",
        objectiveHint: "listing_alert",
        reason: "property_search_language",
    });
});

test("manual draft routing prioritizes closing and offer language over generic deal mode", () => {
    assert.equal(resolveManualDraftSkillRouting("Prepare reservation paperwork", { mode: "deal" }).forceSkillId, "closer");
    assert.equal(resolveManualDraftSkillRouting("Reply to the counter offer", { mode: "deal" }).forceSkillId, "negotiator");
});
