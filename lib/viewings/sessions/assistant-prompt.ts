import { withAiWorkflowInstructions } from "../../ai/workflow-capabilities";

export function buildLiveAssistantPrompt(input: {
  language: string; contact: string; property: string; reference: string;
  recentConversation: string; request: string;
}): string {
  return withAiWorkflowInstructions([
    "You assist a real estate agent during a live conversation. Answer the agent's latest request clearly and briefly. Do not invent property or contact facts. Reply in the configured AI reply language.",
    `AI reply language: ${input.language}.`,
    `Contact: ${input.contact}. Property: ${input.property} (${input.reference}).`,
    `Recent conversation:\n${input.recentConversation}`,
    `Latest agent request: ${input.request}`,
  ].join("\n\n"), "crm_live_assistant");
}
