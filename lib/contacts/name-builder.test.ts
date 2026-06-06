import test from "node:test";
import assert from "node:assert/strict";
import { buildStructuredLeadDisplayName, inferLeadContactRoleFromSignals } from "./name-builder";

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

test("buildStructuredLeadDisplayName includes role and goal when multiple property refs exist, omitting property details", () => {
    const result = buildStructuredLeadDisplayName({
        contact: {
            name: "John Doe",
            role: "Lead",
        },
        rawLeadText: "John Doe is interested in REF123 and DT456 for purchase.",
        inferredStatus: "For Sale",
        matchedProperty: null,
        requirements: {
            bedrooms: "2",
            type: "apartment",
            location: "Limassol",
        },
    });

    assert.equal(result, "John Doe Lead Sale REF123, DT456");
});

test("inferLeadContactRoleFromSignals detects explicit owner and agent roles", () => {
    assert.equal(inferLeadContactRoleFromSignals({
        parsedRole: "Owner",
        name: "Rafaela Hadid",
    }), "Owner");

    assert.equal(inferLeadContactRoleFromSignals({
        parsedRole: "Agent",
        name: "Maria",
    }), "Agent");
});

test("inferLeadContactRoleFromSignals detects obvious role labels in contact names", () => {
    assert.equal(inferLeadContactRoleFromSignals({
        contactType: "Lead",
        name: "George Owner DT4930",
    }), "Owner");

    assert.equal(inferLeadContactRoleFromSignals({
        contactType: "Lead",
        name: "Nicosia Property Agent",
    }), "Agent");
});

test("inferLeadContactRoleFromSignals detects structured role context but avoids weak text", () => {
    assert.equal(inferLeadContactRoleFromSignals({
        contactType: "Lead",
        texts: ["Contact role: landlord"],
    }), "Owner");

    assert.equal(inferLeadContactRoleFromSignals({
        contactType: "Lead",
        texts: ["Client asked whether the owner would accept a lower offer."],
    }), "Lead");
});

test("inferLeadContactRoleFromSignals keeps normal buyer and renter leads eligible", () => {
    assert.equal(inferLeadContactRoleFromSignals({
        contactType: "Lead",
        name: "John Buyer",
        texts: ["Looking for a two-bedroom flat in Paphos."],
    }), "Lead");
});
