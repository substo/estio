import type { UserRole } from "@prisma/client";

export const MAX_MONTHLY_BUDGET_USD = 100_000;

/** Substo owner/admin, or an Estio location ADMIN. Impersonation is checked separately. */
export function canManageStudioAi(access: { brand: "estio"; role: UserRole } | { brand: "substo"; role: "owner" | "admin" | "member" }) {
  return access.brand === "substo" ? access.role === "owner" || access.role === "admin" : access.role === "ADMIN";
}

/** OpenAI secret keys (project, service-account, or legacy user keys). */
export function readOpenAiKey(value: FormDataEntryValue | null): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new Error("Enter an OpenAI secret key that starts with sk-.");
  return key;
}
export const keyHint = (key: string) => key.slice(-4);

/** Dollars with up to two decimals → integer micro-USD. Zero disables hosted AI. */
export function readMonthlyBudget(value: FormDataEntryValue | null): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) throw new Error("Enter a monthly budget in US dollars, for example 25 or 25.50.");
  const [whole, cents = ""] = text.split(".");
  const micros = Number(whole) * 1_000_000 + Number(cents.padEnd(2, "0")) * 10_000;
  if (micros > MAX_MONTHLY_BUDGET_USD * 1_000_000) throw new Error(`The monthly budget can be at most $${MAX_MONTHLY_BUDGET_USD.toLocaleString("en-US")}.`);
  return micros;
}
export const formatUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** Confirm the key with a free read-only call before storing it. */
export async function verifyOpenAiKey(key: string, fetcher: typeof fetch = fetch): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    const response = await fetcher("https://api.openai.com/v1/models?limit=1", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.ok) return "valid";
    return response.status === 401 || response.status === 403 ? "invalid" : "unavailable";
  } catch { return "unavailable"; }
}
