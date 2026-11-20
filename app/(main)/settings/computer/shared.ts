import type { StudioDeviceSummary } from "@/lib/studio/devices";

export const buttonClass = "rounded-md border px-3 py-2 text-sm disabled:opacity-50";
export const primaryButtonClass = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
export const inputClass = "mt-1 w-full rounded-md border bg-background p-2";
export const endpoint = "/api/studio/settings/devices";
export type Provider = "codex" | "claude";
export type ProviderReport = { installed?: boolean; authenticated?: boolean; ready?: boolean; version?: string; models?: string[]; loginMethod?: string };
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function providerReport(device: StudioDeviceSummary, provider: Provider): ProviderReport { return record(device.capabilities[provider]) as ProviderReport; }
