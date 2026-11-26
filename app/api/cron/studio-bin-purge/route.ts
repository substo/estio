import { verifyCronAuthorization } from "@/lib/cron/auth";
import { hasStudioDatabaseConfig } from "@/lib/studio/config";
import { studioDb } from "@/lib/studio/studio-db";
import { createStudioR2Store, readStudioR2Config } from "@/lib/studio/media-r2";
import { runStudioBinPurge } from "@/lib/studio/bin-purge";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly: permanently remove Studio items that have been in the bin for 30 days (stored files first, then rows). */
export async function GET(request: Request) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;
  if (!hasStudioDatabaseConfig()) return Response.json({ skipped: true, reason: "Studio is not configured." }, { headers: { "Cache-Control": "no-store" } });
  const config = readStudioR2Config();
  if (!config) return Response.json({ skipped: true, reason: "Media storage is not configured." }, { headers: { "Cache-Control": "no-store" } });
  try {
    const result = await runStudioBinPurge({ db: studioDb, store: createStudioR2Store(config), log: message => console.error(`[studio-bin] ${message}`) });
    return Response.json(result, { status: result.failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Studio bin purge could not run." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
