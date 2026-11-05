import assert from "node:assert/strict";
import test from "node:test";
import { displayValue, fromText, toText } from "./field-text";

test("field text round-trips every structured kind", () => {
  const cases: [Parameters<typeof toText>[0], string][] = [
    ["list", "Sales\nRentals"],
    ["phones", "Office | +357 26 000000\n+357 99 123456"],
    ["links", "facebook | https://facebook.com/x"],
    ["colours", "primary | #9d0917"],
    ["competitors", "Acme | https://acme.cy | big agency\nSolo"],
    ["hours", "mon | 09:00-17:00\nsun | closed"],
  ];
  for (const [kind, text] of cases) assert.equal(toText(kind, fromText(kind, text)), text, kind);
});

test("empty text clears, codes are upper-cased, bare links get a platform", () => {
  assert.equal(fromText("text", "   "), null);
  assert.equal(fromText("countryCode", "cy"), "CY");
  assert.deepEqual(fromText("links", "https://www.instagram.com/x"), [{ platform: "instagram", url: "https://www.instagram.com/x" }]);
  assert.deepEqual(fromText("hours", "Monday | 9:00 - 17:00"), [{ day: "mon", closed: false, opens: "9:00", closes: "17:00" }]);
});

test("display values are one line and bounded", () => {
  assert.equal(displayValue("list", ["a", "b"]), "a · b");
  assert.equal(displayValue("longtext", "x".repeat(300), 10).length, 10);
  assert.equal(displayValue("text", null), "");
  assert.equal(displayValue("phones", [{ label: "Office", number: "+357 26 000000" }]), "Office +357 26 000000");
  assert.equal(displayValue("links", [{ platform: "facebook", url: "https://facebook.com/x" }]), "facebook: https://facebook.com/x");
});
