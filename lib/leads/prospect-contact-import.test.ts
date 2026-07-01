import test from "node:test";
import assert from "node:assert/strict";
import { buildProspectImportContactName } from "./prospect-contact-import";

test("buildProspectImportContactName follows paste lead naming for sale listing imports", () => {
  const name = buildProspectImportContactName({
    prospect: {
      name: "Maria Solomou",
      source: "bazaraki_scrape",
      message: "Seller has a flat listed in Universal.",
    },
    listings: [{
      title: "Modern apartment in Universal",
      price: 135000,
      currency: "EUR",
      propertyType: "apartment",
      listingType: "sale",
      locationText: "Universal, Paphos",
      bedrooms: 2,
      externalId: "baz-123",
      url: "https://example.test/listing/baz-123",
    }],
  });

  assert.equal(name, "Maria Solomou Lead Sale Apt 2Bdr Universal, Paphos EUR 135,000");
});

test("buildProspectImportContactName follows paste lead naming for rent listing imports", () => {
  const name = buildProspectImportContactName({
    prospect: {
      firstName: "Andreas",
      lastName: "Ioannou",
      phone: "+35799123456",
      source: "bazaraki_scrape",
    },
    listings: [{
      title: "Detached villa for rent",
      price: 1800,
      currency: "EUR",
      propertyType: "detached villa",
      listingType: "rent",
      locationText: "Peyia",
      bedrooms: 3,
      externalId: "rent-456",
    }],
  });

  assert.equal(name, "Andreas Ioannou Lead Rent Villa 3Bdr Peyia EUR 1,800");
});

test("buildProspectImportContactName falls back to contact identity when listing details are sparse", () => {
  const name = buildProspectImportContactName({
    prospect: {
      email: "seller@example.test",
      source: "manual",
    },
    listings: [],
  });

  assert.equal(name, "seller@example.test Owner Sale");
});
