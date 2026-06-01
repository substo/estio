import test from "node:test";
import assert from "node:assert/strict";
import {
  extractListingFactsFromCrawl,
  formatTimelineNoteBody,
  getEvidenceDedupeKey,
} from "./service";
import {
  extractHttpUrls,
  isAllowedPropertyUrl,
  isPrivateOrLocalHostname,
  normalizeAllowedPropertyDomains,
} from "./domain-policy";

test("property evidence resolver allows configured domains and Downtown Cyprus by default", () => {
  const allowedHosts = new Set(["example-agency.com"]);

  assert.equal(
    isAllowedPropertyUrl("https://example-agency.com/listing/123", allowedHosts),
    true
  );
  assert.equal(
    isAllowedPropertyUrl("https://www.example-agency.com/listing/123", allowedHosts),
    true
  );
  assert.equal(
    isAllowedPropertyUrl("https://www.downtowncyprus.com/properties/ref-dt3327", new Set()),
    true
  );
  assert.equal(
    isAllowedPropertyUrl("https://unknown-agency.com/listing/123", allowedHosts),
    false
  );
});

test("property evidence resolver blocks local and private URL hosts", () => {
  const allowedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "192.168.1.10",
    "10.0.0.5",
    "172.16.0.2",
    "internal.local",
  ]);

  for (const host of allowedHosts) {
    assert.equal(isPrivateOrLocalHostname(host), true, host);
    assert.equal(isAllowedPropertyUrl(`http://${host}/property`, allowedHosts), false, host);
  }
});

test("property evidence resolver normalizes editable allowed domains", () => {
  assert.deepEqual(
    normalizeAllowedPropertyDomains([
      "https://www.example-agency.com/path",
      "example-agency.com",
      "localhost",
      "internal.local",
      "https://sub.allowed-domain.com/listing",
    ]),
    ["example-agency.com", "sub.allowed-domain.com"]
  );
});

test("property evidence resolver normalizes editable allowed domain text", () => {
  assert.deepEqual(
    normalizeAllowedPropertyDomains([
      "https://www.example-agency.com/path",
      "example-agency.com, internal.local\nhttps://sub.allowed-domain.com/listing",
    ].join("\n")),
    ["example-agency.com", "sub.allowed-domain.com"]
  );
});

test("property evidence resolver extracts and cleans HTTP URLs from message text", () => {
  assert.deepEqual(
    extractHttpUrls("Links: https://example.com/listing/1, and https://other.com/a)."),
    ["https://example.com/listing/1", "https://other.com/a"]
  );
});

test("property evidence resolver dedupes by reference before URL", () => {
  const byReference = getEvidenceDedupeKey({
    type: "legacy_crm_ref",
    status: "import_queued",
    publicReference: "DT4039",
    url: "https://example.com/listing/without-ref",
  });
  const byExtractedReference = getEvidenceDedupeKey({
    type: "url",
    status: "import_unavailable",
    url: "https://example.com/listing/4039",
    extracted: { reference: "DT4039" },
  });
  const byUrl = getEvidenceDedupeKey({
    type: "url",
    status: "untrusted_url",
    url: "https://unknown.com/listing/1",
  });

  assert.equal(byReference, "DT4039");
  assert.equal(byExtractedReference, "DT4039");
  assert.equal(byUrl, "https://unknown.com/listing/1");
});

test("property evidence resolver extracts listing facts and DT refs from crawled page content", () => {
  const facts = extractListingFactsFromCrawl({
    url: "https://example-agency.com/listing/4039",
    markdown: [
      "# Detached house in Tala",
      "Reference DT4039",
      "Price EUR 420,000",
      "4 bedrooms",
      "Located in Tala near amenities",
    ].join("\n"),
    html: "<title>Fallback title</title>",
    metadata: {},
  });

  assert.equal(facts?.title, "Detached house in Tala");
  assert.equal(facts?.reference, "DT4039");
  assert.equal(facts?.price, "EUR 420,000");
  assert.equal(facts?.bedrooms, "4 bedrooms");
  assert.equal(facts?.location, "Tala");
});

test("property evidence timeline note includes stable dedupe key and visible status", () => {
  const note = formatTimelineNoteBody({
    key: "DT3327",
    item: {
      type: "legacy_crm_ref",
      status: "linked_existing",
      interestSource: "client_inquired_property",
      publicReference: "DT3327",
      propertyId: "prop_123",
      title: "Apartment in Kato Paphos",
      location: "Kato Paphos",
    },
  });

  assert.match(note, /\[AI Property Evidence\]/);
  assert.match(note, /Evidence key: DT3327/);
  assert.match(note, /Reference: DT3327/);
  assert.match(note, /Status: linked existing/);
  assert.match(note, /Interest source: client inquired property/);
  assert.match(note, /Linked property: prop_123/);
});

test("property evidence timeline note distinguishes agent-sent options", () => {
  const note = formatTimelineNoteBody({
    key: "DT5001",
    item: {
      type: "legacy_crm_ref",
      status: "linked_existing",
      interestSource: "agent_sent_option",
      publicReference: "DT5001",
      propertyId: "prop_option",
    },
  });

  assert.match(note, /Interest source: agent sent option/);
});
