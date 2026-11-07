import assert from "node:assert/strict";
import test from "node:test";
import { topicsFor, topicStatus, findTopic } from "./topics";
import { applySuggestions, confirmField, factAt, fieldStatus, fromFact, markNotApplicable, setOwnerField } from "./facts";
import { parseResearchOutput, researchPrompt } from "./research-contract";
import { emptyState, finish, onboardingOpenMode, reopen, researching, say, skipTopic, startBatch, updateRun } from "./state";
import { buildOnboardingView } from "./view";
import { getBusinessProfileCompleteness } from "@/lib/business-profile/completeness";
import { candidatePages } from "./research";

const at = "2026-11-05T10:00:00.000Z";
const reply = (fields: object[], businessName: string | null = null) => JSON.stringify({ businessName, fields });

test("topics: real estate is Estio-only and topic status follows its fields", () => {
  assert.equal(topicsFor("substo").some(t => t.id === "realEstate"), false);
  assert.equal(topicsFor("estio").at(-1)!.id, "realEstate");
  assert.equal(topicStatus(["empty", "empty"], false), "empty");
  assert.equal(topicStatus(["confirmed", "suggested"], false), "suggested");
  assert.equal(topicStatus(["confirmed", "empty"], false), "confirmed");
  assert.equal(topicStatus(["empty"], true), "skipped");
});

test("research output: validated per kind, low confidence and unknown keys dropped, name kept aside", () => {
  const r = parseResearchOutput("contact", reply([
    { key: "email", valueJson: '"info@example.com"', sources: ["https://example.com/contact"], confidence: "high" },
    { key: "phones", valueJson: '[{"label":"Mobile","number":"+357 99 123456"}]', sources: ["https://example.com"], confidence: "medium" },
    { key: "address", valueJson: '"Somewhere"', sources: [], confidence: "low" },
    { key: "email2", valueJson: '"x"', sources: [], confidence: "high" },
    { key: "maps", valueJson: '[{"url":"not a url"}]', sources: [], confidence: "high" },
  ], "Example Ltd"));
  assert.deepEqual(r.suggestions.map(s => s.key), ["email", "phones"]);
  assert.equal(r.businessName, "Example Ltd");
  assert.equal(r.dropped.length, 3);
  assert.equal(parseResearchOutput("contact", "not json").suggestions.length, 0);
  assert.match(researchPrompt(findTopic("contact")!, { app: "estio", webSearch: true }), /Search the web/);
  assert.match(researchPrompt(findTopic("contact")!, { app: "substo", webSearch: false }), /cannot browse/);
});

test("suggestions are unconfirmed facts with URL sources and never replace a confirmed fact", () => {
  let profile = applySuggestions(null, [
    { kind: "email", path: "contact.email", value: "info@example.com", sources: ["https://example.com/contact"] },
    { kind: "list", path: "offer.services", value: ["Sales", "Rentals"], sources: ["https://example.com"] },
    { kind: "list", path: "realEstate.businessTypes", value: ["agency"], sources: ["https://example.com"] },
    { kind: "url", path: "onlinePresence.website", value: "not-a-url", sources: [] },
  ], at);
  assert.deepEqual(profile.applied, ["contact.email", "offer.services", "realEstate.businessTypes"]);
  assert.deepEqual(profile.rejected, ["onlinePresence.website: invalid value"]);
  const email = factAt(profile.profile, "contact.email");
  assert.equal(fieldStatus(email), "suggested");
  assert.deepEqual(email!.sources, [{ kind: "url", url: "https://example.com/contact", retrievedAt: at }]);
  assert.deepEqual(fromFact("list", factAt(profile.profile, "realEstate.businessTypes")), ["agency"]);
  // Confirming marks the fact and its nested entries; a later suggestion leaves it alone.
  const confirmed = confirmField(profile.profile, "offer.services", new Date(at));
  assert.equal(fieldStatus(factAt(confirmed, "offer.services")), "confirmed");
  assert.ok((factAt(confirmed, "offer.services")!.value as { confirmedAt: string }[]).every(e => e.confirmedAt === at));
  const again = applySuggestions(confirmed, [{ kind: "list", path: "offer.services", value: ["Other"], sources: [] }], at);
  assert.deepEqual(again.rejected, ["offer.services: already confirmed"]);
  assert.deepEqual(fromFact("list", factAt(again.profile, "offer.services")), ["Sales", "Rentals"]);
});

test("owner values are confirmed facts sourced to the owner; empty clears; not applicable satisfies completeness", () => {
  let p = setOwnerField(null, "longtext", "identity.summary", "We sell homes in Paphos.", "user-1", new Date(at));
  assert.equal(fieldStatus(factAt(p, "identity.summary")), "confirmed");
  assert.deepEqual(factAt(p, "identity.summary")!.sources, [{ kind: "owner", ownerId: "user-1", suppliedAt: at }]);
  p = setOwnerField(p, "hours", "contact.openingHours", [{ day: "mon", closed: false, opens: "09:00", closes: "17:00" }, { day: "sun", closed: true }], "user-1", new Date(at));
  assert.deepEqual(fromFact("hours", factAt(p, "contact.openingHours")), [{ day: "mon", closed: false, opens: "09:00", closes: "17:00" }, { day: "sun", closed: true }]);
  p = setOwnerField(p, "longtext", "identity.summary", null, "user-1");
  assert.equal(factAt(p, "identity.summary"), undefined);
  p = markNotApplicable(p, "onlinePresence.website", "user-1", new Date(at));
  const issues = getBusinessProfileCompleteness(p, "substo").sections.onlinePresence;
  assert.deepEqual(issues, []);
});

test("state: batches, runs, transcript bound, finish/reopen and when onboarding opens", () => {
  let s = startBatch(emptyState(), "b1", ["business", "contact"], { website: "https://example.com" }, new Date(at));
  assert.equal(s.status, "in_progress"); assert.equal(s.runs.length, 2); assert.equal(researching(s), true);
  s = updateRun(updateRun(s, "b1:business", { status: "done" }), "b1:contact", { status: "failed", error: "x" });
  assert.equal(researching(s), false);
  for (let i = 0; i < 230; i++) s = say(s, "owner", `m${i}`);
  assert.equal(s.messages.length, 200); assert.equal(s.messages.at(-1)!.text, "m229");
  s = skipTopic(skipTopic(s, "contact"), "contact");
  assert.deepEqual(s.skippedTopics, ["contact"]);
  s = finish(s, new Date(at)); assert.equal(s.status, "done"); assert.equal(s.completedAt, at);
  assert.equal(reopen(s).status, "in_progress");
  assert.equal(onboardingOpenMode({ role: "ADMIN", impersonating: false, status: "in_progress", aiAvailable: true }), "open");
  assert.equal(onboardingOpenMode({ role: "ADMIN", impersonating: false, status: "not_started", aiAvailable: false }), "locked");
  assert.equal(onboardingOpenMode({ role: "ADMIN", impersonating: false, status: "done", aiAvailable: true }), "none");
  assert.equal(onboardingOpenMode({ role: "MEMBER", impersonating: false, status: "not_started", aiAvailable: true }), "none");
  assert.equal(onboardingOpenMode({ role: "ADMIN", impersonating: true, status: "not_started", aiAvailable: true }), "none");
});

test("view: timeline with statuses, name suggestion beside the Location's name, and the next prompt", () => {
  const ai = { available: true, sources: [] };
  const profile = applySuggestions(null, [{ kind: "email", path: "contact.email", value: "a@b.com", sources: ["https://b.com"] }], at).profile;
  const state = { ...emptyState(), suggestedName: { value: "Example Ltd", sources: ["https://b.com"] } };
  const view = buildOnboardingView({ app: "substo", profile, location: { name: "Example", timeZone: null }, state, ai, role: "ADMIN", impersonating: false });
  const business = view.topics.find(t => t.id === "business")!;
  assert.equal(business.status, "suggested");
  assert.deepEqual(business.fields.find(f => f.key === "name")!.suggestion, { value: "Example Ltd", sources: ["https://b.com"] });
  assert.equal(view.topics.find(t => t.id === "contact")!.status, "suggested");
  assert.match(view.nextPrompt, /^Your business: here is what I found\. Business name: Example Ltd/);
  assert.equal(view.canEdit, true); assert.equal(view.openMode, "open");
  const locked = buildOnboardingView({ app: "substo", profile: null, location: { name: "X", timeZone: null }, state: emptyState(), ai: { available: false, sources: [] }, role: "ADMIN", impersonating: false });
  assert.equal(locked.openMode, "locked"); assert.match(locked.nextPrompt, /AI connection/);
});

test("website research reads the home page and the usual about/contact pages on the same site", () => {
  assert.deepEqual(candidatePages("https://example.com/en"), ["https://example.com/en", "https://example.com/about", "https://example.com/about-us", "https://example.com/contact", "https://example.com/contact-us"]);
});
