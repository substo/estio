import assert from "node:assert/strict";
import test from "node:test";

import {
    mapToRequirementPriceOption,
    normalizeRequirementPriceOption,
    REQUIREMENT_PRICE_SELECT_OPTIONS,
} from "./requirement-price-options";

test("requirement price options include budgets above 175000", () => {
    assert.ok(REQUIREMENT_PRICE_SELECT_OPTIONS.includes("€200,000"));
    assert.ok(REQUIREMENT_PRICE_SELECT_OPTIONS.includes("€10,000,000"));
});

test("normalizes raw old CRM numeric price values", () => {
    assert.equal(normalizeRequirementPriceOption("175000"), "€175,000");
    assert.equal(normalizeRequirementPriceOption("200000"), "€200,000");
    assert.equal(normalizeRequirementPriceOption("€1,250,000"), "€1,250,000");
    assert.equal(normalizeRequirementPriceOption("0"), "Any");
});

test("maps parsed budgets to the expanded requirement price points", () => {
    assert.equal(mapToRequirementPriceOption(175000), "€175,000");
    assert.equal(mapToRequirementPriceOption(200000), "€200,000");
    assert.equal(mapToRequirementPriceOption(275000), "€250,000");
    assert.equal(mapToRequirementPriceOption(10000000), "€10,000,000");
});
