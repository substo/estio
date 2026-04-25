import test from "node:test";
import assert from "node:assert/strict";
import { buildStructuredLeadDisplayName } from "./name-builder";

test("buildStructuredLeadDisplayName uses provided display labels and sale goal cleanly", () => {
    const result = buildStructuredLeadDisplayName({
        contact: {
            name: "Rafaela Hadid",
            role: "Owner",
        },
        rawLeadText: "Rafaela Hadid Ref. No. DT4674 Spacious 3 Bedroom Apartment with Large Verandas & Communal Pool",
        inferredStatus: "For Sale",
        matchedProperty: {
            title: "Spacious 3 Bedroom Apartment with Large Verandas & Communal Pool",
            reference: "DT4674",
            propertyLocation: "Paphos",
            city: "Universal",
        },
        requirements: {
            bedrooms: "3",
            type: "apartment",
            location: "Universal",
        },
    });

    assert.equal(result, "Rafaela Hadid Owner Sale DT4674 3Bdr Apt Paphos");
});
