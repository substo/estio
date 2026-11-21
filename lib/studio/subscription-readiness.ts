import { usageSpec } from "../build/contract";

export const subscriptionProviders = ["codex", "claude"] as const;
type Provider = typeof subscriptionProviders[number];
export const subscriptionLogin = { codex: "chatgpt", claude: "claudeai" } as const;
export const usageBuckets = { codex: "codex", claude: "claudeAgent" } as const;
export const NATIVE_REJECTION_BACKOFF_MS = 5 * 60_000;

export function nativeSubscriptionReady(provider: Provider, report: { ready?: unknown; authenticated?: unknown; loginMethod?: unknown } | undefined) {
  return report?.ready === true && report.authenticated === true && report.loginMethod === subscriptionLogin[provider];
}

/** One fresh provider bucket. Omitted, expired and malformed readings leave allowance unknown. */
export function nativeAllowance(usage: unknown, provider: Provider, now = Date.now()) {
  if (!usage || typeof usage !== "object") return undefined;
  const bucket = usageBuckets[provider];
  const result = usageSpec.safeParse({ [bucket]: (usage as Record<string, unknown>)[bucket] });
  const value = result.success ? result.data[bucket] : undefined;
  if (!value) return undefined;
  const at = Date.parse(value.at);
  if (!(at <= now && now - at < 30 * 60_000)) return undefined;
  if (!value.windows.length) return value;
  const windows = value.windows.filter(window => !window.resetsAt || Date.parse(window.resetsAt) > now);
  return windows.length ? { ...value, windows, remaining: Math.min(...windows.map(window => window.remaining)) } : undefined;
}

export function hasNativeRejection(retryAt: unknown, now = Date.now()) {
  return typeof retryAt === "number" && retryAt > now && retryAt - now <= NATIVE_REJECTION_BACKOFF_MS;
}

export function nativeSubscriptionBlocked(usage: unknown, provider: Provider, retryAt?: unknown, now = Date.now()) {
  return hasNativeRejection(retryAt, now) || nativeAllowance(usage, provider, now)?.remaining === 0;
}

/** Legacy devices still enforce their own capacity bit. New devices advertise native eligibility on the same wire bit. */
export function reportedSubscriptionLimit(capabilities: Record<string, unknown>, provider: Provider, now = Date.now()) {
  const retryAt = (capabilities.nativeRetryAt as Partial<Record<Provider, unknown>> | undefined)?.[provider];
  return capabilities.nativeSubscriptionVersion === 1 && nativeSubscriptionBlocked(capabilities.usage, provider, retryAt, now);
}
