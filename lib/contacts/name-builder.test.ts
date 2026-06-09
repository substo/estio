import test from "node:test";
import assert from "node:assert/strict";
import {
    buildCanonicalContactName,
    buildStructuredLeadDisplayName,
    hasContactPersonNameNoise,
    inferLeadContactRoleFromSignals,
    parseContactPersonNameFromDisplayName,
} from "./name-builder";

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

    assert.equal(result, "Rafaela Hadid Owner DT4674");
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

test("buildCanonicalContactName uses contact role naming for non-leads", () => {
    const result = buildCanonicalContactName({
        contact: { name: "Andreas" },
        contactType: "Owner",
        rawLeadText: "Owner name: Andreas. Ref DT4930.",
    });

    assert.equal(result, "Andreas Owner DT4930");
});

test("buildCanonicalContactName avoids duplicate non-lead role labels", () => {
    assert.equal(buildCanonicalContactName({
        contact: { name: "Maria Agent" },
        contactType: "Agent",
    }), "Maria Agent");

    assert.equal(buildCanonicalContactName({
        contact: { name: "Andreas Owner DT4930" },
        contactType: "Owner",
        rawLeadText: "Ref DT4930",
    }), "Andreas Owner DT4930");
});

test("parseContactPersonNameFromDisplayName removes role and property reference tokens", () => {
    assert.deepEqual(parseContactPersonNameFromDisplayName("Andreas Owner DT4930"), {
        firstName: "Andreas",
        lastName: "",
        fullName: "Andreas",
    });

    assert.deepEqual(parseContactPersonNameFromDisplayName("Maria Papadopoulou Agent"), {
        firstName: "Maria",
        lastName: "Papadopoulou",
        fullName: "Maria Papadopoulou",
    });

    assert.deepEqual(parseContactPersonNameFromDisplayName("John Smith Lead Rent DT4930"), {
        firstName: "John",
        lastName: "Smith",
        fullName: "John Smith",
    });

    assert.deepEqual(parseContactPersonNameFromDisplayName("Silvia Lead Sale DT1367 3Bdr Villa Peyia"), {
        firstName: "Silvia",
        lastName: "",
        fullName: "Silvia",
    });

    assert.deepEqual(parseContactPersonNameFromDisplayName("Kristina Grüße Lead Sale DT2937 2Bdr Town House Peyia"), {
        firstName: "Kristina",
        lastName: "Grüße",
        fullName: "Kristina Grüße",
    });
});

test("parseContactPersonNameFromDisplayName avoids company names and contact details", () => {
    assert.deepEqual(parseContactPersonNameFromDisplayName("ABC Properties Agent"), {
        firstName: "",
        lastName: "",
        fullName: "",
    });

    assert.deepEqual(parseContactPersonNameFromDisplayName("Cyprus Estates"), {
        firstName: "",
        lastName: "",
        fullName: "",
    });

    assert.deepEqual(parseContactPersonNameFromDisplayName("Elena Markou +357 99 123456 elena@example.com"), {
        firstName: "Elena",
        lastName: "Markou",
        fullName: "Elena Markou",
    });
});

test("hasContactPersonNameNoise detects CRM display tokens without flagging clean names", () => {
    assert.equal(hasContactPersonNameNoise("Papadopoulou Agent DT4930"), true);
    assert.equal(hasContactPersonNameNoise("John Smith"), false);
    assert.equal(hasContactPersonNameNoise("Alexandra Saleh"), false);
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
