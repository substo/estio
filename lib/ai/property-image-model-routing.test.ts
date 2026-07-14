import test from "node:test";
import assert from "node:assert/strict";

import { resolvePropertyImageGenerationProvider } from "@/lib/ai/property-image-model-routing";

test("resolvePropertyImageGenerationProvider maps model prefixes to providers", () => {
    assert.equal(resolvePropertyImageGenerationProvider("openai:gpt-image-2"), "openai_api");
    assert.equal(resolvePropertyImageGenerationProvider("chatgpt_subscription:gpt-image-2"), "chatgpt_subscription");
    assert.equal(resolvePropertyImageGenerationProvider("gemini-3.1-flash-image"), "google_gemini");
});
