
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { FeedService } from "@/lib/feed/feed-service";

export const dynamic = 'force-dynamic'; // No caching
export const maxDuration = 300; // 5 minutes timeout

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const companyId = searchParams.get('companyId');

        // 1. Find all active feeds, optionally filtered by company
        const where: any = { isActive: true };
        if (companyId) {
            where.companyId = companyId;
        }

        const feeds = await db.propertyFeed.findMany({
            where
        });

        const results = [];

        // 2. Sync loop
        for (const feed of feeds) {
            try {
                const result = await FeedService.syncFeed(feed.id);
                results.push({ feedId: feed.id, status: 'success', ...result });
            } catch (error: any) {
                console.error(`Error syncing feed ${feed.id}:`, error);
                results.push({ feedId: feed.id, status: 'error', error: error.message });
            }
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
