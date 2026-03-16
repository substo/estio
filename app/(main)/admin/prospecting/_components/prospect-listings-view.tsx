'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { acceptScrapedListing, rejectScrapedListing, bulkAcceptListings, bulkRejectListings } from '../actions';
import { toast } from 'sonner';
import { Check, X, ExternalLink, RefreshCw, Home, Building2, UserCheck, PhoneCall, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProspectReviewDrawer } from './prospect-review-drawer';
import { ScrapeListingDialog } from './scrape-listing-dialog';
import { LeadScoreBadge } from '@/app/(main)/admin/contacts/_components/lead-score-badge';
import { LeadSourceBadge } from '@/app/(main)/admin/contacts/_components/lead-source-badge';
import { cn } from '@/lib/utils';

export function ProspectListingsView({
    prospect,
    listings,
    total,
    locationId
}: {
    prospect?: ProspectInboxRow;
    listings: ScrapedListingRow[];
    total: number;
    locationId: string;
}) {
    const router = useRouter();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isPending, startTransition] = useTransition();
    const [reviewListing, setReviewListing] = useState<ScrapedListingRow | null>(null);
    const [scrapeListing, setScrapeListing] = useState<ScrapedListingRow | null>(null);

    const toggleAll = () => {
        if (selectedIds.size === listings.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(listings.map(i => i.id)));
        }
    };

    const toggleOne = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleAccept = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
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

    const handleReject = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
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

    return (
        <div className="flex flex-col h-full bg-slate-50/30 dark:bg-slate-900/10">
            {/* Header: Prospect Detail or All Listings */}
            {prospect ? (
                <div className="p-6 border-b bg-background shrink-0">
                    <div className="flex items-start justify-between gap-6">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2.5 bg-primary/10 rounded-lg text-primary">
                                    {prospect.isAgency ? <Building2 className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold tracking-tight">{prospect.name || 'Unknown Prospect'}</h2>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                                        <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded cursor-pointer hover:bg-muted transition-colors hover:text-foreground">
                                            <PhoneCall className="w-3.5 h-3.5" />
                                            <span>{prospect.phone || 'No phone'}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded cursor-pointer hover:bg-muted transition-colors hover:text-foreground">
                                            <Mail className="w-3.5 h-3.5" />
                                            <span>{prospect.email || 'No email'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex flex-col items-end gap-3 shrink-0">
                            <div className="flex items-center gap-3">
                                <LeadSourceBadge source={prospect.source} />
                                <LeadScoreBadge score={prospect.aiScore || 0} />
                                <Badge variant={
                                    prospect.status === 'accepted' ? 'default' :
                                    prospect.status === 'rejected' ? 'destructive' : 'outline'
                                }>
                                    {prospect.status.toUpperCase()}
                                </Badge>
                            </div>
                            {prospect.createdContactId && prospect.status === 'accepted' && (
                                <Button size="sm" variant="outline" onClick={() => window.open(`/admin/contacts?contactId=${prospect.createdContactId}`, '_blank')}>
                                    View Full Contact Profile
                                </Button>
                            )}
                            {prospect.sourceUrl && (
                                 <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1.5">
                                    <ExternalLink className="h-3.5 w-3.5" /> View Original Profile
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="p-4 border-b bg-background shrink-0">
                    <h2 className="text-lg font-bold tracking-tight">Listings Inbox</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">All new listings from scheduled scrapes. Select a prospect on the left to filter.</p>
                </div>
            )}

            {/* Listings Section Header & Toolbar */}
            <div className="p-4 border-b bg-muted/10 shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-medium">{prospect ? `Associated Listings (${total})` : `All Listings (${total})`}</h3>
                </div>
                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground font-medium">{selectedIds.size} selected</span>
                        <Button size="sm" variant="outline" className="border-green-200 hover:bg-green-50 text-green-700 dark:border-green-900/50 dark:hover:bg-green-950/30" onClick={handleBulkAccept} disabled={isPending}>
                            <Check className="h-4 w-4 mr-1.5" /> Accept
                        </Button>
                        <Button size="sm" variant="outline" className="border-red-200 hover:bg-red-50 text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30" onClick={handleBulkReject} disabled={isPending}>
                            <X className="h-4 w-4 mr-1.5" /> Reject
                        </Button>
                    </div>
                )}
            </div>

            {/* Listings Table/Grid Area */}
            <ScrollArea className="flex-1">
                {listings.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground">
                        <Home className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <h4 className="text-lg font-medium text-foreground mb-1">No Listings Found</h4>
                        <p className="text-sm">{prospect ? "We haven't scraped any specific property listings for this prospect yet." : "No new listings from scheduled scrapes. Try running a scrape task."}</p>
                    </div>
                ) : (
                    <div className="p-4">
                        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
                            <Table>
                                <TableHeader className="bg-muted/30">
                                    <TableRow>
                                        <TableHead className="w-[40px] text-center px-4">
                                            <Checkbox checked={listings.length > 0 && selectedIds.size === listings.length} onCheckedChange={toggleAll} />
                                        </TableHead>
                                        <TableHead>Property</TableHead>
                                        <TableHead>Details</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {listings.map((item) => {
                                        const isNew = item.status === 'NEW' || item.status === 'REVIEWING' || item.status === 'new';
                                        return (
                                            <TableRow 
                                                key={item.id} 
                                                className={cn(
                                                    "cursor-pointer transition-colors hover:bg-muted/40",
                                                    isPending && selectedIds.has(item.id) && "opacity-50",
                                                    selectedIds.has(item.id) && "bg-muted/30"
                                                )}
                                                onClick={() => setReviewListing(item)}
                                            >
                                                <TableCell className="text-center px-4" onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox 
                                                        checked={selectedIds.has(item.id)}
                                                        onCheckedChange={() => toggleOne(item.id)}
                                                        disabled={!isNew || isPending}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        {item.thumbnails?.[0] || item.images?.[0] ? (
                                                            <div className="relative w-14 h-14 rounded-md overflow-hidden shrink-0 border bg-muted">
                                                                <img src={item.thumbnails?.[0] || item.images?.[0]} alt="Property" className="w-full h-full object-cover" />
                                                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1 pt-4 text-[9px] text-white font-medium truncate text-center">
                                                                    {item.platform}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="w-14 h-14 bg-muted rounded-md flex flex-col items-center justify-center text-[10px] text-muted-foreground border shrink-0">
                                                                <Home className="w-4 h-4 mb-0.5 opacity-50" />
                                                                {item.platform}
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="font-semibold line-clamp-1 group-hover:underline">{item.title || 'Untitled Listing'}</div>
                                                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.locationText || 'No location info'}</div>
                                                            <div className="text-[10px] text-muted-foreground mt-1 bg-muted inline-flex px-1.5 py-0.5 rounded">
                                                                Added {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-bold text-[15px]">{item.price ? `${item.currency || '€'}${item.price.toLocaleString()}` : 'POA'}</div>
                                                    <div className="text-xs text-muted-foreground mt-0.5 max-w-[150px] truncate">{item.propertyType || item.listingType || 'Unknown Type'}</div>
                                                    {(item.bedrooms !== null || item.bathrooms !== null || item.propertyArea !== null) && (
                                                        <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap max-w-[150px]">
                                                            {item.bedrooms !== null && <span>{item.bedrooms} Bed</span>}
                                                            {item.bathrooms !== null && <span>{item.bathrooms} Bath</span>}
                                                            {item.propertyArea !== null && <span>{item.propertyArea}m²</span>}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell onClick={(e) => e.stopPropagation()}>
                                                    <Badge variant={
                                                        item.status === 'ACCEPTED' ? 'default' :
                                                        item.status === 'REJECTED' ? 'destructive' : 'outline'
                                                    } className="text-[10px] uppercase">
                                                        {item.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex justify-end gap-1.5">
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30" title="Scrape / Re-scrape listing" onClick={() => setScrapeListing(item)}>
                                                            <RefreshCw className="h-3.5 w-3.5" />
                                                        </Button>
                                                        {isNew ? (
                                                            <>
                                                                <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30" title="Accept" onClick={(e) => handleAccept(e, item.id)} disabled={isPending}>
                                                                    <Check className="h-4 w-4" />
                                                                </Button>
                                                                <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Reject" onClick={(e) => handleReject(e, item.id)} disabled={isPending}>
                                                                    <X className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild title="View on Market">
                                                                <a href={item.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground"/></a>
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                )}
            </ScrollArea>

            <ProspectReviewDrawer 
                listing={reviewListing} 
                isOpen={!!reviewListing} 
                onOpenChange={(open: boolean) => !open && setReviewListing(null)} 
            />

            {scrapeListing && (
                <ScrapeListingDialog
                    listingId={scrapeListing.id}
                    listingUrl={scrapeListing.url}
                    listingTitle={scrapeListing.title}
                    platform={scrapeListing.platform}
                    isOpen={!!scrapeListing}
                    onOpenChange={(open: boolean) => !open && setScrapeListing(null)}
                    onSuccess={() => router.refresh()}
                />
            )}
        </div>
    );
}
