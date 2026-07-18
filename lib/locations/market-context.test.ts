import test from "node:test";
import assert from "node:assert/strict";
import { buildLocationMarketContext } from "./market-context";

test("market context keeps configured international offices isolated", () => {
  const madrid = buildLocationMarketContext({
    locationId: "madrid",
    locationName: "Madrid",
    marketProfile: {
      countryCode: "ES",
      locale: "es-ES",
      currencyCode: "EUR",
      supportedLanguages: ["es", "en"],
      serviceAreas: [
        { id: "madrid-city", label: "Madrid", aliases: ["Madrid Capital"], parentId: null, kind: "city" },
        { id: "salamanca", label: "Salamanca", aliases: [], parentId: "madrid-city", kind: "district" },
      ],
    },
    inventory: [{ country: "Spain", currency: "EUR", city: "Madrid", propertyLocation: "Salamanca" }],
  });
  const dubai = buildLocationMarketContext({
    locationId: "dubai",
    locationName: "Dubai",
    marketProfile: {
      countryCode: "AE",
      locale: "ar-AE",
      currencyCode: "AED",
      supportedLanguages: ["ar", "en"],
      serviceAreas: [
        { id: "dubai-city", label: "Dubai", aliases: ["دبي"], parentId: null, kind: "city" },
        { id: "marina", label: "Dubai Marina", aliases: ["مرسى دبي"], parentId: "dubai-city", kind: "locality" },
      ],
    },
    inventory: [{ country: "United Arab Emirates", currency: "AED", city: "Dubai", propertyLocation: "Dubai Marina" }],
  });

  assert.equal(madrid.countryCode, "ES");
  assert.equal(madrid.countryName, "Spain");
  assert.equal(madrid.currencyCode, "EUR");
  assert.deepEqual(madrid.supportedLanguages, ["es", "en"]);
  assert.equal(madrid.serviceAreas.some((area) => area.label === "Dubai Marina"), false);
  assert.equal(dubai.countryCode, "AE");
  assert.equal(dubai.countryName, "United Arab Emirates");
  assert.equal(dubai.currencyCode, "AED");
  assert.deepEqual(dubai.supportedLanguages, ["ar", "en"]);
  assert.equal(dubai.serviceAreas.some((area) => area.label === "Salamanca"), false);
});

test("market context uses inventory only as a conservative fallback", () => {
  const context = buildLocationMarketContext({
    locationId: "fallback-office",
    defaultCity: "Lisbon",
    defaultReplyLanguage: "pt",
    inventory: [
      { country: "Portugal", currency: "EUR", city: "Lisbon", propertyLocation: "Alfama" },
      { country: "Portugal", currency: "EUR", city: "Lisbon", propertyLocation: "Baixa" },
    ],
  });

  assert.equal(context.countryCode, null);
  assert.equal(context.countryName, "Portugal");
  assert.equal(context.currencyCode, "EUR");
  assert.deepEqual(context.supportedLanguages, ["pt"]);
  assert.equal(context.locale, null);
  assert.equal(context.serviceAreas.some((area) => area.label === "Lisbon" && area.kind === "city"), true);
  assert.equal(context.source.configured, false);
  assert.equal(context.source.inventoryFallback, true);
});
