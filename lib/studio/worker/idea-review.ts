import type { IdeaReviewResult } from "../idea-review-policy";
import { ideaReviewSpec, requestIdeaReview } from "./openai-idea-review";
import { createTextRunHandler, productionTextRunDeps, type TextRunDeps } from "./text-run";
export type IdeaReviewDeps = TextRunDeps<IdeaReviewResult>;
export const createIdeaReviewHandler = (deps: IdeaReviewDeps) => createTextRunHandler(ideaReviewSpec, deps);
export const productionIdeaReviewDeps = (rest: IdeaReviewDeps["db"]) => productionTextRunDeps(rest, requestIdeaReview);
