import test from "node:test";
import assert from "node:assert/strict";
import {
    parseContactHistoryChanges,
    prepareContactMergeFillData,
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
