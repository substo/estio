import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { getLocationContext } from '@/lib/auth/location-context';
import {
    listFeedInboxFeedOptions,
    listFeedInboxProperties,
    type FeedInboxMissingFilter,
    type FeedInboxScope,
} from '@/lib/properties/feed-inbox-repository';
import { FeedInboxFilters } from './_components/feed-inbox-filters';
import { FeedInboxTable } from './_components/feed-inbox-table';

export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const FEED_INBOX_SCOPES: FeedInboxScope[] = ['needs-review', 'all-feed'];
const FEED_INBOX_MISSING: FeedInboxMissingFilter[] = [
    'all',
    'any_critical',
    'no_price',
    'no_description',
    'no_location',
    'no_images',
];

function isScope(value: string): value is FeedInboxScope {
    return FEED_INBOX_SCOPES.includes(value as FeedInboxScope);
}

function isMissingFilter(value: string): value is FeedInboxMissingFilter {
    return FEED_INBOX_MISSING.includes(value as FeedInboxMissingFilter);
}

export default async function FeedInboxPage(props: PageProps) {
    const searchParams = await props.searchParams;
    const location = await getLocationContext();

    if (!location) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-semibold text-red-600">Authentication Error</h2>
                <p className="mt-2 text-gray-600">
                    Could not determine your location context. Please try signing out and back in.
                </p>
            </div>
        );
    }

    const limit = 25;
    const skip = typeof searchParams.skip === 'string' ? parseInt(searchParams.skip) || 0 : 0;
    const q = typeof searchParams.q === 'string' ? searchParams.q : undefined;
    const feedId = typeof searchParams.feedId === 'string' ? searchParams.feedId : undefined;
    const status = typeof searchParams.status === 'string' ? searchParams.status : undefined;
    const publicationStatus = typeof searchParams.publicationStatus === 'string'
        ? searchParams.publicationStatus
        : undefined;
    const rawScope = typeof searchParams.scope === 'string' ? searchParams.scope : undefined;
    const scope = rawScope && isScope(rawScope) ? rawScope : 'needs-review';
    const rawMissing = typeof searchParams.missing === 'string' ? searchParams.missing : undefined;
    const missing = rawMissing && isMissingFilter(rawMissing) ? rawMissing : 'all';

    const [result, feeds] = await Promise.all([
        listFeedInboxProperties(location.id, {
            limit,
            skip,
            q,
            feedId,
            status,
            publicationStatus,
            scope,
            missing,
        }),
        listFeedInboxFeedOptions(location.id),
    ]);

    return (
        <div className="container mx-auto py-8 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Feed Inbox</h1>
                    <p className="text-muted-foreground mt-1">
                        Review and triage XML feed listings before publishing.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/admin/properties">
                        <Button variant="outline">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Properties
                        </Button>
                    </Link>
                    <Link href="/admin/properties/feed-inbox">
                        <Button variant="outline">
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reset Queue
                        </Button>
                    </Link>
                </div>
            </div>

            <FeedInboxFilters feeds={feeds} />

            <FeedInboxTable
                items={result.items}
                total={result.total}
                limit={limit}
                skip={skip}
                locationId={location.id}
            />
        </div>
    );
}
