"use client";
import Link from "next/link";
import { BudgetForm } from "./key-budget-forms";
import { LocationAiSettingsView, type LocationAiSettingsProps } from "./location-ai-settings-view";

export type { AiSettingsLinks, LocationAiSettingsProps } from "./location-ai-settings-view";

/**
 * The one Location AI settings screen for Estio CRM and Studio (mounted at /settings/ai). Route-agnostic: load props with
 * `loadLocationAiSettings(locationId, links)` from ./load and render inside any shell.
 */
/** API keys are entered on the Connections tab for every platform and type; this page only shows their state and how they are used. */
function KeysOnConnections({ name, anchor }: { name: string; anchor: string }) {
  return <p className="text-sm text-muted-foreground">Add, replace or remove the {name} key on <Link href={`/settings/ai/connections#${anchor}`} className="text-primary hover:underline">Connections</Link>.</p>;
}
export function LocationAiSettings(props: LocationAiSettingsProps) {
  const budgetUsd = (props.routing.budget.capMicros / 1_000_000).toFixed(2);
  return <LocationAiSettingsView key={props.locationId} {...props}
    keyForm={<KeysOnConnections name="OpenAI" anchor="openai" />}
    geminiKeyForm={<KeysOnConnections name="Gemini" anchor="google" />}
    budgetForm={<BudgetForm locationId={props.locationId} budgetUsd={budgetUsd} />} />;
}
