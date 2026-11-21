import { StudioCommandError } from "./command-error";
import { recordLinkId } from "./record-link-policy";
import { hasStudioTextConsent, readStudioTextProvider } from "./text-provider";

export const CREATION_STAGES = ["Concept", "Angle", "Title", "Hook", "Payoff", "Script", "Shoot plan"] as const;
export type CreationStage = typeof CREATION_STAGES[number];
export type CreationSource = { id: string; version: number; title: string; concept: string; basis: string };
export type Direction = { publisher: string; viewer: string; goal: string; angle: string };
export const DIRECTION_CHOICES = [
  { id: "promote", label: "Promote our brand", description: "Teach first-time creators how to improve their own videos, then briefly show how the publisher's product helps." },
  { id: "customer", label: "Make a customer’s video", description: "Help a business speak to its own customers. Specify the business, viewers and desired outcome." },
  { id: "educate", label: "Teach creators", description: "Give creators a practical lesson. The publisher’s product can appear as an example." },
] as const;
export type DirectionChoice = typeof DIRECTION_CHOICES[number]["id"] | "brief" | "custom" | "conversation";
export type ConfirmedDirection = Direction & { choice: DirectionChoice; rationale: string };
export type LinkedDraft = { id: string; version: number; title: string };
export type DraftContextChoice = Pick<LinkedDraft, "id" | "version"> & { purpose: "compare" | "revise" };
export type NextRunContext = { includeReferences: boolean; linkedDraft: DraftContextChoice | null };
export type Selection = { start: number; end: number; text: string };
export type StageDraft = { text: string; approved: boolean; shortlist: string[]; previous?: { text: string; approved: boolean } };
export type CreationState = {
  schema: 1; brief: string; direction: ConfirmedDirection; source: CreationSource | null;
  stages: Partial<Record<CreationStage, StageDraft>>;
  history: Array<{ stage?: CreationStage; note: string; quote?: string; at: string; reviewId?: string }>;
};
export type CreationRecord = { id: string; version: number; templateId: string | null; state: CreationState };
export const STAGE_LIMIT = 16000;
export const SELECTION_LIMIT = 1800;
export function stageTextLimit(stage: CreationStage) {
  if (stage === "Title") return 180;
  if (stage === "Script") return STAGE_LIMIT;
  return 1200;
}

/** A clear change of audience/publisher/goal needs the direction confirmation, not a rewrite. */
export function requestsDirectionChange(feedback: string) {
  return /\b(?:change|switch|replace|shift|reframe|retarget|use a different)\b[^.!?\n]{0,60}\b(?:audience|target viewer|publisher|objective|goal|industry|angle)\b|\b(?:new|different) (?:audience|publisher|objective|goal|industry)\b/i.test(feedback);
}
export const EMPTY_STAGE: StageDraft = { text: "", approved: false, shortlist: [] };
export const REWRITE_ACTIONS = ["Shorten", "Simplify", "Rewrite"] as const;

export function proposeDirection(brief: string, publisher: string, source: CreationSource | null, choice: DirectionChoice): Direction {
  const aboutMakingVideos = /mrbeast|improv(?:e|ing).*video|video.*opening|video.*promise/i.test([source?.title, source?.concept, brief].join(" "));
  const sourceAngle = aboutMakingVideos
    ? "Compare two openings for the creator’s own video. Show how the stronger one sets up the payoff."
    : source ? "Turn the source concept into an original example for the intended viewer." : "";
  if (choice === "promote") return { publisher, viewer: "First-time creators and small teams making their own videos",
    goal: publisher.toLowerCase() === "substo"
      ? "Teach first-time creators how to improve their own videos and briefly show Substo Studio."
      : "Teach viewers how to improve their videos and briefly show how the publisher’s product can help.", angle: sourceAngle };
  if (choice === "educate") return { publisher, viewer: "Creators learning to improve their own videos",
    goal: "Teach a practical video-making skill. Use the publisher’s product only as an example if relevant.", angle: sourceAngle };
  if (choice === "customer") return { publisher: "", viewer: "", goal: "", angle: "" };
  return { publisher: "", viewer: "", goal: choice === "brief" ? brief : "", angle: "" };
}

export function confirmDirection(choice: DirectionChoice, direction: Direction, brief: string): ConfirmedDirection {
  const { publisher, viewer, goal, angle } = direction;
  if ((choice === "brief" && !brief.trim()) || (choice !== "brief" && (!publisher.trim() || !viewer.trim() || !goal.trim()))) {
    throw new StudioCommandError("Confirm the publisher, intended viewer and goal, or use your supplied brief.");
  }
  return { publisher: publisher.trim(), viewer: viewer.trim(), goal: goal.trim(), angle: angle.trim(), choice,
    rationale: choice === "brief" ? "You confirmed your original brief as the direction. Any unspecified details stay open."
      : choice === "customer" ? "You chose the customer as publisher and specified who their video should reach."
      : "You confirmed who publishes, who should watch and what the video should accomplish." };
}

export function replaceSelection(text: string, selection: Selection, replacement: string) {
  if (selection.start < 0 || selection.end <= selection.start || selection.end > text.length
    || text.slice(selection.start, selection.end) !== selection.text) {
    throw new StudioCommandError("That selection changed. Select the exact words again.", 409);
  }
  const updated = text.slice(0, selection.start) + replacement + text.slice(selection.end);
  if (updated.length > STAGE_LIMIT) throw new StudioCommandError("This edit would exceed the stage text limit.");
  return updated;
}

export function stageDraft(state: CreationState, stage: CreationStage) {
  return state.stages[stage] ?? EMPTY_STAGE;
}

type Versioned = { recordId: string; version: number };
type DirectionInput = { brief: string; direction: ConfirmedDirection };
type GenerationInput = NextRunContext & (
  | { kind: "draft" | "suggest"; stage: CreationStage; feedback: string }
  | { kind: "rewrite"; stage: CreationStage; feedback: string; selection: Selection; instruction: typeof REWRITE_ACTIONS[number] });

export type CreationCommand =
  | ({ action: "create"; sourceId: string | null; sourceVersion: number | null; templateId: string | null } & Versioned & DirectionInput)
  | ({ action: "direction" } & Versioned & DirectionInput)
  | ({ action: "template"; templateId: string | null } & Versioned)
  | { [Action in "save" | "use" | "shortlist"]: { action: Action; stage: CreationStage; text: string } & Versioned }["save" | "use" | "shortlist"]
  | ({ action: "replace"; stage: CreationStage; selection: Selection; text: string } & Versioned)
  | ({ action: "comment"; stage: CreationStage; text: string; selection: Selection | null } & Versioned)
  | ({ action: "undo"; stage: CreationStage } & Versioned)
  | ({ action: "apply"; stage: CreationStage; reviewId: string; candidate: number | null } & Versioned)
  | ({ action: "generate"; requestId: string; provider: ReturnType<typeof readStudioTextProvider>; confirmPaid: boolean; confirmSubscription: boolean } & Versioned & GenerationInput);

export function readCreationCommand(value: unknown): CreationCommand {
  function object(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new StudioCommandError("Invalid creation command.");
    return input as Record<string, unknown>;
  }
  function id(input: unknown) {
    if (typeof input !== "string" || !recordLinkId(input)) throw new StudioCommandError("Choose a valid Studio record.");
    return input.toLowerCase();
  }
  function integer(input: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
    if (typeof input !== "number" || !Number.isSafeInteger(input) || input < min || input > max) throw new StudioCommandError("Reload the draft or select the exact words.");
    return input;
  }
  function text(input: unknown, max: number, required = false) {
    if (typeof input !== "string" || input.includes("\0") || input.length > max || (required && !input.trim())) throw new StudioCommandError("Enter text within the field limit.");
    return input;
  }
  function nullableId(input: unknown) { return input === null ? null : id(input); }
  function selection(input: unknown): Selection {
    const s = object(input);
    return { start: integer(s.start, 0, STAGE_LIMIT), end: integer(s.end, 1, STAGE_LIMIT), text: text(s.text, SELECTION_LIMIT, true) };
  }
  const b = object(value);
  const action = b.action;
  const base = { recordId: id(b.recordId), version: integer(b.version, action === "create" ? 0 : 1, action === "create" ? 0 : undefined) };
  if (action === "create" || action === "direction") {
    const brief = text(b.brief, 4000).trim();
    const d = object(b.direction);
    if (![...DIRECTION_CHOICES.map(c => c.id), "brief", "custom"].includes(d.choice as DirectionChoice)) throw new StudioCommandError("Choose a direction.");
    const direction = confirmDirection(d.choice as DirectionChoice, {
      publisher: text(d.publisher, 180), viewer: text(d.viewer, 500), goal: d.choice === "brief" ? brief : text(d.goal, 800), angle: text(d.angle, 800),
    }, brief);
    if (action === "direction") return { ...base, action, brief, direction };
    const sourceId = nullableId(b.sourceId);
    return { ...base, action, brief, direction, sourceId, sourceVersion: sourceId ? integer(b.sourceVersion, 1) : null, templateId: nullableId(b.templateId) };
  }
  if (action === "template") return { ...base, action, templateId: nullableId(b.templateId) };
  if (!CREATION_STAGES.includes(b.stage as CreationStage)) throw new StudioCommandError("Choose a creation stage.");
  const stage = b.stage as CreationStage;
  const target = { ...base, stage };
  if (action === "undo") return { ...target, action };
  if (action === "save" || action === "use" || action === "shortlist") return { ...target, action, text: text(b.text, stageTextLimit(stage), action !== "save") };
  if (action === "replace") return { ...target, action, selection: selection(b.selection), text: text(b.text, SELECTION_LIMIT) };
  if (action === "comment") return { ...target, action, selection: b.selection === null ? null : selection(b.selection), text: text(b.text, 1200, true).trim() };
  if (action === "apply") return { ...target, action, reviewId: id(b.reviewId), candidate: b.candidate === null ? null : integer(b.candidate, 0, 7) };
  if (action === "generate") {
    if (b.provider === undefined) throw new StudioCommandError("Choose a processing route.");
    const provider = readStudioTextProvider(b.provider);
    if (!hasStudioTextConsent(provider, b)) throw new StudioCommandError("Authorize the selected processing route.");
    const feedback = text(b.feedback, 1200).trim();
    if (requestsDirectionChange(feedback)) throw new StudioCommandError("Confirm the new video direction before generating.");
    const linked = b.linkedDraft == null ? null : object(b.linkedDraft);
    if (linked && linked.purpose !== "compare" && linked.purpose !== "revise") throw new StudioCommandError("Choose how to use the linked draft.");
    if (b.includeReferences !== undefined && typeof b.includeReferences !== "boolean") throw new StudioCommandError("Choose whether to include reference evidence.");
    const linkedDraft: DraftContextChoice | null = linked ? { id: id(linked.id), version: integer(linked.version, 1), purpose: linked.purpose as DraftContextChoice["purpose"] } : null;
    const run = { ...target, action, includeReferences: b.includeReferences !== false, linkedDraft, requestId: id(b.requestId), provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription", feedback } as const;
    if (b.kind === "suggest" || (b.kind === "draft" && stage === "Script")) return { ...run, kind: b.kind };
    if (b.kind === "rewrite" && REWRITE_ACTIONS.includes(b.instruction as typeof REWRITE_ACTIONS[number])) {
      return { ...run, kind: b.kind, selection: selection(b.selection), instruction: b.instruction as typeof REWRITE_ACTIONS[number] };
    }
  }
  throw new StudioCommandError("Choose a supported creation action.");
}
