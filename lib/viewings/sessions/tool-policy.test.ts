import assert from "node:assert/strict";
import test from "node:test";
import { isViewingLiveToolAllowed } from "@/lib/viewings/sessions/tool-policy";

test("live tool policy allows only read-only tools in v1", () => {
    assert.equal(isViewingLiveToolAllowed("resolve_viewing_property_context"), true);
    assert.equal(isViewingLiveToolAllowed("search_related_properties"), true);
    assert.equal(isViewingLiveToolAllowed("fetch_company_playbook"), true);
    assert.equal(isViewingLiveToolAllowed("write_crm_note"), false);
    assert.equal(isViewingLiveToolAllowed("send_whatsapp"), false);
});
