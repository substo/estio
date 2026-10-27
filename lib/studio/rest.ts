import "server-only";
import { hasStudioSupabaseConfig } from "./config";
import { isStudioProviderUnavailable, requestStudioRest, requestStudioRestAll } from "./rest-client";

export { isStudioProviderUnavailable, queryPath, StudioRestError, studioProviderRestricted } from "./rest-client";

/**
 * Studio-side provisioning that may be skipped while the Studio database provider is
 * restricted: the caller has already authorized the Location, and Studio itself then
 * shows its unavailable state. Any other failure still throws.
 */
export async function unlessStudioUnavailable<T>(work: () => Promise<T>): Promise<T | undefined> {
  try { return await work(); }
  catch (error) { if (isStudioProviderUnavailable(error)) return undefined; throw error; }
}

function studioConfig() {
  if (!hasStudioSupabaseConfig()) throw new Error("Studio Supabase server credentials are not configured correctly.");
  return {
    projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(),
    serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim(),
  };
}

export function studioRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestStudioRest<T>(studioConfig(), path, init);
}

export function studioRestAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  return requestStudioRestAll<T>(studioConfig(),table,query);
}
