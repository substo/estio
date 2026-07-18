import test from "node:test";
import assert from "node:assert/strict";
import { parseLocationMarketProfileSettings } from "./market-profile-settings";

test("market profile settings normalize international market values", () => {
  const result = parseLocationMarketProfileSettings({
    countryCode: "ae",
    countryName: "United Arab Emirates",
    locale: "ar-ae",
    currencyCode: "aed",
    supportedLanguages: "ar, en, hi-IN",
    serviceAreasJson: JSON.stringify([
      { id: "dubai", label: "Dubai", aliases: ["دبي"], parentId: null, kind: "city" },
      { id: "marina", label: "Dubai Marina", aliases: ["مرسى دبي"], parentId: "dubai", kind: "locality" },
    ]),
  });

  assert.deepEqual(result.errors, undefined);
  assert.equal(result.profile?.countryCode, "AE");
  assert.equal(result.profile?.locale, "ar-AE");
  assert.equal(result.profile?.currencyCode, "AED");
  assert.deepEqual(result.profile?.supportedLanguages, ["ar", "en", "hi-IN"]);
  assert.equal(result.profile?.serviceAreas[1].parentId, "dubai");
});

test("market profile settings reject invalid codes and broken hierarchy", () => {
  const result = parseLocationMarketProfileSettings({
    countryCode: "Dubai",
    locale: "not_a_locale",
    currencyCode: "dirham",
    supportedLanguages: "en, invalid_language",
    serviceAreasJson: JSON.stringify([
      { id: "marina", label: "Dubai Marina", aliases: [], parentId: "missing", kind: "locality" },
    ]),
  });

  assert.ok(result.errors?.marketCountryCode);
  assert.ok(result.errors?.marketLocale);
  assert.ok(result.errors?.marketCurrencyCode);
  assert.ok(result.errors?.marketSupportedLanguages);
  assert.match(result.errors?.marketServiceAreas?.[0] || "", /unknown parent/);
});

test("market profile settings reject cyclic service areas", () => {
  const result = parseLocationMarketProfileSettings({
    serviceAreasJson: JSON.stringify([
      { id: "one", label: "One", aliases: [], parentId: "two", kind: "region" },
      { id: "two", label: "Two", aliases: [], parentId: "one", kind: "city" },
    ]),
  });

  assert.match(result.errors?.marketServiceAreas?.[0] || "", /cycle/);
});
