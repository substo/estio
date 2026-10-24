import "server-only";
import { hasStudioSupabaseConfig } from "./config";
import { requestStudioRest, requestStudioRestAll } from "./rest-client";

export { queryPath, StudioRestError } from "./rest-client";

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
