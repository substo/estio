export interface ScriptTemplateBeat {
  name: string;
  guidance: string;
}

export interface ScriptTemplateDraft {
  name: string;
  purpose: string;
  beats: ScriptTemplateBeat[];
}

export interface ScriptTemplateOption extends ScriptTemplateDraft {
  id: string;
  version: number;
}

export const MAX_SCRIPT_TEMPLATE_BEATS = 12;
export const SCRIPT_TEMPLATE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readText(value: FormDataEntryValue | null | undefined, label: string, limit: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > limit) throw new Error(`Enter ${label} up to ${limit} characters.`);
  return text;
}

export function readScriptTemplateDraft(form: FormData): ScriptTemplateDraft {
  const names = form.getAll("beatName");
  const guidance = form.getAll("beatGuidance");
  if (names.length !== guidance.length || names.length < 1 || names.length > MAX_SCRIPT_TEMPLATE_BEATS) {
    throw new Error(`Add between 1 and ${MAX_SCRIPT_TEMPLATE_BEATS} beats.`);
  }
  return {
    name: readText(form.get("name"), "a name", 120),
    purpose: readText(form.get("purpose"), "a purpose", 500),
    beats: names.map((name, index) => ({
      name: readText(name, `a name for beat ${index + 1}`, 80),
      guidance: readText(guidance[index], `guidance for beat ${index + 1}`, 500),
    })),
  };
}

// Undefined preserves the prior choice. Null explicitly opts out of a template.
export function readScriptTemplateSelection(form: FormData) {
  const choice = form.get("scriptTemplateVersion");
  if (choice === null || choice === "unchanged") return undefined;
  if (choice === "") return null;
  if (typeof choice !== "string" || !SCRIPT_TEMPLATE_UUID.test(choice)) throw new Error("Choose a valid script template.");
  return choice;
}

export function initialScriptTemplateSelection({
  pinnedId, selectionSaved, script, options,
}: {
  pinnedId?: string | null;
  selectionSaved?: boolean;
  script: unknown;
  options: readonly ScriptTemplateOption[];
}) {
  if (pinnedId) return pinnedId;
  if (selectionSaved) return "";
  if (typeof script === "string" && script.trim()) return "unchanged";
  return options.length === 1 ? options[0].id : "unchanged";
}

export const proofFirstScriptTemplate: ScriptTemplateDraft = {
  name: "Proof-first workflow demonstration",
  purpose: "Show a real result first, then demonstrate how the viewer could reach a similar result.",
  beats: [
    { name: "Viewer promise", guidance: "State the specific outcome the viewer will learn to achieve." },
    { name: "Actual result", guidance: "Show the real output early and explain what it demonstrates." },
    { name: "Initial source", guidance: "Credit the reference that prompted the idea." },
    { name: "Attributed findings", guidance: "Choose one to three relevant findings and credit their sources." },
    { name: "Original angle", guidance: "Connect what you learned to a problem your audience faces and your own approach." },
    { name: "Optional second source", guidance: "Include a second reference if it clarifies, supports, or challenges an important point." },
    { name: "Verified demonstration", guidance: "Show the steps and outcomes you have verified." },
    { name: "Setup and manual steps", guidance: "Name any required setup, manual work, or limits the viewer should know about." },
    { name: "Next action", guidance: "Give the viewer one practical next step." },
  ],
};
