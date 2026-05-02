import test from "node:test";
import assert from "node:assert/strict";
import {
    buildConversationReferenceWhere,
    isLegacyLocalConversationAlias,
    isLikelyGhlConversationId,
} from "./identity.ts";

test("classifies legacy local aliases separately from GHL ids", () => {
    assert.equal(isLegacyLocalConversationAlias("wa_cmok1otl20003a4h2sbzbevgl"), true);
    assert.equal(isLegacyLocalConversationAlias("import_1777529171944"), true);
    assert.equal(isLegacyLocalConversationAlias("native-1769941007805-dqisk7"), true);
    assert.equal(isLegacyLocalConversationAlias("owa_1770402355398_9gmmbr"), true);

    assert.equal(isLikelyGhlConversationId("A0DQbYpSxEPptPbNvX41"), true);
    assert.equal(isLikelyGhlConversationId("wa_1777555318460_contact"), false);
    assert.equal(isLikelyGhlConversationId("native-1769941007805-dqisk7"), false);
});

test("builds a compatibility where clause for internal, legacy, and provider ids", () => {
    const where = buildConversationReferenceWhere("loc_1", "conv_or_remote_1");

    assert.equal(where.locationId, "loc_1");
    assert.deepEqual(where.OR, [
        { id: "conv_or_remote_1" },
        { ghlConversationId: "conv_or_remote_1" },
        {
            syncRecords: {
                some: {
                    providerConversationId: "conv_or_remote_1",
                },
            },
        },
    ]);
});
