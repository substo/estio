/**
 * Which model does which kind of video work. Everything runs on the creator's own Mac with their subscription (Claude or Codex);
 * nothing here can select a paid API. "default" means whatever the Mac's CLI uses without a flag, which is also the starting value.
 * Pure data and text, shared by the Make video dialog (what the user picks and sees) and the Mac companion (what it runs), so they cannot drift.
 */
import { AI_MODEL_ID_PATTERN, CLAUDE_MODELS, CODEX_FALLBACK_MODELS } from "../../ai/connections-model";

export const JOB_TYPES = ["plan", "motion", "edit", "text"] as const;
export type JobType = typeof JOB_TYPES[number];
export const JOB_TYPE_LABELS: Record<JobType, { label: string; hint: string; /** The editing agent is Claude Code only; text work can also run on Codex. */ agent: boolean }> = {
  plan: { label: "Script and storyboard planning", hint: "Ideas, briefs, storyboard text", agent: false },
  motion: { label: "Motion graphics", hint: "Titles, callouts, cards, lower thirds, animated graphics", agent: true },
  edit: { label: "Editing and assembly", hint: "Cutting, captions, sound, revisions", agent: true },
  text: { label: "Other text", hint: "Summaries and anything else written", agent: false },
};

export type ModelProvider = "claude" | "codex";
/** A choice for one kind of work: the Mac's default, or a provider and model of the creator's own subscription. */
export type ModelPick = { provider: "default" } | { provider: ModelProvider; model: string };
export interface ModelPrefs { jobs: Record<JobType, ModelPick>; /** A revision of a graphic goes back to the model that designed it. */ keepDesigner: boolean }
export const DEFAULT_MODEL_PREFS: ModelPrefs = { jobs: { plan: { provider: "default" }, motion: { provider: "default" }, edit: { provider: "default" }, text: { provider: "default" } }, keepDesigner: false };

/** The models offered for a kind of work; the agent kinds only have Claude because the editor is driven by Claude Code. */
export function modelChoices(type: JobType): { provider: ModelProvider; id: string; label: string }[] {
  const claude = CLAUDE_MODELS.map(m => ({ provider: "claude" as const, id: m.id, label: m.label }));
  return JOB_TYPE_LABELS[type].agent ? claude : [...claude, ...CODEX_FALLBACK_MODELS.map(m => ({ provider: "codex" as const, id: m.id, label: m.label }))];
}

const one = (type: JobType, value: unknown): ModelPick => {
  if (!value || typeof value !== "object") return { provider: "default" };
  const raw = value as Record<string, unknown>;
  const provider = raw.provider;
  if ((provider !== "claude" && provider !== "codex") || typeof raw.model !== "string" || !AI_MODEL_ID_PATTERN.test(raw.model)) return { provider: "default" };
  if (JOB_TYPE_LABELS[type].agent && provider !== "claude") return { provider: "default" };
  return { provider, model: raw.model };
};

/** Anything not recognised falls back to the default instead of failing a video. */
export function readModelPrefs(value: unknown): ModelPrefs {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const jobs = (raw.jobs && typeof raw.jobs === "object" ? raw.jobs : {}) as Record<string, unknown>;
  return { jobs: Object.fromEntries(JOB_TYPES.map(t => [t, one(t, jobs[t])])) as Record<JobType, ModelPick>, keepDesigner: raw.keepDesigner === true };
}

/** A select value: "default" or "claude:<model>" / "codex:<model>". */
export const encodePick = (pick: ModelPick) => pick.provider === "default" ? "default" : `${pick.provider}:${pick.model}`;
export function decodePick(type: JobType, text: unknown): ModelPick {
  if (typeof text !== "string" || text === "default") return { provider: "default" };
  const at = text.indexOf(":");
  return one(type, at > 0 ? { provider: text.slice(0, at), model: text.slice(at + 1) } : null);
}
export function readModelPrefsFromForm(form: FormData): ModelPrefs {
  return { jobs: Object.fromEntries(JOB_TYPES.map(t => [t, decodePick(t, form.get(`model_${t}`))])) as Record<JobType, ModelPick>, keepDesigner: form.get("keepDesigner") === "on" };
}

const modelLabel = (pick: ModelPick) => pick.provider === "default" ? "Mac default model" : ([...CLAUDE_MODELS, ...CODEX_FALLBACK_MODELS].find(m => m.id === pick.model)?.label ?? pick.model);
/** Where the work runs, as shown in the UI: always the creator's own Mac subscription. */
export const routeLabel = (pick: ModelPick) => `Mac subscription · ${pick.provider === "codex" ? "Codex" : "Claude"} · ${modelLabel(pick)}`;

/** The model flag for an agent run, or undefined for the Mac's default. */
export const agentModel = (pick: ModelPick): string | undefined => pick.provider === "claude" ? pick.model : undefined;

/** A request that is about graphics (titles, callouts, charts, counters, lower thirds, animation) rather than cutting. */
export const touchesGraphics = (instruction: string) => /\b(graphics?|titles?|callouts?|lower[- ]thirds?|cards?|charts?|counters?|bars?|animat\w*|motion|kinetic|typograph\w*|headline|label)\b/i.test(instruction);

export interface RanModels { edit?: string; motion?: string }
/**
 * Which model runs a revision. Graphics requests use the motion choice, or the model that designed the graphic when the creator asked to keep it;
 * everything else uses the editing choice. The designer is whatever this Mac recorded when it last made the graphics.
 */
export function revisionModel(prefs: ModelPrefs, instruction: string, designer?: string): { model: string | undefined; kind: "motion" | "edit"; reason: "designer" | "preference" | "default" } {
  const graphics = touchesGraphics(instruction);
  if (graphics && prefs.keepDesigner && designer && AI_MODEL_ID_PATTERN.test(designer)) return { model: designer, kind: "motion", reason: "designer" };
  const kind = graphics ? "motion" : "edit";
  const model = agentModel(prefs.jobs[kind]);
  return { model, kind, reason: model ? "preference" : "default" };
}

/** One plain sentence for the result line: what actually ran, never what was only asked for. */
export function ranModelsLine(ran: RanModels): string {
  const name = (m?: string) => m ?? "the Mac's default model";
  const parts = ran.motion && ran.motion !== ran.edit ? [`editing: ${name(ran.edit)}`, `motion graphics: ${name(ran.motion)}`] : [`editing and motion graphics: ${name(ran.edit)}`];
  return `Ran on your Mac subscription (Claude). ${parts.join("; ")}.`;
}

/** The result line of a revision: what ran this change, and whether it was kept for being the graphic's designer. */
export function revisionRanLine(kind: "motion" | "edit", model: string | undefined, reason: "designer" | "preference" | "default"): string {
  return `Ran on your Mac subscription (Claude). ${kind === "motion" ? "Motion graphics" : "Editing"}: ${model ?? "the Mac's default model"}.${reason === "designer" ? " Kept the model that designed these graphics." : ""}`;
}
