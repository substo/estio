import { nativeAllowance } from "./subscription-readiness";
import type { StudioDeviceConfig } from "./devices-policy";
import { deviceResearchReadiness, type DeviceResearchInput } from "./devices-policy";
export type TextDeviceInput = DeviceResearchInput & { config: StudioDeviceConfig; configVersion: number; appliedVersion: number; configStatus: string };
/** Same subscription prerequisites as research, with explicit Text work, provider and applied-config gates. */
export function deviceTextReadiness(input: TextDeviceInput, now = Date.now()) {
  const no = (reason: string) => ({ ready: false, reason });
  if (!input.allowedKinds.includes("studio.text_run")) return no("Update the server and companion for text workflows.");
  const handlers = Array.isArray(input.capabilities.handlers) ? input.capabilities.handlers : [];
  if (!handlers.includes("studio.text_run")) return no("Update the Studio companion on your Mac.");
  if (!input.config.features.text) return no("Turn on Text work in Connected computer → Setup.");
  const provider = input.config.textProvider;
  if (!provider) return no("Choose Codex or Claude in Connected computer → Setup.");
  if (input.configVersion !== input.appliedVersion || input.configStatus !== "applied") return no("Waiting for the Mac to apply Setup.");
  const readiness = deviceResearchReadiness({ ...input, allowedKinds: [...input.allowedKinds, "studio.onboarding_research"],
    capabilities: { ...input.capabilities, [provider === "codex" ? "claude" : "codex"]: undefined, handlers: [...handlers, "studio.onboarding_research"] } }, now);
  if (!readiness.ready) return no(readiness.reason!);
  return { ready: true, label: `${provider === "codex" ? "Codex" : "Claude"} · ${input.config.textModel || "CLI default"}`, reason: `Ready on your Mac with ${provider}${input.config.textModel ? ` (${input.config.textModel})` : " (CLI default)"}.${input.capabilities.nativeSubscriptionVersion === 1 && !nativeAllowance(input.capabilities.usage, provider, now) ? " Remaining allowance is unknown. The CLI checks it when the request runs." : ""}` };
}
