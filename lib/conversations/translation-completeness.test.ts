import assert from "node:assert/strict";
import test from "node:test";

import { validateReplyTranslationCompleteness } from "./translation-completeness";

test("rejects long reply translations that are obviously truncated", () => {
    const sourceText = [
        "Hi Timea,",
        "",
        "Understood, no problem at all regarding that new option.",
        "",
        "We can focus on the other two instead. The 2-bedroom apartment at Aphrodite Gardens (Ref: DT4059) is still available.",
        "",
        "To give you some context, Leptos is currently selling a smaller 1-bedroom apartment in the same complex for €299,000:",
        "https://www.leptosestates.com/properties/1-bedroom-apartment-003-block-c-aphrodite-gardens",
        "",
        "They also have a 2-bedroom apartment in Block A of the same complex listed for €435,000:",
        "https://www.leptosestates.com/properties/2-bedroom-apartment-503-block-a-aphrodite-gardens",
        "",
        "Ours is a 2-bedroom for €280,000 with no VAT, making it a really strong option.",
        "",
        "Would you like to arrange a viewing?",
        "https://www.downtowncyprus.com/properties/apartment-for-sale-in-kato-paphos-universal-paphos-ref-dt4059",
    ].join("\n");

    const translatedText = [
        "Szia Timea,",
        "Megertettem, semmi problema azzal az uj lehetoseggel kapcsolatban.",
        "",
        "Ehelyett fokuszalhatunk a masik kettore. Az Aphrodite Gardens-ben talalhato 2 haloszobas lakas meg elerheto.",
        "",
        "Osszehasonlitaskepen",
    ].join("\n");

    assert.deepEqual(
        validateReplyTranslationCompleteness({ sourceText, translatedText }),
        { ok: false, reason: "missing_source_urls" }
    );
});

test("accepts complete translations that preserve source URLs", () => {
    const sourceText = [
        "This apartment is still available:",
        "https://www.example.com/property-a",
        "",
        "The alternative is here:",
        "https://www.example.com/property-b",
    ].join("\n");
    const translatedText = [
        "Ez a lakas meg elerheto:",
        "https://www.example.com/property-a",
        "",
        "Az alternativa itt talalhato:",
        "https://www.example.com/property-b",
    ].join("\n");

    assert.deepEqual(
        validateReplyTranslationCompleteness({ sourceText, translatedText }),
        { ok: true }
    );
});

test("rejects long translations with implausibly short output even without URLs", () => {
    const sourceText = "A".repeat(700);
    const translatedText = "B".repeat(100);

    assert.deepEqual(
        validateReplyTranslationCompleteness({ sourceText, translatedText }),
        { ok: false, reason: "translation_too_short" }
    );
});
