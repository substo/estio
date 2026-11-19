export type ComputerReadinessDevice = { name: string; status: "online" | "busy" | "paused" | "offline" | "revoked"; processingEnabled: boolean };
export type ComputerReadiness = { tone: "ready" | "attention" | "none"; label: string; detail: string; action: string };

/** One plain-language line about the connected computer. Mac work is queued even when it is offline, so offline is "attention", not blocked. */
export function summarizeComputerReadiness(devices: readonly ComputerReadinessDevice[]): ComputerReadiness {
  const active = devices.filter(device => device.status !== "revoked");
  if (!active.length) return { tone: "none", label: "No computer connected", detail: "Transcription, summaries and related-video search run on your own Mac.", action: "Connect a computer" };
  const ready = active.find(device => (device.status === "online" || device.status === "busy") && device.processingEnabled);
  if (ready) return { tone: "ready", label: `${ready.name} is ready`, detail: ready.status === "busy" ? "Working on a request now." : "Transcription and research can start immediately.", action: "Manage" };
  const paused = active.find(device => device.status === "paused" || !device.processingEnabled);
  if (paused) return { tone: "attention", label: `${paused.name} is paused`, detail: "Requests wait until processing is turned on in Setup.", action: "Open Setup" };
  return { tone: "attention", label: `${active[0].name} is offline`, detail: "Requests wait and start by themselves when the companion reconnects.", action: "Check connection" };
}
