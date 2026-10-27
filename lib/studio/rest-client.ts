export interface StudioRestConfig {
  projectUrl: string;
  serviceRoleKey: string;
}

/** Error codes are safe to classify; database response text stays on the server. */
export class StudioRestError extends Error {
  constructor(public readonly status: number, public readonly code?: string, public readonly providerRestricted = false) {
    super(providerRestricted ? `Studio database provider is restricted (${status}).` : `Studio database request failed (${status}).`);
    this.name = "StudioRestError";
  }
}

/**
 * Only an explicit hosting-provider restriction counts: Supabase answers 402 with a
 * "restricted"/quota message when a project exceeds its plan, and 503 when it is paused.
 * Every other status, including plain 402/503s, stays an ordinary failure.
 */
export function isProviderRestrictionResponse(status: number, message: string) {
  return (status === 402 && /restricted|quota/i.test(message)) || (status === 503 && /paused/i.test(message));
}

export function isStudioProviderUnavailable(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; current = (current as { cause?: unknown }).cause, depth += 1) {
    if (current instanceof StudioRestError && current.providerRestricted) return true;
  }
  return false;
}

/**
 * While a project is restricted, every process stops calling it for a short window and
 * fails fast with the same error, so pages, the worker and device endpoints back off
 * together instead of spending more of the provider's quota.
 */
export const STUDIO_PROVIDER_BACKOFF_MS = 120_000;
const restrictedUntil = new Map<string, { until: number; status: number }>();

export function studioProviderRestricted(now = Date.now()) {
  for (const entry of restrictedUntil.values()) if (entry.until > now) return true;
  return false;
}

export function resetStudioProviderBackoff() { restrictedUntil.clear(); }

export const STUDIO_UNAVAILABLE_MESSAGE = "Studio is temporarily unavailable. Your CRM keeps working; try Studio again later.";

/** The one HTTP answer for Studio APIs while the provider is restricted: 503 + Retry-After, no retry storm. */
export function studioUnavailableResponse(body: Record<string, unknown> = { error: STUDIO_UNAVAILABLE_MESSAGE }) {
  return Response.json(body, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": String(STUDIO_PROVIDER_BACKOFF_MS / 1000) } });
}

export function queryPath(table: string, query: Record<string, string>) {
  return `${table}?${new URLSearchParams(query).toString()}`;
}

export async function requestStudioRestResult<T>(
  config: StudioRestConfig,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<{ data: T; headers: Headers }> {
  const base = config.projectUrl.endsWith("/") ? config.projectUrl : `${config.projectUrl}/`;
  const url = new URL(`rest/v1/${path.replace(/^\//, "")}`, base);
  const backoff = restrictedUntil.get(url.origin);
  if (backoff && backoff.until > Date.now()) throw new StudioRestError(backoff.status, undefined, true);
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  headers.set("Content-Type", "application/json");
  const response = await fetcher(url, {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers,
  });
  if (!response.ok) {
    let code: string | undefined;
    let message = "";
    try {
      const text = await response.text();
      message = text.slice(0, 2000);
      const body: unknown = JSON.parse(text);
      if (body && typeof body === "object" && "code" in body &&
          typeof body.code === "string" && /^[A-Z0-9]{5,12}$/.test(body.code)) code = body.code;
      if (body && typeof body === "object" && "message" in body && typeof body.message === "string") message = body.message;
    } catch { /* A proxy may return HTML or an empty body. */ }
    if (isProviderRestrictionResponse(response.status, message)) {
      if (!studioProviderRestricted()) {
        console.warn(JSON.stringify({ service: "studio-provider", event: "provider_restricted", status: response.status, backoffMs: STUDIO_PROVIDER_BACKOFF_MS }));
      }
      restrictedUntil.set(url.origin, { until: Date.now() + STUDIO_PROVIDER_BACKOFF_MS, status: response.status });
      throw new StudioRestError(response.status, code, true);
    }
    throw new StudioRestError(response.status, code);
  }
  if (response.status === 204) return { data: undefined as T, headers: response.headers };
  const payload = await response.text();
  return { data: payload ? JSON.parse(payload) as T : undefined as T, headers: response.headers };
}

export async function requestStudioRest<T>(config: StudioRestConfig, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  return (await requestStudioRestResult<T>(config, path, init, fetcher)).data;
}

/** Honor the server's row cap rather than assuming one response is complete. */
export async function requestStudioRestAll<T>(config: StudioRestConfig, table: string, query: Record<string, string>, fetcher: typeof fetch = fetch): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  do {
    const result = await requestStudioRestResult<T[]>(config, queryPath(table, {
      ...query, limit: "500", offset: String(rows.length),
    }), { headers: { Prefer: "count=exact" } }, fetcher);
    const range = result.headers.get("content-range");
    const match = range?.match(/^(?:\d+-\d+|\*)\/(\d+)$/);
    if (!match) throw new Error("Studio returned no reconciliation count.");
    const count = Number(match[1]);
    if (!Number.isSafeInteger(count) || count > 10_000) throw new Error("Studio list is too large; use a paginated view.");
    if (total !== null && total !== count) throw new Error("Studio list changed during loading. Try again.");
    total = count;
    if (!result.data.length && rows.length < total) throw new Error("Studio returned an incomplete list.");
    rows.push(...result.data);
  } while (rows.length < total);
  return rows;
}
