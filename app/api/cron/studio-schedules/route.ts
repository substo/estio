import { verifyCronAuthorization } from "@/lib/cron/auth";
import { hasStudioDatabaseConfig } from "@/lib/studio/config";
import { studioDb } from "@/lib/studio/studio-db";
import { dispatchDueStudioSchedules } from "@/lib/studio/schedule-dispatcher";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;
  if (!hasStudioDatabaseConfig()) return Response.json({ skipped: true, reason: "Studio is not configured." }, { headers: { "Cache-Control": "no-store" } });
  try {
    await studioDb.call("studio_prune_youtube_schedule_authorizations");
    const result = await dispatchDueStudioSchedules({ db: studioDb });
    return Response.json(result, { status: result.outcomes.unconfirmed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Studio schedule dispatch could not be confirmed." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
