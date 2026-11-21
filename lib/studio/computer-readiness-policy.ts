import { nativeAllowance, reportedSubscriptionLimit } from "./subscription-readiness";
import { deviceProcessingBlock } from "./devices-policy";

export type ComputerReadinessDevice = { name: string; status: "online" | "busy" | "paused" | "offline" | "revoked"; processingEnabled: boolean; capabilities?: Record<string, unknown> };
export type ComputerReadiness = { tone: "ready" | "attention" | "none"; label: string; detail: string; action: string };

/** One plain-language line about the connected computer. Mac work is queued even when it is offline, so offline is "attention", not blocked. */
export function summarizeComputerReadiness(devices: readonly ComputerReadinessDevice[]): ComputerReadiness {
  const active = devices.filter(device => device.status !== "revoked");
  if (!active.length) return { tone: "none", label: "No computer connected", detail: "Transcription, summaries and related-video search run on your own Mac.", action: "Connect a computer" };
  const ready = active.find(device => (device.status === "online" || device.status === "busy") && device.processingEnabled && !deviceProcessingBlock(device.capabilities ?? {}));
  if (ready) return { tone: "ready", label: `${ready.name} is connected`, detail: ready.status === "busy" ? "Working on a request now." : "Check Devices for readiness by task.", action: "Manage" };
  const blocked = active.find(device => (device.status === "online" || device.status === "busy") && device.processingEnabled && deviceProcessingBlock(device.capabilities ?? {}));
  if (blocked) return { tone: "attention", label: `${blocked.name} is connected · processing blocked`,
    detail: deviceProcessingBlock(blocked.capabilities ?? {})!, action: "Check Devices" };
  const paused = active.find(device => device.status === "paused" || !device.processingEnabled);
  if (paused) return { tone: "attention", label: `${paused.name} is paused`, detail: "Requests wait until processing is turned on in Setup.", action: "Open Setup" };
  return { tone: "attention", label: `${active[0].name} is offline`, detail: "Requests wait and start by themselves when the companion reconnects.", action: "Check connection" };
}

export interface ComputerTaskInput {
  status: "online" | "busy" | "paused" | "offline" | "revoked"; processingEnabled: boolean;
  config: { version: number; appliedVersion: number; status: string; value: { textProvider: string | null; features: { text: boolean; transcription: boolean } } };
  capabilities: Record<string, unknown>; research: { ready: boolean; reason: string | null };
}
export interface ComputerTask { id: "transcribe" | "assistant" | "related" | "research"; label: string; ready: boolean; detail: string; fix: string | null }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const handles = (caps: Record<string, unknown>, kind: string) => Array.isArray(caps.handlers) && (caps.handlers as unknown[]).includes(kind);

/** What this computer can do for the user right now, and the single next step for each thing that cannot. */
export function computerTasks(device: ComputerTaskInput): ComputerTask[] {
  const caps = device.capabilities;
  const localBlock = deviceProcessingBlock(caps);
  const blocked = device.status === "offline" ? { detail: "No recent heartbeat from the Studio companion.", fix: "Start the companion" }
    : device.status === "paused" ? { detail: "This Mac is paused.", fix: "Resume" }
    : !device.processingEnabled ? { detail: "Processing is off.", fix: "Turn processing on" }
    : localBlock ? { detail: localBlock, fix: "Open Setup" } : null;
  const task = (id: ComputerTask["id"], label: string, ready: boolean, detail: string, fix: string | null, okDetail: string): ComputerTask =>
    blocked ? { id, label, ready: false, ...blocked } : { id, label, ready, detail: ready ? okDetail : detail, fix: ready ? null : fix };
  const video = record(caps.video); const search = record(caps.youtubeSearch);
  const provider = device.config.value.textProvider;
  const report = provider ? record(caps[provider]) : {};
  const native = caps.nativeSubscriptionVersion === 1;
  const currentProvider = provider === "codex" || provider === "claude" ? provider : null;
  const limited = currentProvider && reportedSubscriptionLimit(caps, currentProvider);
  const capacity = record(caps.capacity);
  const textReady = !limited && (!native || (currentProvider && capacity[currentProvider] === true)) && device.config.value.features.text && Boolean(provider) && device.config.version === device.config.appliedVersion && device.config.status === "applied"
    && report.authenticated === true && report.ready === true && handles(caps, "studio.text_run");
  const textDetail = limited ? "Subscription limit reached on this Mac." : !handles(caps, "studio.text_run") ? "Update the Studio companion on this Mac." : !device.config.value.features.text ? "Text work is off in Setup." : !provider ? "Choose Codex or Claude in Setup."
    : device.config.version !== device.config.appliedVersion ? "Waiting for the Mac to apply Setup." : "Sign in to your chosen subscription below.";
  const textFix = !handles(caps, "studio.text_run") ? "Update the companion" : !device.config.value.features.text || !provider ? "Open Setup" : device.config.version !== device.config.appliedVersion ? null : "Connect your subscription";
  return [
    task("transcribe", "Transcribe videos", handles(caps, "studio.video_transcribe") && device.config.value.features.transcription && video.ready === true,
      !handles(caps, "studio.video_transcribe") ? "Update the Studio companion on this Mac." : !device.config.value.features.transcription ? "Video transcription is off in Setup." : "Transcription tools are missing on this Mac.",
      !handles(caps, "studio.video_transcribe") ? "Update the companion" : !device.config.value.features.transcription ? "Open Setup" : "Install transcription tools", "Local Parakeet, with YouTube captions as the only fallback."),
    task("assistant", "Assistant, summaries and idea reviews", Boolean(textReady), textDetail, limited ? null : textFix, `Ready on your ${provider === "claude" ? "Claude" : "Codex"} subscription.${native && currentProvider && !nativeAllowance(caps.usage, currentProvider) ? " Remaining allowance is unknown." : ""}`),
    task("related", "Find related videos", search.ready === true, "Chrome isn't ready on this Mac.", "Install Google Chrome", "Searches in this Mac's own Chrome."),
    task("research", "Business research", device.research.ready, device.research.reason ?? "Not available yet.", /signed in|capacity/i.test(device.research.reason ?? "") ? "Connect your subscription" : "Open Setup", "Ready on your signed-in subscription."),
  ];
}
