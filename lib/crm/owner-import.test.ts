import test from "node:test";
import assert from "node:assert/strict";
import {
    classifyImportedOwnerEntity,
    hasMeaningfulCompanyName,
    isLikelyAutomatedOwnerName,
} from "./owner-import";

test("classifyImportedOwnerEntity treats automated XML owners as organizations", () => {
    assert.equal(
        classifyImportedOwnerEntity({
            ownerName: "Automated XML Import Owner Rent DT2288 0Bdr 32 paphos",
            ownerCompany: null,
        }),
        "organization"
    );
});

test("classifyImportedOwnerEntity keeps simple person names as people", () => {
    assert.equal(
        classifyImportedOwnerEntity({
            ownerName: "Andreas Nicolaou",
            ownerCompany: "Downtown Estates",
        }),
        "person"
    );
});

test("classifyImportedOwnerEntity treats company-backed brand names as organizations", () => {
    assert.equal(
        classifyImportedOwnerEntity({
            ownerName: "Korantina",
            ownerCompany: "Korantina Homes",
        }),
        "organization"
    );
});

test("hasMeaningfulCompanyName ignores duplicated owner/company names", () => {
    assert.equal(hasMeaningfulCompanyName("Andreas Nicolaou", "Andreas Nicolaou"), false);
    assert.equal(hasMeaningfulCompanyName("Downtown Estates", "Andreas Nicolaou"), true);
});

test("isLikelyAutomatedOwnerName catches feed-style placeholders", () => {
    assert.equal(isLikelyAutomatedOwnerName("Automated XML Import Owner Sale DT3327"), true);
    assert.equal(isLikelyAutomatedOwnerName("Maria Ioannou"), false);
});

test("classifyImportedOwnerEntity does not treat dropdown labels with phone suffix as organizations", () => {
    assert.equal(
        classifyImportedOwnerEntity({
            ownerName: "Olga",
            legacyOwnerLabel: "Olga m: +357 99 247036",
            ownerCompany: null,
        }),
        "person"
    );
});
