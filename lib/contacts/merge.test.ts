import test from "node:test";
import assert from "node:assert/strict";
import {
    buildSourceContactMergeSnapshot,
    parseContactHistoryChanges,
    prepareContactMergeFillData,
    splitContactMergeFillDataForSourceDelete,
} from "./merge";

test("prepareContactMergeFillData fills only blank scalar fields and merges additive arrays", () => {
    const source = {
        email: "source@example.com",
        phone: "+35799999999",
        name: "Source Name",
        tags: ["vip", "buyer"],
        propertiesInterested: ["property-1", "property-2"],
        propertiesInspected: ["property-3"],
        propertiesEmailed: [],
        propertiesMatched: ["property-4"],
    };
    const target = {
        email: "",
        phone: "+35711111111",
        name: "Target Name",
        tags: ["vip"],
        propertiesInterested: ["property-1"],
        propertiesInspected: [],
        propertiesEmailed: [],
        propertiesMatched: ["property-4"],
    };

    const result = prepareContactMergeFillData(source, target);

    assert.deepEqual(result.tagsAdded, ["buyer"]);
    assert.deepEqual(result.fillData, {
        email: "source@example.com",
        tags: ["vip", "buyer"],
        propertiesInterested: ["property-1", "property-2"],
        propertiesInspected: ["property-3"],
    });
});

test("parseContactHistoryChanges preserves existing values and parses serialized JSON", () => {
    assert.deepEqual(parseContactHistoryChanges('{"sourceId":"contact-1"}'), { sourceId: "contact-1" });
    assert.equal(parseContactHistoryChanges("not json"), "not json");
    assert.deepEqual(parseContactHistoryChanges({ sourceId: "contact-2" }), { sourceId: "contact-2" });
    assert.equal(parseContactHistoryChanges(null), null);
});

test("splitContactMergeFillDataForSourceDelete delays unique contact fields", () => {
    const { fillData } = prepareContactMergeFillData(
        {
            email: "source@example.com",
            phone: "+35799999999",
            name: "Source Name",
            tags: ["buyer"],
            propertiesInterested: ["property-1"],
        },
        {
            email: null,
            phone: "",
            name: null,
            tags: [],
            propertiesInterested: [],
        }
    );

    const result = splitContactMergeFillDataForSourceDelete(fillData);

    assert.deepEqual(result.nonUniqueFillData, {
        name: "Source Name",
        tags: ["buyer"],
        propertiesInterested: ["property-1"],
    });
    assert.deepEqual(result.uniqueFillData, {
        email: "source@example.com",
        phone: "+35799999999",
    });
});

test("prepareContactMergeFillData overwrites conflicts only when source is selected", () => {
    const source = {
        email: "source@example.com",
        phone: "+35799999999",
        name: "Source Name",
        notes: "Source notes",
    };
    const target = {
        email: "target@example.com",
        phone: "+35711111111",
        name: "Target Name",
        notes: "Target notes",
    };

    assert.deepEqual(prepareContactMergeFillData(source, target).fillData, {});

    assert.deepEqual(prepareContactMergeFillData(source, target, {
        email: "source",
        phone: "target",
        notes: "source",
    }).fillData, {
        email: "source@example.com",
        notes: "Source notes",
    });
});

test("buildSourceContactMergeSnapshot preserves deleted source values for audit", () => {
    const snapshot = buildSourceContactMergeSnapshot({
        id: "source-1",
        locationId: "loc-1",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        updatedAt: new Date("2026-01-03T03:04:05.000Z"),
        name: "Source Name",
        phone: "+35799999999",
        email: "source@example.com",
        notes: "Important source note",
        tags: ["vip"],
        propertiesInterested: ["property-1"],
    });

    assert.equal(snapshot.id, "source-1");
    assert.equal(snapshot.createdAt, "2026-01-02T03:04:05.000Z");
    assert.equal(snapshot.name, "Source Name");
    assert.equal(snapshot.phone, "+35799999999");
    assert.equal(snapshot.notes, "Important source note");
    assert.deepEqual(snapshot.tags, ["vip"]);
    assert.deepEqual(snapshot.propertiesInterested, ["property-1"]);
});
