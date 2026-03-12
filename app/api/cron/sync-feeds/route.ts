import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { FeedService } from "@/lib/feed/feed-service";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const guard = new CronGuard('sync-feeds');

export async function GET(req: NextRequest) {
  const auth = verifyCronAuthorization(req);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(350, 6.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: 'locked' });
  }

  try {
    const companyId = req.nextUrl.searchParams.get('companyId');

    const where: any = { isActive: true };
    if (companyId) {
      where.companyId = companyId;
    }

    const feeds = await db.propertyFeed.findMany({ where });

    const results = [];

    for (const feed of feeds) {
      try {
        const result = await FeedService.syncFeed(feed.id);
        results.push({ feedId: feed.id, status: 'success', ...result });
      } catch (error: any) {
        results.push({
          feedId: feed.id,
          status: 'error',
          error: error?.message || 'Feed sync failed',
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Feed sync failed' }, { status: 500 });
  } finally {
    await guard.release();
  }
}
