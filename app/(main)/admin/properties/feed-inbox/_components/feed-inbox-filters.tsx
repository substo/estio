'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import type { FeedInboxFeedOption } from '@/lib/properties/feed-inbox-repository';

interface FeedInboxFiltersProps {
    feeds: FeedInboxFeedOption[];
}

const SCOPE_OPTIONS = [
    { value: 'needs-review', label: 'Needs Review' },
    { value: 'all-feed', label: 'All Feed Listings' },
];

const MISSING_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'any_critical', label: 'Any Critical Field' },
    { value: 'no_price', label: 'No Price' },
    { value: 'no_description', label: 'No Description' },
    { value: 'no_location', label: 'No Location' },
    { value: 'no_images', label: 'No Images' },
];

const STATUS_OPTIONS = ['Active', 'Reserved', 'Sold', 'Rented', 'Withdrawn'];
const PUBLICATION_OPTIONS = ['Published', 'Pending', 'Draft', 'Unlisted'];

function shortFeedLabel(feed: FeedInboxFeedOption) {
    try {
        const url = new URL(feed.url);
        return `${feed.companyName} - ${url.hostname}`;
    } catch {
        return `${feed.companyName} - Feed`;
    }
}

export function FeedInboxFilters({ feeds }: FeedInboxFiltersProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [search, setSearch] = useState(searchParams.get('q') || '');

    const createQueryString = useCallback(
        (name: string, value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            if (!value || value === 'all') {
                params.delete(name);
            } else {
                params.set(name, value);
            }
            params.delete('skip');
            return params.toString();
        },
        [searchParams]
    );

    const handleFilterChange = (name: string, value: string) => {
        router.push(`?${createQueryString(name, value)}`);
    };

    const scope = searchParams.get('scope') || 'needs-review';
    const isNeedsReview = scope === 'needs-review';

    const handleScopeChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('scope', value);
        params.delete('skip');

        // "Needs Review" is driven by pending status. Clear manual publication filter noise.
        if (value === 'needs-review') {
            params.delete('publicationStatus');
        }

        router.push(`?${params.toString()}`);
    };

    const handleSearch = () => {
        const params = new URLSearchParams(searchParams.toString());
        if (search) params.set('q', search);
        else params.delete('q');
        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    const handleReset = () => {
        setSearch('');
        router.push(pathname);
    };

    return (
        <Card className="mb-6">
            <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                    <div className="xl:col-span-2 space-y-2">
                        <label className="text-sm font-medium">Search</label>
                        <div className="flex gap-2">
                            <Input
                                placeholder="Title, slug, ref, external ID"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <Button variant="outline" onClick={handleSearch}>Search</Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Queue</label>
                        <Select value={scope} onValueChange={handleScopeChange}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SCOPE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Feed</label>
                        <Select
                            value={searchParams.get('feedId') || 'all'}
                            onValueChange={(val) => handleFilterChange('feedId', val)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="All feeds" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All feeds</SelectItem>
                                {feeds.map((feed) => (
                                    <SelectItem key={feed.id} value={feed.id}>
                                        {shortFeedLabel(feed)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Missing Fields</label>
                        <Select
                            value={searchParams.get('missing') || 'all'}
                            onValueChange={(val) => handleFilterChange('missing', val)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MISSING_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Listing Status</label>
                        <Select
                            value={searchParams.get('status') || 'all'}
                            onValueChange={(val) => handleFilterChange('status', val)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="All statuses" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                {STATUS_OPTIONS.map((status) => (
                                    <SelectItem key={status} value={status}>{status}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Publication</label>
                        <Select
                            value={searchParams.get('publicationStatus') || 'all'}
                            onValueChange={(val) => handleFilterChange('publicationStatus', val)}
                            disabled={isNeedsReview}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={isNeedsReview ? 'Pending (from Queue)' : 'Any'} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Any</SelectItem>
                                {PUBLICATION_OPTIONS.map((status) => (
                                    <SelectItem key={status} value={status}>{status}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={handleReset}>
                        Reset
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
