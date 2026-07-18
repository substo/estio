import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyExplicitPropertyFeedback,
  extractPropertyTextAnchors,
  resolveSinglePropertyAnchor,
} from "./feedback";

test("property feedback classifier records explicit interest and viewing requests", () => {
  assert.deepEqual(classifyExplicitPropertyFeedback("I am very interested in this one"), {
    eventType: "liked",
    sentiment: "positive",
    reason: "interested",
  });
  assert.deepEqual(classifyExplicitPropertyFeedback("Could we arrange a viewing tomorrow?"), {
    eventType: "viewing_requested",
    sentiment: "positive",
    reason: "viewing_request",
  });
  assert.deepEqual(classifyExplicitPropertyFeedback("Is it still available?"), {
    eventType: "replied",
    sentiment: "positive",
    reason: "availability_question",
  });
});

test("property feedback classifier records explicit rejection reasons", () => {
  assert.deepEqual(classifyExplicitPropertyFeedback("No thanks, this one is not for us"), {
    eventType: "rejected",
    sentiment: "negative",
    reason: "not_interested",
  });
  assert.deepEqual(classifyExplicitPropertyFeedback("It is too expensive for us"), {
    eventType: "rejected",
    sentiment: "negative",
    reason: "price_rejection",
  });
  assert.deepEqual(classifyExplicitPropertyFeedback("This is the wrong area"), {
    eventType: "rejected",
    sentiment: "negative",
    reason: "location_rejection",
  });
  assert.deepEqual(classifyExplicitPropertyFeedback("This is too small"), {
    eventType: "rejected",
    sentiment: "negative",
    reason: "size_rejection",
  });
});

test("property feedback classifier leaves generic and ambiguous replies unknown", () => {
  assert.equal(classifyExplicitPropertyFeedback("Yes"), null);
  assert.equal(classifyExplicitPropertyFeedback("No"), null);
  assert.equal(classifyExplicitPropertyFeedback("Thanks"), null);
  assert.equal(classifyExplicitPropertyFeedback("It's not too expensive"), null);
  assert.equal(classifyExplicitPropertyFeedback("Can you call me?"), null);
});

test("trusted agent notes support explicit third-person client feedback", () => {
  assert.equal(classifyExplicitPropertyFeedback("Client is interested in DT5115"), null);
  assert.deepEqual(classifyExplicitPropertyFeedback(
    "Client is interested in DT5115",
    { allowTrustedThirdPerson: true },
  ), {
    eventType: "liked",
    sentiment: "positive",
    reason: "interested",
  });
  assert.deepEqual(classifyExplicitPropertyFeedback(
    "Customer wants to view DT5115 tomorrow",
    { allowTrustedThirdPerson: true },
  ), {
    eventType: "viewing_requested",
    sentiment: "positive",
    reason: "viewing_request",
  });
});

test("property feedback anchors extract explicit DT references and listing URLs", () => {
  assert.deepEqual(
    extractPropertyTextAnchors(
      "I like DT5115 https://www.downtowncyprus.com/properties/apartment-ref-dt5115",
    ),
    {
      references: ["DT5115"],
      urls: ["https://www.downtowncyprus.com/properties/apartment-ref-dt5115"],
    },
  );
  assert.deepEqual(extractPropertyTextAnchors("I like this one"), {
    references: [],
    urls: [],
  });
});

test("property feedback resolves DT references and Estio slug links to one property", () => {
  const property = {
    id: "prop_1",
    reference: "DT5115",
    slug: "kato-paphos-apartment",
    externalPublicUrl: "https://www.downtowncyprus.com/properties/apartment-ref-dt5115",
    agentUrl: null,
  };
  assert.equal(resolveSinglePropertyAnchor({
    references: ["DT5115"],
    urls: ["https://estio.co/properties/kato-paphos-apartment?utm_source=whatsapp"],
  }, [property])?.id, "prop_1");
});

test("property feedback refuses partially unresolved or conflicting property anchors", () => {
  const properties = [
    { id: "prop_1", reference: "DT5115", slug: "one", externalPublicUrl: null, agentUrl: null },
    { id: "prop_2", reference: "DT5116", slug: "two", externalPublicUrl: null, agentUrl: null },
  ];
  assert.equal(resolveSinglePropertyAnchor({
    references: ["DT5115", "DT5999"],
    urls: [],
  }, properties), null);
  assert.equal(resolveSinglePropertyAnchor({
    references: ["DT5115", "DT5116"],
    urls: [],
  }, properties), null);
});
