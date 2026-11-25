import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCitationHref, citedQuote, proposalAnchor, readProposalFocus, recordedTranscriptOffset, transcriptPassage } from "./citation-navigation";

const id = "10000000-0000-4000-8000-000000000001";

test("citation links carry the saved identifiers and exact proposal index", () => {
  const focus = readProposalFocus(id, "2");
  assert.ok(focus);
  assert.equal(proposalAnchor(focus), `proposal-${id}-2`);
  assert.equal(readProposalFocus(id, "3"), null);
  const href = new URL(agentCitationHref(id, focus, "10000000:17"), "https://example.test");
  assert.equal(href.searchParams.get("citationItem"), "10000000:17");
  assert.equal(href.searchParams.get("citationProposal"), "2");
  assert.equal(href.hash, "#transcript");
  assert.equal(citedQuote("f:find", "Approved takeaway: example\nExact saved quote: “A saved quote.”"), "A saved quote.");
});

test("transcript matching uses a recorded occurrence or a unique exact match and fails closed when ambiguous", () => {
  const content = "  🙂 Test one. Test one.";
  const offset = recordedTranscriptOffset(id, `10000000:${content.trimStart().lastIndexOf("Test one.")}`);
  assert.deepEqual(transcriptPassage(content, "Test one.", offset), { before: "  🙂 Test one. ", quote: "Test one.", after: "" });
  assert.equal(transcriptPassage(content, "Test one.", null), null);
  assert.equal(transcriptPassage(content, "No longer present.", 0), null);
  assert.deepEqual(transcriptPassage("At the start. Then cut.", "Then cut.", 0),
    { before: "At the start. ", quote: "Then cut.", after: "" });
});
