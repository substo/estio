'use client';

import { useState, useTransition } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDistanceToNow } from 'date-fns';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { LeadScoreBadge } from '@/app/(main)/admin/contacts/_components/lead-score-badge';
import { LeadSourceBadge } from '@/app/(main)/admin/contacts/_components/lead-source-badge';
import { acceptProspect, rejectProspect, bulkAccept, bulkReject } from '../actions';
import { toast } from 'sonner';
import { Loader2, Check, X, ExternalLink, Home, UserCheck, Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';

export function ProspectInboxTable({ items, total, locationId }: { items: ProspectInboxRow[], total: number, locationId: string }) {
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
            const res = await acceptProspect(id);
            if (res.success) {
                toast.success('Prospect accepted and converted to Contact');
                setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            } else {
                toast.error(res.message);
            }
        });
    };

    const handleReject = (id: string) => {
        startTransition(async () => {
            const res = await rejectProspect(id);
            if (res.success) {
                toast.success('Prospect rejected');
                setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            } else {
                toast.error(res.message);
            }
        });
    };

    const handleBulkAccept = () => {
        if (selectedIds.size === 0) return;
        startTransition(async () => {
            const res = await bulkAccept(Array.from(selectedIds));
            if (res.success) {
                toast.success(`Accepted ${res.count} prospects`);
                setSelectedIds(new Set());
            } else {
                toast.error((res as any).message || 'Failed to accept prospects');
            }
        });
    };

    const handleBulkReject = () => {
        if (selectedIds.size === 0) return;
        startTransition(async () => {
            const res = await bulkReject(Array.from(selectedIds));
            if (res.success) {
                toast.success(`Rejected ${res.count} prospects`);
                setSelectedIds(new Set());
            } else {
                toast.error((res as any).message || 'Failed to reject prospects');
            }
        });
    };

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center border rounded-xl bg-card border-dashed">
                <div className="text-4xl mb-4">Inbox Zero 🎉</div>
                <h3 className="text-lg font-semibold">No prospects found</h3>
                <p className="text-muted-foreground mt-2 max-w-sm">
                    You've triaged all current leads or your filters are too restrictive.
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
                        <Check className="h-4 w-4 mr-2" /> Accept All
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleBulkReject} disabled={isPending}>
                        <X className="h-4 w-4 mr-2" /> Reject All
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
                            <TableHead>Prospect</TableHead>
                            <TableHead>Contact Info</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>AI Score</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => {
                            const isNew = item.status === 'new' || item.status === 'reviewing';
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
                                        <div className="flex items-center gap-2">
                                            {item.isAgency ? <Building2 className="w-4 h-4 text-blue-500" /> : <UserCheck className="w-4 h-4 text-green-500" />}
                                            <div className="font-medium">{item.name || 'Unknown Name'}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-sm">{item.email || '-'}</div>
                                        <div className="text-sm text-muted-foreground">{item.phone || '-'}</div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <LeadSourceBadge source={item.source} />
                                                {item.sourceUrl && (
                                                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                                                        <ExternalLink className="h-4 w-4" />
                                                    </a>
                                                )}
                                            </div>
                                            {item.scrapedListingsCount > 0 && (
                                                <Sheet>
                                                    <SheetTrigger asChild>
                                                        <Button variant="link" size="sm" className="h-auto p-0 justify-start text-xs flex items-center gap-1">
                                                            <Home className="w-3 h-3" /> {item.scrapedListingsCount} {item.scrapedListingsCount === 1 ? 'Listing' : 'Listings'}
                                                        </Button>
                                                    </SheetTrigger>
                                                    <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
                                                        <SheetHeader className="mb-4">
                                                            <SheetTitle>{item.name || 'Unknown'}&apos;s Listings</SheetTitle>
                                                            <SheetDescription>Preview of scraped listings associated with this prospect.</SheetDescription>
                                                        </SheetHeader>
                                                        <div className="space-y-4">
                                                            {item.scrapedListings.map(listing => (
                                                                <div key={listing.id} className="border rounded-md p-3 text-sm">
                                                                    <div className="font-medium line-clamp-2">{listing.title || 'Untitled'}</div>
                                                                    <div className="flex justify-between items-center mt-2">
                                                                        <Badge variant="outline">{listing.platform}</Badge>
                                                                        {listing.price && <div className="font-medium">€{listing.price.toLocaleString()}</div>}
                                                                    </div>
                                                                    <Button variant="secondary" size="sm" className="w-full mt-3" asChild>
                                                                        <a href={listing.url} target="_blank" rel="noreferrer">
                                                                            View on {listing.platform} <ExternalLink className="w-3 h-3 ml-1" />
                                                                        </a>
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </SheetContent>
                                                </Sheet>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <LeadScoreBadge score={item.aiScore || 0} />
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={
                                            item.status === 'accepted' ? 'default' :
                                            item.status === 'rejected' ? 'destructive' :
                                            'outline'
                                        }>
                                            {item.status.toUpperCase()}
                                        </Badge>
                                        {item.dedupStatus === 'duplicate' && (
                                            <Badge variant="secondary" className="ml-2 text-[10px]">DUPLICATE</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {isNew ? (
                                            <div className="flex justify-end gap-2">
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleAccept(item.id)} disabled={isPending}>
                                                    <Check className="h-4 w-4 text-green-600" />
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleReject(item.id)} disabled={isPending}>
                                                    <X className="h-4 w-4 text-red-600" />
                                                </Button>
                                            </div>
                                        ) : (
                                            item.status === 'accepted' && item.createdContactId ? (
                                                <Button size="sm" variant="outline" onClick={() => window.open(`/admin/contacts?contactId=${item.createdContactId}`, '_blank')}>
                                                    View Contact
                                                </Button>
                                            ) : null
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            
            <div className="text-sm text-muted-foreground text-center">
                Showing {items.length} of {total} prospects
            </div>
        </div>
    );
}
