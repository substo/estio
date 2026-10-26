import { defaultDeviceConfig, readDeviceConfig, type StudioDeviceConfig } from "../devices-policy";
import type { ConfigAck, HeartbeatState } from "./http-queue";
import type { Hardware } from "./discovery";

export const unsupportedReasons = {
  launchAtLogin: "Needs the installed Mac app (not built yet)",
  localWorkflow: "Local workflow not built yet; settings saved for later",
} as const;
/** Validate desired config with the shared server validator and list keys this companion can't honour yet. */
export function applyDesiredConfig(desired: { version: number; value?: unknown }): { config: StudioDeviceConfig | null; ack: ConfigAck } {
  let config: StudioDeviceConfig;
  try { config = readDeviceConfig(desired.value); }
  catch { return { config: null, ack: { version: desired.version, status: "error", error: "This setup is not valid for this companion version. Update the companion or save the setup again." } }; }
  const unsupported: Record<string, string> = {};
  if (config.resources.launchAtLogin) unsupported["resources.launchAtLogin"] = unsupportedReasons.launchAtLogin;
  if (config.features.transcription) unsupported["features.transcription"] = unsupportedReasons.localWorkflow;
  if (config.features.text) unsupported["features.text"] = unsupportedReasons.localWorkflow;
  return { config, ack: { version: desired.version, status: "applied", ...(Object.keys(unsupported).length ? { unsupported } : {}) } };
}
/** Tracks server device state, the applied config and the acknowledgement still to be sent. */
export class DeviceSettings {
  state: Pick<HeartbeatState, "processingEnabled" | "paused"> = { processingEnabled: false, paused: false };
  config: StudioDeviceConfig = defaultDeviceConfig;
  appliedVersion = 0;
  pendingAck: ConfigAck | undefined;
  /** Returns true when a new config version arrived (so the caller can ack promptly). */
  update(state: HeartbeatState | null, sentAck?: ConfigAck): boolean {
    if (sentAck && this.pendingAck?.version === sentAck.version) this.pendingAck = undefined;
    if (!state) return false;
    this.state = { processingEnabled: state.processingEnabled, paused: state.paused };
    // Version 0 = nothing saved yet (defaults, nothing to acknowledge). A restart re-applies and re-acks the current version.
    if (state.config.version === 0 || state.config.version === this.appliedVersion) return false;
    const { config, ack } = applyDesiredConfig(state.config);
    if (config) this.config = config;
    this.appliedVersion = state.config.version;
    this.pendingAck = ack;
    return true;
  }
}
function minutesIn(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find(p => p.type === "hour")?.value) * 60 + Number(parts.find(p => p.type === "minute")?.value);
}
export function withinWorkingHours(hours: StudioDeviceConfig["resources"]["workingHours"], now = new Date()) {
  if (!hours) return true;
  const toMin = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const current = minutesIn(hours.timeZone, now), start = toMin(hours.start), end = toMin(hours.end);
  return start < end ? current >= start && current < end : current >= start || current < end; // Overnight windows wrap.
}
export interface LocalGate { diagnostics: boolean; processing: boolean; reasons: string[] }
/** Decide locally, before claiming, what may run. Diagnostics only stop when paused. */
export function localGate(input: { state: DeviceSettings["state"]; config: StudioDeviceConfig; power?: Hardware["power"]; freeDiskGb?: number; now?: Date }): LocalGate {
  const { state, config } = input;
  if (state.paused) return { diagnostics: false, processing: false, reasons: ["paused"] };
  const reasons: string[] = [];
  if (!state.processingEnabled) reasons.push("processing_disabled");
  if (!config.resources.allowOnBattery && input.power?.source !== "ac") reasons.push("on_battery_or_unknown_power");
  if (!withinWorkingHours(config.resources.workingHours, input.now)) reasons.push("outside_working_hours");
  if (input.freeDiskGb === undefined || input.freeDiskGb < config.resources.minFreeDiskGb) reasons.push("low_disk_space");
  return { diagnostics: true, processing: reasons.length === 0, reasons };
}
