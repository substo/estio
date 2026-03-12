import { NextResponse } from "next/server.js";

export function verifyCronAuthorization(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "CRON_SECRET is not configured.",
        },
        { status: 500 }
      ),
    };
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}
