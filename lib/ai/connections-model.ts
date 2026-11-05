/**
 * Which AI a Location can use, as plain data (client-safe, no secrets). `available` gates features that need AI on the
 * Location's own account, starting with the onboarding chat: at least one source must be ready.
 */
export type AiConnectionKind = "gemini_key" | "openai_key" | "chatgpt_subscription" | "device_codex" | "device_claude";
export type AiConnectionSource = { kind: AiConnectionKind; label: string; scope: "location" | "member" | "device"; ready: boolean; detail?: string };
export type AiConnections = { available: boolean; sources: AiConnectionSource[] };

export type AiConnectionInputs = {
  geminiKey: boolean;
  openAiKey: boolean;
  chatGpt: { enabled: boolean; health: string | null; hasCredential: boolean };
  devices: { name: string; revoked: boolean; paused: boolean; seenAt: string | null; draining: boolean; capabilities: Record<string, unknown> }[];
};

type ProviderReport = { installed?: boolean; authenticated?: boolean; ready?: boolean; loginMethod?: string };
const subscriptionLogin: Record<"codex" | "claude", string> = { codex: "chatgpt", claude: "claudeai" };

/** Pure assembly, so the rules are testable without a database. */
export function assembleAiConnections(input: AiConnectionInputs, now = Date.now(), onlineSeconds = 90): AiConnections {
  const sources: AiConnectionSource[] = [
    { kind: "gemini_key", label: "Google Gemini API key", scope: "location", ready: input.geminiKey, ...(input.geminiKey ? {} : { detail: "Not saved" }) },
    { kind: "openai_key", label: "OpenAI API key", scope: "location", ready: input.openAiKey, ...(input.openAiKey ? {} : { detail: "Not saved" }) },
  ];
  const chatGptReady = input.chatGpt.enabled && input.chatGpt.health === "connected" && input.chatGpt.hasCredential;
  if (input.chatGpt.enabled || input.chatGpt.hasCredential)
    sources.push({ kind: "chatgpt_subscription", label: "ChatGPT subscription", scope: "location", ready: chatGptReady,
      ...(chatGptReady ? {} : { detail: input.chatGpt.hasCredential ? "Needs reconnecting" : "Not connected" }) });
  for (const device of input.devices.filter(d => !d.revoked)) {
    const online = !device.draining && !!device.seenAt && now - Date.parse(device.seenAt) < onlineSeconds * 1000;
    for (const provider of ["codex", "claude"] as const) {
      const report = device.capabilities[provider] as ProviderReport | undefined;
      if (!report?.installed) continue;
      // A device counts when its CLI is signed in with a subscription (ChatGPT or claude.ai), not an API key.
      const signedIn = report.authenticated === true && report.loginMethod === subscriptionLogin[provider];
      const ready = signedIn && online && !device.paused;
      sources.push({ kind: provider === "codex" ? "device_codex" : "device_claude", label: `${provider === "codex" ? "Codex (ChatGPT)" : "Claude"} on ${device.name}`, scope: "device", ready,
        ...(ready ? {} : { detail: !signedIn ? "Not signed in with a subscription" : device.paused ? "Paused" : "Mac offline" }) });
    }
  }
  return { available: sources.some(s => s.ready), sources };
}
