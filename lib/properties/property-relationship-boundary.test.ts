import assert from "node:assert/strict";
import test from "node:test";

import { filterPropertyRelationshipsToLocation } from "./property-relationship-boundary";

test("contaminated foreign stakeholder relationships are excluded from rendering and export", () => {
    const property = {
        id: "property-a",
        contactRoles: [
            { role: "owner", contact: { id: "contact-a", locationId: "location-a" } },
            { role: "agent", contact: { id: "contact-b", locationId: "location-b" } },
        ],
        companyRoles: [
            { role: "developer", company: { id: "company-a", locationId: "location-a" } },
            { role: "management", company: { id: "company-b", locationId: "location-b" } },
        ],
    };

    const filtered = filterPropertyRelationshipsToLocation(property, "location-a");
    assert.deepEqual(filtered.contactRoles?.map((role) => role.contact?.id), ["contact-a"]);
    assert.deepEqual(filtered.companyRoles?.map((role) => role.company?.id), ["company-a"]);
});
