"use client";
import { BudgetForm, OpenAiKeyForm } from "./key-budget-forms";
import { LocationAiSettingsView, type LocationAiSettingsProps } from "./location-ai-settings-view";

export type { AiSettingsLinks, LocationAiSettingsProps } from "./location-ai-settings-view";

/**
 * The one Location AI settings screen for Estio CRM and Studio (mounted at /settings/ai). Route-agnostic: load props with
 * `loadLocationAiSettings(locationId, links)` from ./load and render inside any shell.
 */
export function LocationAiSettings(props: LocationAiSettingsProps) {
  const budgetUsd = (props.routing.budget.capMicros / 1_000_000).toFixed(2);
  return <LocationAiSettingsView key={props.locationId} {...props}
    keyForm={<OpenAiKeyForm locationId={props.locationId} hasKey={!!props.openAiKey} />}
    budgetForm={<BudgetForm locationId={props.locationId} budgetUsd={budgetUsd} />} />;
}
