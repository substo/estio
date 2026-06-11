import assert from "node:assert/strict";
import test from "node:test";

import { parseR2Uri } from "./media-r2";

test("parseR2Uri parses canonical bucket/key URIs", () => {
    assert.deepEqual(
        parseR2Uri("r2://whatsapp-media/whatsapp/web-bridge/v1/env/production/file.jpg"),
        {
            bucket: "whatsapp-media",
            key: "whatsapp/web-bridge/v1/env/production/file.jpg",
        },
    );
});

test("parseR2Uri accepts legacy outbound media URIs without bucket segment", () => {
    assert.deepEqual(
        parseR2Uri("r2://whatsapp/web-bridge/v1/env/production/location/loc_1/file.jpg"),
        {
            bucket: "whatsapp-media",
            key: "whatsapp/web-bridge/v1/env/production/location/loc_1/file.jpg",
        },
    );
});
