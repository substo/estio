export interface StudioRestConfig {
  projectUrl: string;
  serviceRoleKey: string;
}

/** Error codes are safe to classify; database response text stays on the server. */
export class StudioRestError extends Error {
  constructor(public readonly status: number, public readonly code?: string) {
    super(`Studio database request failed (${status}).`);
    this.name = "StudioRestError";
  }
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
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "code" in body &&
          typeof body.code === "string" && /^[A-Z0-9]{5,12}$/.test(body.code)) code = body.code;
    } catch { /* A proxy may return HTML or an empty body. */ }
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
