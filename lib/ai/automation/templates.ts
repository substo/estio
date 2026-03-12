import type { AiAutomationConfig, AutomationTemplateKey } from "@/lib/ai/automation/config";

export type TemplatePromptInput = {
  templateKey: AutomationTemplateKey;
  config: AiAutomationConfig;
  contextSummary?: string;
  templatePromptOverride?: string | null;
};

const TEMPLATE_DEFAULT_PROMPTS: Record<AutomationTemplateKey, string> = {
  post_viewing_follow_up:
    "Write a concise follow-up after a recent viewing. Confirm impressions, ask one concrete next-step question, and keep the tone helpful.",
  inactive_lead_reengagement:
    "Write a re-engagement follow-up for an inactive lead. Keep it respectful, reference prior context briefly, and offer a low-friction next step.",
  re_engagement:
    "Write a short check-in message for a lead that has gone quiet. Avoid pressure and give a clear single response option.",
  listing_alert:
    "Write a new-listing alert that is specific to the contact's preferences and asks whether they want details or a viewing.",
  custom_follow_up:
    "Write a tailored follow-up message based on the configured campaign goal and current conversation context.",
};

export function buildTemplatePrompt(input: TemplatePromptInput): string {
  const { templateKey, config } = input;
  const base = TEMPLATE_DEFAULT_PROMPTS[templateKey];
  const override = String(input.templatePromptOverride || "").trim();
  const prompt = override || base;

  const context = String(input.contextSummary || "").trim();
  const style = `Style profile: ${config.styleProfile}.`;
  const depth = `Research depth: ${config.researchDepth}.`;

  return [
    prompt,
    style,
    depth,
    context ? `Context:\n${context}` : null,
    "Never claim a message was sent or approved. Return only a draft suitable for human approval.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
