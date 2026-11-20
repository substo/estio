import { usageFloor, usageSpec } from "../build/contract";
import { PAID_CONNECTION_KINDS, type AiConnectionKind } from "./workflow-capabilities";

/**
 * Which AI a Location can use, as plain data (client-safe, no secrets). This is the one place that reports each connection's
 * status and model list. `available` gates features that need AI on the Location's own account (the onboarding chat).
 */
export type { AiConnectionKind };
export type AiConnectionSource = { kind: AiConnectionKind; label: string; scope: "location" | "member" | "device"; ready: boolean; detail?: string };
/** `unavailable` = connected but unusable right now for a reason other than its limit (paused, processing off, no usage reading). */
export type AiConnectionStatus = "ready" | "limit_reached" | "unavailable" | "not_connected" | "offline";
export type AiModelOption = { id: string; label: string };
export type AiConnection = {
  /** Stable per Location: the kind, plus the device id for a Mac subscription. */
  id: string;
  kind: AiConnectionKind;
  scope: "location" | "device";
  label: string;
  status: AiConnectionStatus;
  reason?: string;
  /** Earliest known reset of the exhausted usage window (ISO), from the Mac's QuotaCell reading. */
  resetsAt?: string;
  /** Lowest remaining percentage across usage windows, when a fresh reading exists. */
  remainingPercent?: number;
  /** Reset of the usage window shown with remainingPercent, when reported. */
  usageResetsAt?: string;
  paid: boolean;
  deviceId?: string;
  /** Clerk user id of the Mac's owner. Server-only routing input: strip it before sending to a browser (see toClientConnection). */
  ownerUserId?: string;
  models: AiModelOption[];
  /** `reported` = the Mac's own list; `curated` = fallback list; `catalog` = provider model catalog. */
  modelsSource: "reported" | "curated" | "catalog";
  defaultModel: string | null;
};
export type AiConnections = { available: boolean; sources: AiConnectionSource[]; connections?: AiConnection[] };

type SubscriptionUsage = Pick<AiConnection, "remainingPercent" | "usageResetsAt">;
export type AiConnectionInputs = {
  geminiKey: boolean;
  openAiKey: boolean;
  chatGpt: { enabled: boolean; health: string | null; hasCredential: boolean; usage?: SubscriptionUsage };
  devices: {
    id?: string; name: string; createdBy?: string; revoked: boolean; paused: boolean; processingEnabled?: boolean; seenAt: string | null; draining: boolean;
    capabilities: Record<string, unknown>;
  }[];
  /** Server-provided model lists (hosted ChatGPT text models; stored OpenAI/Gemini catalog options). */
  catalogs?: Partial<Record<"chatgpt_subscription" | "openai_key" | "gemini_key", AiModelOption[]>>;
};

/** Curated fallbacks while a Mac does not report its own list (`CliReadiness.models`). Claude takes aliases or full IDs. */
export const CODEX_FALLBACK_MODELS: AiModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.4", label: "GPT-5.4" }, { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
];
export const CLAUDE_MODELS: AiModelOption[] = [
  { id: "opus", label: "Opus (latest)" }, { id: "sonnet", label: "Sonnet (latest)" }, { id: "haiku", label: "Haiku (latest)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }, { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];
export const AI_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;

type ProviderReport = { installed?: boolean; authenticated?: boolean; ready?: boolean; loginMethod?: string; models?: unknown };
const subscriptionLogin: Record<"codex" | "claude", string> = { codex: "chatgpt", claude: "claudeai" };
const usageBucket: Record<"codex" | "claude", string> = { codex: "codex", claude: "claudeAgent" };
const providerName: Record<"codex" | "claude", string> = { codex: "Codex", claude: "Claude" };

/** Limit/reset facts from the Mac's QuotaCell reading; readings older than 30 minutes or in the future are ignored. */
export function usageFacts(usage: unknown, bucket: string, now = Date.now()): { remaining?: number; resetsAt?: string; usageResetsAt?: string } {
  const parsed = usageSpec.safeParse(usage ?? {});
  const reading = parsed.success ? parsed.data[bucket] : undefined;
  const at = reading ? Date.parse(reading.at) : NaN;
  if (!reading || !Number.isFinite(at) || at > now || now - at >= 30 * 60_000) return {};
  const exhausted = reading.windows.filter(w => w.remaining <= usageFloor && w.resetsAt && Number.isFinite(Date.parse(w.resetsAt))).map(w => w.resetsAt!).sort();
  const usageResetsAt = reading.windows.filter(w => w.remaining === reading.remaining && w.resetsAt && Date.parse(w.resetsAt) > now).map(w => w.resetsAt!).sort()[0];
  return { remaining: reading.remaining, ...(exhausted[0] ? { resetsAt: exhausted[0] } : {}), ...(usageResetsAt ? { usageResetsAt } : {}) };
}

function deviceModels(provider: "codex" | "claude", report: ProviderReport): Pick<AiConnection, "models" | "modelsSource"> {
  const reported = Array.isArray(report.models) ? report.models.filter((m): m is string => typeof m === "string" && AI_MODEL_ID_PATTERN.test(m)) : [];
  if (reported.length) return { models: [...new Set(reported)].map(id => ({ id, label: id })), modelsSource: "reported" };
  return { models: provider === "codex" ? CODEX_FALLBACK_MODELS : CLAUDE_MODELS, modelsSource: "curated" };
}

function deviceConnection(device: AiConnectionInputs["devices"][number], provider: "codex" | "claude", now: number, onlineSeconds: number): AiConnection | null {
  const report = device.capabilities[provider] as ProviderReport | undefined;
  if (!report?.installed) return null;
  const online = !device.draining && !!device.seenAt && now - Date.parse(device.seenAt) < onlineSeconds * 1000;
  // A device counts when its CLI is signed in with a subscription (ChatGPT or claude.ai), not an API key.
  const signedIn = report.authenticated === true && report.loginMethod === subscriptionLogin[provider];
  const capacity = (device.capabilities.capacity as Partial<Record<"codex" | "claude", boolean>> | undefined)?.[provider];
  const usage = usageFacts(device.capabilities.usage, usageBucket[provider], now);
  const name = providerName[provider];
  const [status, reason]: [AiConnectionStatus, string | undefined] =
    !signedIn ? ["not_connected", "Not signed in with a subscription"]
    : !online ? ["offline", "Mac offline"]
    : device.paused ? ["unavailable", "Paused"]
    : device.processingEnabled === false ? ["unavailable", "Processing is off on this Mac"]
    : capacity === false || (usage.remaining !== undefined && usage.remaining <= usageFloor) ? ["limit_reached", `${name} limit reached`]
    : capacity !== true ? ["unavailable", "No usage reading from this Mac yet"]
    : ["ready", undefined];
  const models = deviceModels(provider, report);
  return {
    id: `device_${provider}:${device.id ?? device.name}`, kind: provider === "codex" ? "device_codex" : "device_claude", scope: "device",
    label: `${provider === "codex" ? "Codex (ChatGPT)" : "Claude"} on ${device.name}`, status, ...(reason ? { reason } : {}),
    ...(usage.resetsAt && status === "limit_reached" ? { resetsAt: usage.resetsAt } : {}), ...(usage.remaining !== undefined ? { remainingPercent: usage.remaining } : {}),
    ...(usage.usageResetsAt ? { usageResetsAt: usage.usageResetsAt } : {}),
    paid: false, ...(device.id ? { deviceId: device.id } : {}), ...(device.createdBy ? { ownerUserId: device.createdBy } : {}),
    ...models, defaultModel: null,
  };
}

/** Every connection with its status and models. Pure, so the rules are testable without a database. */
export function assembleLocationAiConnections(input: AiConnectionInputs, now = Date.now(), onlineSeconds = 90): AiConnection[] {
  const catalog = (kind: "chatgpt_subscription" | "openai_key" | "gemini_key") => input.catalogs?.[kind] ?? [];
  const location = (kind: "openai_key" | "gemini_key" | "chatgpt_subscription", label: string, status: AiConnectionStatus, reason?: string): AiConnection => ({
    id: kind, kind, scope: "location", label, status, ...(reason ? { reason } : {}), paid: PAID_CONNECTION_KINDS.includes(kind),
    models: catalog(kind), modelsSource: "catalog", defaultModel: catalog(kind)[0]?.id ?? null,
  });
  const chatGptReady = input.chatGpt.enabled && input.chatGpt.health === "connected" && input.chatGpt.hasCredential;
  const connections: AiConnection[] = [
    location("gemini_key", "Google Gemini API key", input.geminiKey ? "ready" : "not_connected", input.geminiKey ? undefined : "Not saved"),
    location("openai_key", "OpenAI API key", input.openAiKey ? "ready" : "not_connected", input.openAiKey ? undefined : "Not saved"),
    { ...location("chatgpt_subscription", "ChatGPT subscription", chatGptReady ? "ready" : input.chatGpt.hasCredential ? "unavailable" : "not_connected",
      chatGptReady ? undefined : input.chatGpt.hasCredential ? "Needs reconnecting" : "Not connected"), ...(chatGptReady ? input.chatGpt.usage : undefined) },
  ];
  for (const device of input.devices.filter(d => !d.revoked))
    for (const provider of ["codex", "claude"] as const) {
      const connection = deviceConnection(device, provider, now, onlineSeconds);
      if (connection) connections.push(connection);
    }
  return connections;
}

/** The summary the onboarding gate reads. Hosted ChatGPT is listed once it is enabled or has a credential. */
export function assembleAiConnections(input: AiConnectionInputs, now = Date.now(), onlineSeconds = 90): AiConnections {
  const connections = assembleLocationAiConnections(input, now, onlineSeconds);
  const sources: AiConnectionSource[] = connections
    .filter(c => c.kind !== "chatgpt_subscription" || input.chatGpt.enabled || input.chatGpt.hasCredential)
    .map(c => ({ kind: c.kind, label: c.label, scope: c.scope, ready: c.status === "ready", ...(c.status === "ready" ? {} : { detail: c.reason }) }));
  return { available: sources.some(s => s.ready), sources, connections };
}

/** Browser-safe view: never another person's id; `mine` tells the UI which Mac subscriptions belong to the viewer. */
export function toClientConnection(connection: AiConnection, viewerUserId: string | null) {
  const { ownerUserId, ...rest } = connection;
  return { ...rest, ...(connection.scope === "device" ? { mine: !!viewerUserId && ownerUserId === viewerUserId } : {}) };
}
export type AiClientConnection = ReturnType<typeof toClientConnection>;
