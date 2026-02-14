import { getModelForTask } from "./model-router";
import { callLLM } from "./llm";

const CRITIC_PROMPT = `You are a quality control agent for a real estate agency.

Review this draft reply and provide a refined version if needed.

Original Intent: {intent}
Conversation Context (last 3 messages):
{context}

Draft to Review:
"{draft}"

Evaluation Criteria:
1. TONE: Is it professional but warm? Not too salesy, not too cold?
2. ACCURACY: Does it match what the client asked about?
3. ACTIONABILITY: Does it move the deal forward? Does it have a clear next step?
4. BREVITY: Is it concise? Real estate clients prefer short messages.
5. SAFETY: Does it make any promises or disclose confidential information?

If the draft is good (score >= 8/10), return it unchanged.
If it needs improvement, return the refined version.

Format:
{
  "score": <1-10>,
  "issues": ["issue1", "issue2"],
  "refined_draft": "<improved text or original if no changes>"
}
`;

export async function reflectOnDraft(
    draft: string,
    conversationContext: string,
    intent: string
): Promise<string> {
    const model = getModelForTask("draft_reply"); // Standard tier used for critic

    const prompt = CRITIC_PROMPT
        .replace("{intent}", intent)
        .replace("{context}", conversationContext)
        .replace("{draft}", draft);

    try {
        const response = await callLLM(model, prompt, undefined, { jsonMode: true });
        const result = JSON.parse(response);

        if (result.score >= 8) {
            return draft; // Good enough
        }

        return result.refined_draft || draft;
    } catch (error) {
        console.error("Reflexion failed:", error);
        return draft;
    }
}
