import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import db from '@/lib/db';
import { getLocationContext } from '@/lib/auth/location-context';
import { AiFeedMapper } from '@/lib/feed/ai-mapper';
import {
    FeedAnalysisGuardUnavailableError,
    FeedAnalysisInProgressError,
    FeedAnalysisRateLimitError,
    runFeedAnalysisGuarded,
} from '@/lib/feed/feed-analysis-guard';
import { analyzeFeedRequestSchema } from '@/lib/feed/feed-route-schemas';
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

    const validated = analyzeFeedRequestSchema.safeParse(body);
    if (!validated.success) {
        return NextResponse.json({ success: false, error: 'Valid URL and company ID are required.' }, { status: 400 });
    }

    try {
        const company = await db.company.findFirst({
            where: { id: validated.data.companyId, locationId: location.id },
            select: {
                location: {
                    select: {
                        siteConfig: {
                            select: { googleAiApiKey: true, googleAiModel: true },
                        },
                    },
                },
            },
        });

        if (!company) {
            return NextResponse.json({ success: false, error: 'Company not found or access denied.' }, { status: 404 });
        }

        const apiKey = company.location.siteConfig?.googleAiApiKey;
        const modelName = company.location.siteConfig?.googleAiModel || undefined;
        if (!apiKey) {
            return NextResponse.json({ success: false, error: 'Google AI API key is not configured.' }, { status: 400 });
        }

        const result = await runFeedAnalysisGuarded({
            locationId: location.id,
            companyId: validated.data.companyId,
            url: validated.data.url,
            execute: async () => {
                const text = await fetchSafeFeedText(validated.data.url);
                const snippet = text.slice(0, 50_000);
                const mapping = await AiFeedMapper.analyzeFeedStructure(snippet, apiKey, modelName);

                let discoverySnippet = text.slice(0, 500_000);
                const lastTagClose = discoverySnippet.lastIndexOf('>');
                if (lastTagClose > 0) discoverySnippet = discoverySnippet.slice(0, lastTagClose + 1);
                const paths = new GenericXmlParser().discoverPaths(discoverySnippet);

                return { mapping, snippet, paths };
            },
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('[analyzeFeed] Failed:', error);
        if (error instanceof FeedAnalysisRateLimitError) {
            return NextResponse.json(
                { success: false, error: 'Too many feed analysis requests. Please try again later.' },
                { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
            );
        }
        if (error instanceof FeedAnalysisInProgressError) {
            return NextResponse.json(
                { success: false, error: 'This feed is already being analyzed. Please try again shortly.' },
                { status: 409, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
            );
        }
        if (error instanceof FeedAnalysisGuardUnavailableError) {
            return NextResponse.json(
                { success: false, error: 'Feed analysis is temporarily unavailable.' },
                { status: 503, headers: { 'Retry-After': '5' } },
            );
        }
        if (error instanceof SafeFeedFetchError) {
            return NextResponse.json({ success: false, error: 'Feed URL is unsafe or unavailable.' }, { status: 400 });
        }
        return NextResponse.json({ success: false, error: 'Failed to analyze feed.' }, { status: 500 });
    }
}
