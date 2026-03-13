import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Deprecated endpoint.
 *
 * This route is intentionally retired in favor of the centralized
 * runtime cron pipeline (`/api/cron/ai-runtime`).
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: 'Deprecated endpoint. Use /api/cron/ai-runtime for AI runtime jobs.',
      code: 'AGENT_RUN_DEPRECATED',
    },
    { status: 410 }
  );
}
