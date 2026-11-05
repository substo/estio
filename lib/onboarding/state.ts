import { z } from "zod";

/**
 * Per-Location onboarding state (settings document location.onboarding). Business facts never live here: they are in
 * the Business profile. This holds progress, the chat transcript, research runs and the fetched page excerpts the topic
 * research reads. Pure and client-safe.
 */
const iso = z.string().max(40);
export const onboardingMessageSchema = z.object({
  id: z.string().max(40), role: z.enum(["agent", "owner", "system"]), text: z.string().max(4000), at: iso,
  topic: z.string().max(40).optional(),
}).strict();
export const researchRunSchema = z.object({
  id: z.string().max(80), batch: z.string().max(40), topic: z.string().max(40), status: z.enum(["queued", "running", "done", "failed"]),
  provider: z.string().max(40).optional(), queuedAt: iso, startedAt: iso.optional(), finishedAt: iso.optional(),
  error: z.string().max(300).optional(), applied: z.array(z.string().max(80)).max(40).optional(), sources: z.array(z.string().max(500)).max(20).optional(),
}).strict();
export const pageExcerptSchema = z.object({ url: z.string().max(2048), title: z.string().max(300).nullable(), text: z.string().max(8000) }).strict();
export const onboardingStateSchema = z.object({
  status: z.enum(["not_started", "in_progress", "done"]).default("not_started"),
  startedAt: iso.nullable().default(null), completedAt: iso.nullable().default(null),
  currentTopic: z.string().max(40).nullable().default(null),
  skippedTopics: z.array(z.string().max(40)).max(20).default([]),
  input: z.object({ name: z.string().max(200).optional(), website: z.string().max(2048).optional() }).strict().default({}),
  batch: z.string().max(40).nullable().default(null),
  pages: z.array(pageExcerptSchema).max(6).default([]),
  runs: z.array(researchRunSchema).max(60).default([]),
  messages: z.array(onboardingMessageSchema).max(200).default([]),
  // A name found by research waits here: the business name lives on Location and is only changed when the owner confirms.
  suggestedName: z.object({ value: z.string().max(100), sources: z.array(z.string().max(500)).max(10) }).strict().nullable().default(null),
  suggestedTimeZone: z.object({ value: z.string().max(60), sources: z.array(z.string().max(500)).max(10) }).strict().nullable().default(null),
}).passthrough();
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export type OnboardingMessage = z.infer<typeof onboardingMessageSchema>;
export type ResearchRun = z.infer<typeof researchRunSchema>;

export const emptyState = (): OnboardingState => onboardingStateSchema.parse({});
const maxMessages = 200;

export function say(state: OnboardingState, role: OnboardingMessage["role"], text: string, topic?: string, now = new Date()): OnboardingState {
  const message = { id: `${role[0]}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, role, text: text.slice(0, 4000), at: now.toISOString(), ...(topic ? { topic } : {}) };
  return { ...state, messages: [...state.messages, message].slice(-maxMessages) };
}
/** Starting research begins a new batch: one queued run per topic; earlier runs stay as history (bounded). */
export function startBatch(state: OnboardingState, batch: string, topics: string[], input: OnboardingState["input"], now = new Date()): OnboardingState {
  const at = now.toISOString();
  const runs = [...state.runs.filter(r => r.batch !== batch), ...topics.map(topic => ({ id: `${batch}:${topic}`, batch, topic, status: "queued" as const, queuedAt: at }))].slice(-60);
  return { ...state, status: state.status === "done" ? "in_progress" : state.status === "not_started" ? "in_progress" : state.status, startedAt: state.startedAt ?? at,
    batch, input, runs, pages: [] };
}
export function updateRun(state: OnboardingState, id: string, patch: Partial<ResearchRun>): OnboardingState {
  return { ...state, runs: state.runs.map(r => r.id === id ? { ...r, ...patch } : r) };
}
export function finish(state: OnboardingState, now = new Date()): OnboardingState {
  return { ...state, status: "done", completedAt: now.toISOString() };
}
export function reopen(state: OnboardingState): OnboardingState {
  return { ...state, status: "in_progress" };
}
export function skipTopic(state: OnboardingState, topic: string): OnboardingState {
  return { ...state, skippedTopics: [...new Set([...state.skippedTopics, topic])] };
}
export const researching = (state: OnboardingState) => state.runs.some(r => r.batch === state.batch && (r.status === "queued" || r.status === "running"));

/**
 * When onboarding opens by itself: for an admin acting as themselves, until it is done. Without an AI connection it still
 * opens, locked on the "connect an AI" step, so the owner learns what is needed instead of never seeing it.
 */
export function onboardingOpenMode(input: { role: string | null; impersonating: boolean; status: OnboardingState["status"]; aiAvailable: boolean }): "none" | "open" | "locked" {
  if (input.role !== "ADMIN" || input.impersonating || input.status === "done") return "none";
  return input.aiAvailable ? "open" : "locked";
}
