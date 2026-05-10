import assert from "node:assert/strict";
import test from "node:test";
import {
    buildWhatsAppTemplateComponents,
    normalizeTemplateName,
    renderTemplatePreview,
    validateWhatsAppTemplate,
} from "./templates";

test("normalizeTemplateName keeps Meta-safe lowercase names", () => {
    assert.equal(normalizeTemplateName("Viewing Reminder!"), "viewing_reminder");
    assert.equal(normalizeTemplateName("__Owner  Update__"), "owner_update");
});

test("validateWhatsAppTemplate rejects non-sequential variables", () => {
    const result = validateWhatsAppTemplate({
        name: "bad_variables",
        language: "en_US",
        category: "UTILITY",
        bodyText: "Hi {{1}}, your viewing is at {{3}}.",
        examples: { "1": "Martin", "3": "Tuesday" },
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /sequential/);
});

test("validateWhatsAppTemplate requires examples for variables", () => {
    const result = validateWhatsAppTemplate({
        name: "missing_example",
        language: "en_US",
        category: "UTILITY",
        bodyText: "Hi {{1}}, your viewing is confirmed.",
        examples: {},
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /Sample value/);
});

test("validateWhatsAppTemplate warns when utility copy looks promotional", () => {
    const result = validateWhatsAppTemplate({
        name: "promo_utility",
        language: "en_US",
        category: "UTILITY",
        bodyText: "Exclusive offer for {{1}}.",
        examples: { "1": "Martin" },
    });

    assert.equal(result.ok, true);
    assert.match(result.warnings.join(" "), /Marketing/);
});

test("buildWhatsAppTemplateComponents emits Meta body examples", () => {
    const components = buildWhatsAppTemplateComponents({
        headerText: "Viewing reminder",
        bodyText: "Hi {{1}}, viewing {{2}} is tomorrow.",
        footerText: "Reply STOP to opt out",
        examples: { "1": "Martin", "2": "Sea View Villa" },
    });

    assert.equal(components[0].type, "HEADER");
    assert.deepEqual(components[1].example.body_text, [["Martin", "Sea View Villa"]]);
    assert.equal(renderTemplatePreview(components[1].text, { "1": "Martin", "2": "Sea View Villa" }), "Hi Martin, viewing Sea View Villa is tomorrow.");
});
