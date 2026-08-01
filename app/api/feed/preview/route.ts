import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import db from '@/lib/db';
import { getLocationContext } from '@/lib/auth/location-context';
import type { FeedMappingConfig } from '@/lib/feed/ai-mapper';
import { previewFeedRequestSchema } from '@/lib/feed/feed-route-schemas';
import { GenericXmlParser } from '@/lib/feed/parsers/generic-xml-parser';
import { fetchSafeFeedText, SafeFeedFetchError } from '@/lib/feed/safe-feed-fetch';

export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    const location = await getLocationContext();
    if (!location) {
        return NextResponse.json({ success: false, error: 'Active location unavailable.' }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const validated = previewFeedRequestSchema.safeParse(body);
    if (!validated.success) {
        return NextResponse.json({ success: false, error: 'Valid feed preview data is required.' }, { status: 400 });
    }

    try {
        const company = await db.company.findFirst({
            where: { id: validated.data.companyId, locationId: location.id },
            select: { id: true },
        });
        if (!company) {
            return NextResponse.json({ success: false, error: 'Company not found or access denied.' }, { status: 404 });
        }

        const text = await fetchSafeFeedText(validated.data.url);
        const parser = new GenericXmlParser(validated.data.mappingConfig as FeedMappingConfig);
        const items = await parser.parse(text);
        return NextResponse.json({ success: true, items: items.slice(0, 5) });
    } catch (error) {
        console.error('[previewFeed] Failed:', error);
        if (error instanceof SafeFeedFetchError) {
            return NextResponse.json({ success: false, error: 'Feed URL is unsafe or unavailable.' }, { status: 400 });
        }
        return NextResponse.json({ success: false, error: 'Failed to preview feed.' }, { status: 500 });
    }
}
