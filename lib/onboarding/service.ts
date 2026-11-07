import "server-only";
import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { studioDb } from "@/lib/studio/studio-db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { businessView } from "@/lib/business-profile/view";
import { businessProfileSchema, type BusinessProfile } from "@/lib/business-profile/schema";
import { getAiConnections as getAllAiConnections } from "@/lib/ai/connections";
import type { AiConnections, AiConnectionSource } from "@/lib/ai/connections-model";
import { readyResearchDevice, researchDevices, researchNoteFor, type ResearchDevice } from "./device-route";
/**
 * Onboarding needs a connection that can research today: a server connection (ChatGPT subscription, OpenAI or Gemini key)
 * or a paired Mac that is ready right now (running, recently seen, processing On, not paused, research allowed, signed in
 * with a subscription that has capacity). Mac sources show their own research readiness instead of the generic one.
 */
async function getAiConnections(locationId: string) {
  const [ai, provider, devices] = await Promise.all([getAllAiConnections(locationId), chooseResearchProvider(locationId).catch(() => null),
    researchDevices(studioDb, locationId).catch(() => [] as ResearchDevice[])]);
  const name = (p: "codex" | "claude") => p === "codex" ? "Codex (ChatGPT)" : "Claude";
  const macSources: AiConnectionSource[] = devices.map(d => ({ kind: d.readiness.providers[0] === "claude" ? "device_claude" : "device_codex", scope: "device",
    label: d.readiness.ready ? `${d.readiness.providers.map(name).join(" and ")} on ${d.name}` : `Mac: ${d.name}`, ready: d.readiness.ready,
    ...(d.readiness.reason ? { detail: d.readiness.reason } : {}) }));
  const connections: AiConnections = { available: provider !== null || readyResearchDevice(devices) !== null, sources: [...ai.sources.filter(s => s.scope !== "device"), ...macSources] };
  return { connections, devices };
}
import { findTopic, topicsFor, type FieldValue } from "./topics";
import { confirmField, setOwnerField, setFieldState } from "./facts";
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
  return { state, profile: doc ? businessProfileSchema.parse(doc.payload) : null, location: { name: location?.name ?? null, timeZone: location?.timeZone ?? null },
    ai: ai.connections, researchNote: researchNoteFor(state, ai.devices) };
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
export async function startResearch(actor: Actor, input: { name?: string; website?: string; stage?: string; kind?: string; presence?: string; summary?: string }) {
  requireEditor(actor);
  const saved = await settingsService.getDocument<BusinessProfile>({ scopeType: "LOCATION", scopeId: actor.locationId, domain: SETTINGS_DOMAINS.LOCATION_BUSINESS });
  const location = await db.location.findUnique({ where: { id: actor.locationId }, select: { name: true } });
  const savedView = businessView(saved ? businessProfileSchema.parse(saved.payload) : null, location ?? {});
  const requestedWebsite = input.website ?? savedView.website ?? "";
  const website = requestedWebsite?.trim() ? (/^https?:\/\//i.test(requestedWebsite.trim()) ? requestedWebsite.trim() : `https://${requestedWebsite.trim()}`) : undefined;
  if (website) { try { const u = new URL(website); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error(); } catch { throw new OnboardingError("That website address doesn't look right."); } }
  const name = normalizeName(input.name ?? savedView.name) || undefined;
  if (!name && !website && !input.summary?.trim() && !savedView.summary) throw new OnboardingError("Describe your business or personal brand to start.");
  if (!(await getAiConnections(actor.locationId)).connections.available)
    throw new OnboardingError("Connect an AI first: a ChatGPT subscription, an API key, or a paired Mac running the Studio companion with processing on.");
  const opening = (["stage", "kind", "presence", "summary"] as const).flatMap(key => {
    if (!input[key]) return [];
    const f = field("business", key).field;
    if ((f.choices && !f.choices.includes(input[key]!)) || !isValidFieldValue(f.kind, input[key])) throw new OnboardingError(`Check the ${f.label.toLowerCase()}.`);
    return [{ kind: f.kind, path: (f.target as { profile: string }).profile, value: input[key]! }];
  });
  if (input.website?.trim() && website) opening.push({ kind: "url", path: "onlinePresence.website", value: website });
  if (opening.length) await updateBusinessProfile(actor.locationId, profile => opening.reduce((p, f) => setOwnerField(p, f.kind, f.path, f.value, owner(actor)), profile ?? { schemaVersion: 1 }), owner(actor));
  if (input.name?.trim() && name) await db.location.update({ where: { id: actor.locationId }, data: { name } });
  const batch = randomUUID().slice(0, 18);
  const topics = topicsFor(actor.app).map(t => t.id);
  await updateOnboardingState(actor.locationId, s => say(say(startBatch({ ...s, ...(input.name?.trim() ? { suggestedName: null } : {}) }, batch, topics, { ...(name ? { name } : {}), ...(website ? { website } : {}) }), "owner",
    [name, website].filter(Boolean).join(" · ")), "agent", "Thanks. I'm researching your business and market using your setup choices, one topic at a time. Confirm or edit each suggestion in your profile."), owner(actor));
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
  if (f.choices && value !== null && !f.choices.includes(String(value))) throw new OnboardingError("Choose one of the listed options.");
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
  const reply = saved.length ? `Saved ${saved.join(", ")}. ${view.nextPrompt}` : `I couldn't place that automatically; please fill it in in your profile. ${view.nextPrompt}`;
  await updateOnboardingState(actor.locationId, s => say(s, "agent", reply, topic.id), owner(actor));
  return getOnboardingView(actor);
}
export async function setStatus(actor: Actor, action: "finish" | "reopen") {
  requireEditor(actor);
  await updateOnboardingState(actor.locationId, (s: OnboardingState) => action === "finish"
    ? say(finish(s), "agent", "All set. Your business profile is saved; you can come back to update it any time from Settings.")
    : say(reopen(s), "agent", "Let's update your business profile. Change anything in your profile, or ask me to research again."), owner(actor));
  return getOnboardingView(actor);
}
/** Where the app should send an admin: the onboarding screen, until it is done. */
export async function onboardingOpenModeFor(actor: Actor) {
  const [{ state }, ai] = await Promise.all([loadOnboardingState(actor.locationId), getAiConnections(actor.locationId)]);
  const { onboardingOpenMode } = await import("./state");
  return onboardingOpenMode({ role: actor.role, impersonating: actor.impersonating, status: state.status, aiAvailable: ai.connections.available });
}

export async function changeFieldState(actor: Actor, topicId: string, key: string, status: "not_applicable" | "not_yet" | "empty") {
  requireEditor(actor);
  const { field: f } = field(topicId, key);
  if (!("profile" in f.target) || f.target.profile.startsWith("setup.")) throw new OnboardingError("Enter a value for this field.");
  const path = f.target.profile;
  await updateBusinessProfile(actor.locationId, p => setFieldState(p, path, status, owner(actor)), owner(actor));
  return getOnboardingView(actor);
}
