import assert from "node:assert/strict";
import test from "node:test";
import { crmFeatureSettingsPatch } from "./fields";

test("saving one CRM feature neither edits routing nor clears another feature's controls", () => {
    const existing = { aiRouting: { chain: [{ kind: "device_codex" }] }, viewingSessionRetentionDays: 365 };
    const data = new FormData();
    data.set("googleAiModelTranscription", "gemini-2.5-flash");
    data.set("whatsappTranscriptRetentionDays", "30");
    data.set("whatsappTranscriptVisibility", "admin_only");
    data.set("viewingSessionRetentionDays", "30");
    data.set("aiRouting", "{}");

    const patch = crmFeatureSettingsPatch("conversations", data, existing);
    assert.equal(patch.googleAiModelTranscription, "gemini-2.5-flash");
    assert.equal(patch.whatsappTranscriptRetentionDays, 30);
    assert.equal(patch.whatsappTranscriptVisibility, "admin_only");
    assert.equal("viewingSessionRetentionDays" in patch, false);
    assert.equal("aiRouting" in patch, false);
});

test("contact settings keep saved run history and narrower older automation modes", () => {
    const existing = {
        requirementsIntelligence: { mode: "new_activity", lastRun: { status: "completed" } },
        contactProfileVerification: { mode: "new_contacts", newContactDelayHours: 4, recertificationDays: 60 },
    };
    const data = new FormData();
    data.set("leadIntelligenceMode", "automatic");
    data.set("leadIntelligenceBatchSize", "25");
    const patch = crmFeatureSettingsPatch("contacts", data, existing);
    assert.deepEqual(patch.requirementsIntelligence, {
        mode: "new_activity",
        lastRun: { status: "completed" },
        model: "gemini-2.5-flash",
        allowedPropertyDomains: [],
        activityDebounceMinutes: 1440,
        autoReprocessCampaignCandidates: false,
    });
    assert.match(JSON.stringify(patch.contactProfileVerification), /"mode":"new_contacts"/);
    assert.match(JSON.stringify(patch.contactProfileVerification), /"newContactDelayHours":4/);
    assert.match(JSON.stringify(patch.contactProfileVerification), /"recertificationDays":60/);
});
