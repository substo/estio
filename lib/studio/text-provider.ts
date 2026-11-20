import { StudioCommandError } from "./command-error";

export type ExplicitStudioTextProvider = "subscription" | "openai";
export type StudioTextProvider = "location_order" | ExplicitStudioTextProvider;

/** Older explicit paid clients omit the provider and still have to confirm paid work. */
export function readStudioTextProvider(value: unknown): StudioTextProvider {
  if (value === undefined) return "openai";
  if (value === "location_order" || value === "subscription" || value === "openai") return value;
  throw new StudioCommandError("Choose a processing route.");
}

export function hasStudioTextConsent(provider: StudioTextProvider, input: Record<string, unknown>) {
  if (provider === "location_order") return input.confirmRoute === true;
  return provider === "openai" ? input.confirmPaid === true : input.confirmSubscription === true;
}

export function studioTextConsent(provider: StudioTextProvider, confirmed: boolean) {
  return {
    provider,
    confirmRoute: provider === "location_order" && confirmed,
    confirmPaid: provider === "openai" && confirmed,
    confirmSubscription: provider === "subscription" && confirmed,
  };
}
