import { StudioCommandError } from "./command-error";
export const studioTextProviders = ["subscription", "openai"] as const;
export type StudioTextProvider = typeof studioTextProviders[number];
/** Missing choice retains the existing explicit paid API contract for old clients. */
export function readStudioTextProvider(value: unknown): StudioTextProvider {
  if (value === undefined) return "openai";
  if (value === "subscription" || value === "openai") return value;
  throw new StudioCommandError("Choose your paired Mac subscription or the Location OpenAI API key.");
}
