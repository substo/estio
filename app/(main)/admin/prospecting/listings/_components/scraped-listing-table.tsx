'use client';

import { useState, useTransition } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDistanceToNow } from 'date-fns';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { LeadSourceBadge } from '@/app/(main)/admin/contacts/_components/lead-source-badge';
import { toast } from 'sonner';
import { Loader2, Check, ExternalLink, X, Building2, UserCheck, PhoneCall } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { acceptScrapedListing, rejectScrapedListing, bulkAcceptListings, bulkRejectListings } from '../actions';
import Link from 'next/link';

export function ScrapedListingTable({ items, total, locationId }: { items: ScrapedListingRow[], total: number, locationId: string }) {
    const router = useRouter();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isPending, startTransition] = useTransition();

    const toggleAll = () => {
        if (selectedIds.size === items.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(items.map(i => i.id)));
        }
    };

    const toggleOne = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleAccept = (id: string) => {
        startTransition(async () => {
            const res = await acceptScrapedListing(id);
            if (res.success) {
                toast.success('Listing Accepted');
                setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            } else {
                toast.error(res.message);
            }
        });
    };

    const handleReject = (id: string) => {
        startTransition(async () => {
            const res = await rejectScrapedListing(id);
            if (res.success) {
                toast.success('Listing rejected');
                setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            } else {
                toast.error(res.message);
            }
        });
    };

    const handleBulkAccept = () => {
        if (selectedIds.size === 0) return;
        startTransition(async () => {
            const res = await bulkAcceptListings(Array.from(selectedIds));
            if (res.success) {
                toast.success(`Accepted ${res.count} listings`);
                setSelectedIds(new Set());
            } else {
                toast.error((res as any).message || 'Failed to accept listings');
            }
        });
    };

    const handleBulkReject = () => {
        if (selectedIds.size === 0) return;
        startTransition(async () => {
            const res = await bulkRejectListings(Array.from(selectedIds));
            if (res.success) {
                toast.success(`Rejected ${res.count} listings`);
                setSelectedIds(new Set());
            } else {
                toast.error((res as any).message || 'Failed to reject listings');
            }
        });
    };

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center border rounded-xl bg-card border-dashed">
                <div className="text-4xl mb-4">Inbox Zero 🎉</div>
                <h3 className="text-lg font-semibold">No listings found</h3>
                <p className="text-muted-foreground mt-2 max-w-sm">
                    You've triaged all current listings or your filters are too restrictive.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {selectedIds.size > 0 && (
                <div className="flex items-center gap-4 p-3 bg-muted/40 rounded-lg border">
                    <div className="text-sm font-medium">{selectedIds.size} selected</div>
                    <Button size="sm" variant="default" onClick={handleBulkAccept} disabled={isPending}>
                        <Check className="h-4 w-4 mr-2" /> Mark Accepted
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleBulkReject} disabled={isPending}>
                        <X className="h-4 w-4 mr-2" /> Mark Rejected
                    </Button>
                </div>
            )}

            <div className="rounded-xl border bg-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px] text-center">
                                <Checkbox 
                                    checked={items.length > 0 && selectedIds.size === items.length}
                                    onCheckedChange={toggleAll}
                                />
                            </TableHead>
                            <TableHead>Listing</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Poster / Source</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => {
                            const isNew = item.status === 'NEW' || item.status === 'REVIEWING' || item.status === 'new';
                            return (
                                <TableRow key={item.id} className={isPending && selectedIds.has(item.id) ? 'opacity-50' : ''}>
                                    <TableCell className="text-center">
                                        <Checkbox 
                                            checked={selectedIds.has(item.id)}
                                            onCheckedChange={() => toggleOne(item.id)}
                                            disabled={!isNew || isPending}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            {item.images?.[0] ? (
                                                <img src={item.images[0]} alt="Property" className="w-12 h-12 rounded object-cover" />
                                            ) : (
                                                <div className="w-12 h-12 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">No img</div>
                                            )}
                                            <div>
                                                <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:underline flex items-center gap-1 line-clamp-1">
                                                    {item.title || 'Untitled Listing'}
                                                </a>
                                                <div className="text-xs text-muted-foreground">
                                                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                                </div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-sm">{item.locationText || '-'}</div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-semibold">{item.price ? `€${item.price.toLocaleString()}` : 'POA'}</div>
                                        <div className="text-xs text-muted-foreground">{item.propertyType || 'Unknown'}</div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1 items-start">
                                            {item.prospectLeadId ? (
                                                <div className="flex items-center gap-1">
                                                    {item.prospectAgency ? <Building2 className="w-3 h-3 text-blue-500" /> : <UserCheck className="w-3 h-3 text-green-500" />}
                                                    <Link href={`/admin/prospecting/people?q=${item.prospectName}`} className="text-sm font-medium hover:underline">
                                                        {item.prospectName || 'Unknown Prospect'}
                                                    </Link>
                                                </div>
                                            ) : (
                                                <span className="text-sm text-muted-foreground">Unlinked</span>
                                            )}
                                            <Badge variant="outline" className="text-[10px] mt-1">{item.platform}</Badge>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={
                                            item.status === 'ACCEPTED' ? 'default' :
                                            item.status === 'REJECTED' ? 'destructive' :
                                            'outline'
                                        }>
                                            {item.status.toUpperCase()}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {isNew ? (
                                            <div className="flex justify-end gap-2">
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Accept" onClick={() => handleAccept(item.id)} disabled={isPending}>
                                                    <Check className="h-4 w-4 text-green-600" />
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Reject" onClick={() => handleReject(item.id)} disabled={isPending}>
                                                    <X className="h-4 w-4 text-red-600" />
                                                </Button>
                                            </div>
                                        ) : (
                                             <Button size="sm" variant="ghost" className="h-8 w-8 p-0" asChild title="View Market listing">
                                                 <a href={item.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 text-muted-foreground"/></a>
                                             </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            
            <div className="text-sm text-muted-foreground text-center">
                Showing {items.length} of {total} listings
            </div>
        </div>
    );
}
