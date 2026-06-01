import assert from "node:assert/strict";
import test from "node:test";

import { buildContactRequirementGuide } from "./coordinator";

test("buildContactRequirementGuide includes non-empty requirement guidance", () => {
    const guide = buildContactRequirementGuide({
        leadGoal: "To Rent",
        requirementStatus: "For Rent",
        requirementDistrict: "Limassol",
        requirementBedrooms: "2",
        requirementMinPrice: "1000",
        requirementMaxPrice: "1600",
        requirementPropertyTypes: ["Apartment", "Penthouse"],
        requirementPropertyLocations: ["Germasogeia", "Neapolis"],
        requirementOtherDetails: "Needs parking.",
        requirementSummary: "Prefers modern buildings near the sea.",
    });

    assert.match(guide, /Client requirement guide:/);
    assert.match(guide, /Lead goal: To Rent/);
    assert.match(guide, /Locations: Germasogeia, Neapolis/);
    assert.match(guide, /Budget: 1000 - 1600/);
    assert.match(guide, /Other details: Needs parking/);
    assert.match(guide, /Use this as relevance guidance/);
});

test("buildContactRequirementGuide omits empty requirement values", () => {
    const guide = buildContactRequirementGuide({
        requirementDistrict: "",
        requirementPropertyTypes: [],
        requirementMaxPrice: "500000",
    });

    assert.doesNotMatch(guide, /District:/);
    assert.doesNotMatch(guide, /Property types:/);
    assert.match(guide, /Budget: Any - 500000/);
});

test("buildContactRequirementGuide handles contacts without recorded requirements", () => {
    assert.equal(
        buildContactRequirementGuide({}),
        "Client requirement guide: No approved requirements recorded."
    );
});
