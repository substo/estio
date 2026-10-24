export function hasStudioSupabaseConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const serviceRoleKey = env.STUDIO_SUPABASE_SERVICE_ROLE_KEY?.trim();
  const rawUrl = env.STUDIO_SUPABASE_URL?.trim();
  if (!serviceRoleKey || !rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" || (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}
