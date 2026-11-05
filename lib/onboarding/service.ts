import "server-only";
import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { studioDb } from "@/lib/studio/studio-db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { businessProfileSchema, type BusinessProfile } from "@/lib/business-profile/schema";
import { getAiConnections } from "@/lib/ai/connections";
import { findTopic, topicsFor, type FieldValue } from "./topics";
import { confirmField, setOwnerField } from "./facts";
import { answerPrompt, isValidFieldValue, parseResearchOutput } from "./research-contract";
import { finish, reopen, say, skipTopic, startBatch, type OnboardingState } from "./state";
import { buildOnboardingView } from "./view";
import { chooseResearchProvider, runProvider } from "./providers";
import { loadOnboardingState, ONBOARDING_FETCH, updateBusinessProfile, updateOnboardingState } from "./research";

/**
 * Onboarding commands for the active Location. Callers (app/api/onboarding) authorise first: reads for members,
 * writes for an admin acting as themselves. Facts go to the Business profile; name and time zone to Location.
 */
export type Actor = { locationId: string; app: "estio" | "substo"; role: string | null; impersonating: boolean; clerkUserId: string; dbUserId: string | null };
export class OnboardingError extends Error {}

async function load(actor: Actor) {
  const [{ state }, doc, location, ai] = await Promise.all([
    loadOnboardingState(actor.locationId),
    settingsService.getDocument<BusinessProfile>({ scopeType: "LOCATION", scopeId: actor.locationId, domain: SETTINGS_DOMAINS.LOCATION_BUSINESS }),
    db.location.findUnique({ where: { id: actor.locationId }, select: { name: true, timeZone: true } }),
    getAiConnections(actor.locationId),
  ]);
  return { state, profile: doc ? businessProfileSchema.parse(doc.payload) : null, location: { name: location?.name ?? null, timeZone: location?.timeZone ?? null }, ai };
}
export async function getOnboardingView(actor: Actor) {
  const loaded = await load(actor);
  return buildOnboardingView({ app: actor.app, ...loaded, role: actor.role, impersonating: actor.impersonating });
}
const owner = (actor: Actor) => actor.dbUserId ?? actor.clerkUserId;
function requireEditor(actor: Actor) {
  if (actor.role !== "ADMIN" || actor.impersonating) throw new OnboardingError("Only an admin, signed in as themselves, can change the business profile.");
}
const field = (topicId: string, key: string) => {
  const topic = findTopic(topicId), f = topic?.fields.find(x => x.key === key);
  if (!topic || !f) throw new OnboardingError("Unknown field.");
  return { topic, field: f };
};
const normalizeName = (v: unknown) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 100) : "";
const validTimeZone = (v: string) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } };

/** Starts (or restarts) background research from the business name and/or website. */
export async function startResearch(actor: Actor, input: { name?: string; website?: string }) {
  requireEditor(actor);
  const website = input.website?.trim() ? (/^https?:\/\//i.test(input.website.trim()) ? input.website.trim() : `https://${input.website.trim()}`) : undefined;
  if (website) { try { const u = new URL(website); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error(); } catch { throw new OnboardingError("That website address doesn't look right."); } }
  const name = normalizeName(input.name) || undefined;
  if (!name && !website) throw new OnboardingError("Give me your business name or website to start.");
  if (!await chooseResearchProvider(actor.locationId)) throw new OnboardingError("Connect an AI first (Settings → Integrations): a ChatGPT subscription or an API key.");
  const batch = randomUUID().slice(0, 18);
  const topics = topicsFor(actor.app).map(t => t.id);
  await updateOnboardingState(actor.locationId, s => say(say(startBatch(s, batch, topics, { ...(name ? { name } : {}), ...(website ? { website } : {}) }), "owner",
    [name, website].filter(Boolean).join(" · ")), "agent", "Thanks. I'm looking your business up now, one topic at a time. Suggestions appear on the left as I find them; confirm or edit each one."), owner(actor));
  await studioDb.call("studio_enqueue_job", { p_location_id: actor.locationId, p_kind: ONBOARDING_FETCH, p_payload: { batch, topics, ...(website ? { website } : {}), actorId: actor.dbUserId, createdBy: actor.clerkUserId },
    p_idempotency_key: `onboarding:${batch}:fetch`, p_created_by: actor.clerkUserId, p_max_attempts: 3 });
  return getOnboardingView(actor);
}

/** Accepts what research found for a field (or the field as it stands). */
export async function confirm(actor: Actor, topicId: string, key: string) {
  requireEditor(actor);
  const { field: f } = field(topicId, key);
  if ("location" in f.target) {
    const { state } = await loadOnboardingState(actor.locationId);
    const pending = f.target.location === "name" ? state.suggestedName : state.suggestedTimeZone;
    if (pending) {
      if (f.target.location === "name") await db.location.update({ where: { id: actor.locationId }, data: { name: normalizeName(pending.value) } });
      else if (validTimeZone(pending.value)) await db.location.update({ where: { id: actor.locationId }, data: { timeZone: pending.value } });
      const isName = f.target.location === "name";
      await updateOnboardingState(actor.locationId, s => ({ ...s, ...(isName ? { suggestedName: null } : { suggestedTimeZone: null }) }), owner(actor));
    }
  } else await updateBusinessProfile(actor.locationId, p => confirmField(p, (f.target as { profile: string }).profile), owner(actor));
  return getOnboardingView(actor);
}
/** Confirms every suggestion in a topic at once. */
export async function confirmTopic(actor: Actor, topicId: string) {
  requireEditor(actor);
  const view = await getOnboardingView(actor);
  for (const f of view.topics.find(t => t.id === topicId)?.fields.filter(x => x.status === "suggested") ?? []) await confirm(actor, topicId, f.key);
  return getOnboardingView(actor);
}
/** The owner types or changes a value; it is saved as confirmed with the owner as its source. Null clears it. */
export async function edit(actor: Actor, topicId: string, key: string, value: FieldValue | null) {
  requireEditor(actor);
  const { field: f } = field(topicId, key);
  if (value !== null && !(Array.isArray(value) && !value.length) && !(typeof value === "string" && !value.trim()) && !isValidFieldValue(f.kind, value))
    throw new OnboardingError(`Check the ${f.label.toLowerCase()} and try again.`);
  if ("location" in f.target) {
    if (f.target.location === "name") { const name = normalizeName(value); if (!name) throw new OnboardingError("Enter a business name."); await db.location.update({ where: { id: actor.locationId }, data: { name } }); }
    else { const tz = typeof value === "string" ? value.trim() : ""; if (tz && !validTimeZone(tz)) throw new OnboardingError("Enter a time zone like Europe/Nicosia."); await db.location.update({ where: { id: actor.locationId }, data: { timeZone: tz || null } }); }
    const isName = f.target.location === "name";
    await updateOnboardingState(actor.locationId, s => ({ ...s, ...(isName ? { suggestedName: null } : { suggestedTimeZone: null }) }), owner(actor));
  } else await updateBusinessProfile(actor.locationId, p => setOwnerField(p, f.kind, (f.target as { profile: string }).profile, value, owner(actor)), owner(actor));
  return getOnboardingView(actor);
}
export async function skip(actor: Actor, topicId: string) {
  requireEditor(actor);
  if (!findTopic(topicId)) throw new OnboardingError("Unknown topic.");
  await updateOnboardingState(actor.locationId, s => skipTopic(s, topicId), owner(actor));
  return getOnboardingView(actor);
}

/** A typed chat answer: one small extraction call maps it onto the current topic's fields, saved as the owner's values. */
export async function answer(actor: Actor, text: string, topicId?: string) {
  requireEditor(actor);
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new OnboardingError("Type an answer first.");
  const before = await getOnboardingView(actor);
  const topic = findTopic(topicId ?? before.topics.find(t => t.status !== "confirmed" && t.status !== "skipped")?.id ?? "business");
  if (!topic) throw new OnboardingError("Unknown topic.");
  await updateOnboardingState(actor.locationId, s => say(s, "owner", clean, topic.id), owner(actor));
  const provider = await chooseResearchProvider(actor.locationId);
  let saved: string[] = [];
  if (provider) {
    try {
      const reply = await runProvider({ provider, locationId: actor.locationId, userId: actor.dbUserId, webSearch: false, action: `answer_${topic.id}`, system: answerPrompt(topic), user: clean });
      const parsed = parseResearchOutput(topic.id, reply.text, { ownerAnswer: true });
      if (parsed.businessName && topic.fields.some(f => f.key === "name")) parsed.suggestions.push({ key: "name", kind: "text", path: null, location: "name", value: parsed.businessName, sources: [] });
      for (const s of parsed.suggestions) { await edit(actor, topic.id, s.key, s.value); saved.push(topic.fields.find(f => f.key === s.key)?.label ?? s.key); }
    } catch { saved = []; }
  }
  // Without anything extracted, a single free-text field still takes the answer as typed.
  if (!saved.length) {
    const textField = topic.fields.find(f => (f.kind === "longtext" || f.kind === "text") && "profile" in f.target);
    if (textField && topic.fields.filter(f => "profile" in f.target).length === 1) { await edit(actor, topic.id, textField.key, clean); saved.push(textField.label); }
  }
  const view = await getOnboardingView(actor);
  const reply = saved.length ? `Saved ${saved.join(", ")}. ${view.nextPrompt}` : `I couldn't place that automatically; please fill it in on the left. ${view.nextPrompt}`;
  await updateOnboardingState(actor.locationId, s => say(s, "agent", reply, topic.id), owner(actor));
  return getOnboardingView(actor);
}
export async function setStatus(actor: Actor, action: "finish" | "reopen") {
  requireEditor(actor);
  await updateOnboardingState(actor.locationId, (s: OnboardingState) => action === "finish"
    ? say(finish(s), "agent", "All set. Your business profile is saved; you can come back to update it any time from Settings.")
    : say(reopen(s), "agent", "Let's update your business profile. Change anything on the left, or ask me to research again."), owner(actor));
  return getOnboardingView(actor);
}
/** Where the app should send an admin: the onboarding screen, until it is done. */
export async function onboardingOpenModeFor(actor: Actor) {
  const [{ state }, ai] = await Promise.all([loadOnboardingState(actor.locationId), getAiConnections(actor.locationId)]);
  const { onboardingOpenMode } = await import("./state");
  return onboardingOpenMode({ role: actor.role, impersonating: actor.impersonating, status: state.status, aiAvailable: ai.available });
}
