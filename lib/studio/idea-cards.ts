const fields = ["Title", "Premise", "Audience", "Spoken opening", "Payoff"] as const;
type IdeaField = typeof fields[number];

export const IDEA_CARD_FORMAT = `Return each distinct option as a separate Concept proposal. In its text, use these five labelled lines: ${fields.join(", ")}. Keep each field to one short sentence (160 characters maximum). Make the spoken opening ready to say on camera and the payoff something the viewer will see or learn. Use the proposal's evidence and verification fields for support and open assumptions. Ask at most one question, only if it would materially change the direction.`;

export function readIdeaCard(text: string): Record<IdeaField, string> | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== fields.length) return null;
  const values = fields.map((field, index) => {
    const prefix = `${field}:`;
    return lines[index].startsWith(prefix) ? lines[index].slice(prefix.length).trim() : "";
  });
  if (values.some(value => !value || value.length > 160)) return null;
  return { Title: values[0], Premise: values[1], Audience: values[2], "Spoken opening": values[3], Payoff: values[4] };
}

export function ideaComparisonPrompt(ideas: readonly string[]) {
  return `Compare these two ideas on how immediately the opening delivers the title, strength of payoff, and what I can film. Name the trade-off and suggest which to develop.\n\n${ideas.map((idea, index) => `Idea ${index + 1}\n${idea}`).join("\n\n")}`;
}
