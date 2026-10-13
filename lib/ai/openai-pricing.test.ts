import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenAiPricingPage } from "./openai-pricing";

test("reads the official pricing page's embedded text and audio rates", () => {
    const html = `[[0,&quot;gpt-4o-mini&quot;],[0,0.15],[0,0.075],[0,0.6]]
        &quot;model&quot;:[0,&quot;gpt-realtime-translate&quot;],&quot;rows&quot;:[1,[[1,[[0,&quot;Live translation&quot;],[0,&quot;-&quot;],[0,&quot;-&quot;],[0,&quot;$0.034 / minute&quot;]]]]]`;
    const prices = parseOpenAiPricingPage(html, new Date("2026-10-13T00:00:00Z"));
    assert.equal(prices.find(price => price.modelId === "gpt-4o-mini")?.inputPer1MTokens, .15);
    assert.equal(prices.find(price => price.modelId === "gpt-realtime-translate")?.perMinuteUsd, .034);
    assert.equal(prices[0].fetchedAt, "2026-10-13T00:00:00.000Z");
});

test("fails closed when the provider changes the page format", () => {
    assert.throws(() => parseOpenAiPricingPage("<html>new layout</html>"), /no recognized model rates/);
});
