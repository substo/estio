import { IDEA_REVIEW_MAX_OUTPUT, IDEA_REVIEW_MODEL, IDEA_REVIEW_PROMPT, ideaReviewInstructions, ideaReviewSchema, readIdeaReviewResult, type IdeaSnapshot, type IdeaReviewResult } from "../idea-review-policy";
import { requestStructuredText, type TextRunSpec } from "./openai-text";
export const ideaReviewSpec: TextRunSpec<IdeaReviewResult> = { workflow: "idea_review", model: IDEA_REVIEW_MODEL, promptVersion: IDEA_REVIEW_PROMPT,
  instructions: ideaReviewInstructions, schema: ideaReviewSchema, maxOutputTokens: IDEA_REVIEW_MAX_OUTPUT, validate: readIdeaReviewResult };
export function requestIdeaReview(snapshot: IdeaSnapshot, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return requestStructuredText(ideaReviewSpec, snapshot, key, signal, fetcher);
}
export type IdeaProviderResult = Awaited<ReturnType<typeof requestIdeaReview>>;
