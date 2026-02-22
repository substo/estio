'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { bulkUpdateFeedInboxPropertiesAction } from '@/app/(main)/admin/properties/actions';
import type { FeedInboxPropertyRow } from '@/lib/properties/feed-inbox-repository';

interface FeedInboxTableProps {
    items: FeedInboxPropertyRow[];
    total: number;
    limit: number;
    skip: number;
    locationId: string;
}

function formatCurrency(amount: number | null, currency: string | null) {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'EUR',
        maximumFractionDigits: 0,
    }).format(amount);
}

function getStatusColor(status: string) {
    switch (status) {
        case 'ACTIVE':
            return 'bg-green-100 text-green-800';
        case 'RESERVED':
            return 'bg-yellow-100 text-yellow-800';
        case 'SOLD':
            return 'bg-blue-100 text-blue-800';
        case 'RENTED':
            return 'bg-purple-100 text-purple-800';
        case 'WITHDRAWN':
            return 'bg-gray-100 text-gray-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
}

function getPublicationColor(status: string) {
    switch (status) {
        case 'PUBLISHED':
            return 'bg-green-50 text-green-700 border-green-200';
        case 'PENDING':
            return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'DRAFT':
            return 'bg-slate-50 text-slate-700 border-slate-200';
        case 'UNLISTED':
            return 'bg-gray-50 text-gray-700 border-gray-200';
        default:
            return 'bg-slate-50 text-slate-700 border-slate-200';
    }
}

function getSyncStatusMeta(status: string | null) {
    switch ((status || '').toUpperCase()) {
        case 'CREATED':
            return { label: 'Created', className: 'bg-blue-50 text-blue-700 border-blue-200' };
        case 'UPDATED':
            return { label: 'Updated', className: 'bg-amber-50 text-amber-700 border-amber-200' };
        case 'UNCHANGED':
            return { label: 'Unchanged', className: 'bg-slate-50 text-slate-700 border-slate-200' };
        default:
            return { label: status || '-', className: 'bg-slate-50 text-slate-700 border-slate-200' };
    }
}

function shortFeedName(row: FeedInboxPropertyRow) {
    if (!row.feedUrl) return row.feedCompanyName || 'Unknown feed';
    try {
        const url = new URL(row.feedUrl);
        return `${row.feedCompanyName || 'Feed'} • ${url.hostname}`;
    } catch {
        return row.feedCompanyName || row.feedUrl;
    }
}

function missingBadges(row: FeedInboxPropertyRow) {
    const badges: string[] = [];
    if (!row.price) badges.push('No price');
    if (!row.propertyLocation) badges.push('No location');
    if (row.imageCount === 0) badges.push('No images');
    return badges;
}

export function FeedInboxTable({
    items,
    total,
    limit,
    skip,
    locationId,
}: FeedInboxTableProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        setSelectedIds(new Set());
    }, [items]);

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(skip / limit) + 1;

    const allSelected = items.length > 0 && selectedIds.size === items.length;
    const partiallySelected = selectedIds.size > 0 && selectedIds.size < items.length;

    const selectedCount = selectedIds.size;

    const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('skip', ((newPage - 1) * limit).toString());
        router.push(`?${params.toString()}`);
    };

    const toggleRow = (id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const toggleAll = (checked: boolean) => {
        if (!checked) {
            setSelectedIds(new Set());
            return;
        }
        setSelectedIds(new Set(items.map((item) => item.id)));
    };

    const runBulkAction = (action: 'publish' | 'draft' | 'pending' | 'withdraw', ids = selectedArray) => {
        if (ids.length === 0) return;

        startTransition(async () => {
            try {
                const result = await bulkUpdateFeedInboxPropertiesAction({
                    propertyIds: ids,
                    locationId,
                    action,
                });

                const verb =
                    action === 'publish' ? 'published' :
                    action === 'draft' ? 'moved to draft' :
                    action === 'pending' ? 'moved to pending' :
                    'withdrawn';

                toast.success(`${result.updatedCount} ${result.updatedCount === 1 ? 'property' : 'properties'} ${verb}.`);
                setSelectedIds(new Set());
                router.refresh();
            } catch (error) {
                console.error('Feed inbox bulk action failed:', error);
                toast.error('Failed to update selected properties.');
            }
        });
    };

    if (items.length === 0) {
        return (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">No feed properties found</h3>
                <p className="mt-1 text-sm text-gray-500">
                    Try adjusting queue, feed, or missing-field filters.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-md border bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                        {selectedCount > 0 ? `${selectedCount} selected` : `${total} total matching feed properties`}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={selectedCount === 0 || isPending}
                            onClick={() => runBulkAction('draft')}
                        >
                            Publish as Draft
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={selectedCount === 0 || isPending}
                            onClick={() => runBulkAction('pending')}
                        >
                            Mark Pending
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={selectedCount === 0 || isPending}
                            onClick={() => runBulkAction('withdraw')}
                        >
                            Withdraw
                        </Button>
                        <Button
                            size="sm"
                            disabled={selectedCount === 0 || isPending}
                            onClick={() => runBulkAction('publish')}
                        >
                            Publish Selected
                        </Button>
                    </div>
                </div>
            </div>

            <div className="rounded-md border bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[48px]">
                                <Checkbox
                                    id="select-all-feed-inbox"
                                    checked={allSelected || (partiallySelected ? 'indeterminate' : false)}
                                    onCheckedChange={(checked) => toggleAll(checked === true)}
                                />
                            </TableHead>
                            <TableHead className="min-w-[220px]">Feed</TableHead>
                            <TableHead className="hidden xl:table-cell">External ID</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead className="hidden lg:table-cell">Missing</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Publication</TableHead>
                            <TableHead className="hidden lg:table-cell">Sync</TableHead>
                            <TableHead className="hidden md:table-cell">Price</TableHead>
                            <TableHead className="hidden md:table-cell">Images</TableHead>
                            <TableHead className="hidden xl:table-cell">Last Seen</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((row) => {
                            const missing = missingBadges(row);
                            const rowSelected = selectedIds.has(row.id);

                            return (
                                <TableRow
                                    key={row.id}
                                    className="hover:bg-muted/40"
                                >
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                        <Checkbox
                                            checked={rowSelected}
                                            onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="max-w-[220px]">
                                            <div className="truncate font-medium" title={row.feedUrl || undefined}>
                                                {shortFeedName(row)}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {row.feedUrl || 'No feed URL'}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden xl:table-cell">
                                        <div className="font-mono text-xs truncate max-w-[180px]" title={row.feedReferenceId || undefined}>
                                            {row.feedReferenceId || '-'}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="max-w-[220px]">
                                            <div className="truncate font-medium" title={row.title}>
                                                {row.title}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {row.reference || row.slug}
                                            </div>
                                            {missing.length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-1 lg:hidden">
                                                    {missing.slice(0, 2).map((tag) => (
                                                        <Badge key={tag} variant="outline" className="text-[10px]">
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">
                                        {missing.length === 0 ? (
                                            <span className="text-xs text-muted-foreground">Complete</span>
                                        ) : (
                                            <div className="flex flex-wrap gap-1 max-w-[180px]">
                                                {missing.map((tag) => (
                                                    <Badge key={tag} variant="outline" className="text-[10px]">
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className={getStatusColor(row.status)}>
                                            {row.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={getPublicationColor(row.publicationStatus)}>
                                            {row.publicationStatus}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">
                                        <Badge variant="outline" className={getSyncStatusMeta(row.feedSyncStatus).className}>
                                            {getSyncStatusMeta(row.feedSyncStatus).label}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        {formatCurrency(row.price, row.currency)}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <span className={row.imageCount === 0 ? 'text-amber-700 font-medium' : ''}>
                                            {row.imageCount}
                                        </span>
                                    </TableCell>
                                    <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                                        {row.feedLastSeenAt
                                            ? new Date(row.feedLastSeenAt).toLocaleString()
                                            : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={isPending}
                                                onClick={() => runBulkAction('publish', [row.id])}
                                            >
                                                Publish
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-600 hover:text-red-700"
                                                disabled={isPending}
                                                onClick={() => runBulkAction('withdraw', [row.id])}
                                            >
                                                Withdraw
                                            </Button>
                                            <Button variant="ghost" size="icon" asChild>
                                                <Link href={`/admin/properties/${row.id}/view`} title="Open property">
                                                    <ExternalLink className="h-4 w-4" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between px-2">
                    <div className="text-sm text-gray-500">
                        Showing {skip + 1} to {Math.min(skip + limit, total)} of {total} results
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage <= 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                        </Button>
                        <div className="text-sm font-medium">
                            Page {currentPage} of {totalPages}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage >= totalPages}
                        >
                            Next
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
