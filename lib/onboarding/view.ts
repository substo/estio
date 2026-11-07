import type { BusinessProfile } from "@/lib/business-profile/schema";
import type { AiConnections } from "@/lib/ai/connections-model";
import { topicsFor, topicStatus, type FieldKind, type FieldStatus, type FieldValue, type TopicId, type TopicStatus } from "./topics";
import { factAt, factSources, fieldStatus, fromFact } from "./facts";
import { onboardingOpenMode, researching, type OnboardingState } from "./state";

/**
 * Everything the onboarding screen shows, as plain data: topics (timeline) with each field's value, status and sources,
 * research progress, the transcript and AI availability. Pure: the API loads the inputs and returns this.
 */
export type FieldView = { key: string; label: string; kind: FieldKind; hint?: string; choices?: string[]; excludable?: boolean; status: FieldStatus; value: FieldValue | null; sources: string[]; suggestion?: { value: string; sources: string[] } };
export type TopicView = { id: TopicId; title: string; question: string; status: TopicStatus; fields: FieldView[]; researching: boolean; researchError?: string };
export type OnboardingView = {
  app: "estio" | "substo"; status: OnboardingState["status"]; openMode: "none" | "open" | "locked"; canEdit: boolean;
  ai: AiConnections; researching: boolean; input: OnboardingState["input"]; topics: TopicView[]; messages: OnboardingState["messages"];
  nextPrompt: string; completeness: { confirmed: number; total: number };
  /** While research waits on a paired Mac: whether it is running there, or what it is waiting for. */
  researchNote: string | null;
};

export function buildOnboardingView(input: { app: "estio" | "substo"; profile: BusinessProfile | null; location: { name: string | null; timeZone: string | null };
  state: OnboardingState; ai: AiConnections; role: string | null; impersonating: boolean; researchNote?: string | null }): OnboardingView {
  const { state } = input;
  const topics: TopicView[] = topicsFor(input.app).map(topic => {
    const fields: FieldView[] = topic.fields.map(field => {
      const base = { key: field.key, label: field.label, kind: field.kind, ...(field.hint ? { hint: field.hint } : {}), choices: field.choices, excludable: "profile" in field.target && !field.target.profile.startsWith("setup.") };
      if ("location" in field.target) {
        const current = field.target.location === "name" ? input.location.name : input.location.timeZone;
        const pending = field.target.location === "name" ? state.suggestedName : state.suggestedTimeZone;
        // The Location's own value counts as confirmed; a different research finding is shown as a suggestion beside it.
        return { ...base, value: current, status: pending ? "suggested" : current ? "confirmed" : "empty", sources: [], ...(pending ? { suggestion: pending } : {}) } as FieldView;
      }
      const fact = factAt(input.profile, field.target.profile);
      return { ...base, value: fromFact(field.kind, fact), status: fieldStatus(fact), sources: factSources(fact) };
    });
    const runs = state.runs.filter(r => r.batch === state.batch && r.topic === topic.id);
    return { id: topic.id, title: topic.title, question: topic.question, fields, status: topicStatus(fields.map(f => f.status), state.skippedTopics.includes(topic.id)),
      researching: runs.some(r => r.status === "queued" || r.status === "running"), ...(runs.find(r => r.status === "failed")?.error ? { researchError: runs.find(r => r.status === "failed")!.error } : {}) };
  });
  const canEdit = input.role === "ADMIN" && !input.impersonating;
  return {
    app: input.app, status: state.status, canEdit, ai: input.ai, researching: researching(state), input: state.input, topics, messages: state.messages,
    openMode: onboardingOpenMode({ role: input.role, impersonating: input.impersonating, status: state.status, aiAvailable: input.ai.available }),
    nextPrompt: nextPrompt(topics, input.ai.available),
    completeness: { confirmed: topics.filter(t => t.status === "confirmed" || t.status === "skipped").length, total: topics.length },
    researchNote: researching(state) ? input.researchNote ?? null : null,
  };
}

const show = (value: FieldValue | null): string => {
  if (value === null) return "";
  if (typeof value === "string") return value;
  return (value as unknown[]).map(v => typeof v === "string" ? v : Object.values(v as Record<string, unknown>).filter(x => typeof x === "string" && x).join(" ")).join(", ");
};
/** What the agent says next: the first topic still open, with what was found or its question. */
export function nextPrompt(topics: TopicView[], aiAvailable: boolean): string {
  if (!aiAvailable) return "To research your business for you, I need an AI connection first. Connect a ChatGPT subscription or an OpenAI or Gemini API key in Settings, or use a paired Mac running the Studio companion with processing on, then come back.";
  const open = topics.find(t => t.status === "suggested" || t.status === "empty");
  if (!open) return "Everything is filled in. Review the summary and press Finish when you're happy.";
  if (open.status === "suggested") {
    const found = open.fields.filter(f => f.status === "suggested").map(f => `${f.label}: ${f.suggestion?.value ?? show(f.value)}`).slice(0, 6);
    return `${open.title}: here is what I found. ${found.join("; ")}. Confirm it, or tell me what to change.`;
  }
  return open.researching ? `${open.title}: I'm still looking this up. Meanwhile: ${open.question}` : open.question;
}
