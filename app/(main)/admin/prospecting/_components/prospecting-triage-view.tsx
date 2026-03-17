'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { acceptScrapedListing, rejectScrapedListing } from '../actions';
import { toast } from 'sonner';
import { ListingFeedCard } from './listing-feed-card';
import { ProspectDetailPanel } from './prospect-detail-panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Filter, Home, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface ProspectingTriageViewProps {
  listings: ScrapedListingRow[];
  listingsTotal: number;
  prospects: ProspectInboxRow[];
  locationId: string;
  selectedProspectId?: string;
}

export function ProspectingTriageView({
  listings,
  listingsTotal,
  prospects,
  locationId,
  selectedProspectId,
}: ProspectingTriageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Clamp selected index when listings change
  useEffect(() => {
    if (selectedIndex >= listings.length) {
      setSelectedIndex(Math.max(0, listings.length - 1));
    }
  }, [listings.length, selectedIndex]);

  const selectedListing = listings[selectedIndex] ?? null;

  // --- Actions with auto-advance ---
  const handleAccept = useCallback((id: string) => {
    startTransition(async () => {
      const res = await acceptScrapedListing(id);
      if (res.success) {
        toast.success('Listing accepted');
        router.refresh();
        // selectedIndex stays the same — the accepted item drops out and the next one takes its place
      } else {
        toast.error(res.message);
      }
    });
  }, [router]);

  const handleReject = useCallback((id: string) => {
    startTransition(async () => {
      const res = await rejectScrapedListing(id);
      if (res.success) {
        toast.success('Listing rejected');
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }, [router]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      switch (e.key) {
        case 'a':
        case 'A':
          if (selectedListing && (selectedListing.status === 'NEW' || selectedListing.status === 'new' || selectedListing.status === 'REVIEWING')) {
            e.preventDefault();
            handleAccept(selectedListing.id);
          }
          break;
        case 'r':
          if (selectedListing && (selectedListing.status === 'NEW' || selectedListing.status === 'new' || selectedListing.status === 'REVIEWING')) {
            e.preventDefault();
            handleReject(selectedListing.id);
          }
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, listings.length - 1));
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedListing, listings.length, handleAccept, handleReject]);

  // --- URL-synced Filters ---
  const handleSellerFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete('prospectId');
    } else {
      params.set('prospectId', value);
    }
    setSelectedIndex(0);
    router.push(`?${params.toString()}`);
  };

  const handleScopeFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'new') {
      params.delete('scope');
    } else {
      params.set('scope', value);
    }
    setSelectedIndex(0);
    router.push(`?${params.toString()}`);
  };

  const handleSearch = (q: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (q) {
      params.set('q', q);
    } else {
      params.delete('q');
    }
    setSelectedIndex(0);
    router.push(`?${params.toString()}`);
  };

  const currentScope = searchParams.get('scope') || 'new';
  const currentSearch = searchParams.get('q') || '';

  // Build seller options from prospects
  const sellerOptions = prospects
    .filter(p => p.name)
    .map(p => ({ id: p.id, name: p.name!, count: p.scrapedListingsCount }));

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Pane — Listings Feed */}
      <div className="w-[380px] shrink-0 flex flex-col h-full border-r bg-background">
        {/* Filter Bar */}
        <div className="p-3 border-b space-y-2 shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search listings..."
                className="h-8 pl-8 text-sm"
                defaultValue={currentSearch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch((e.target as HTMLInputElement).value);
                  }
                }}
              />
            </div>
            <Select value={currentScope} onValueChange={handleScopeFilter}>
              <SelectTrigger className="w-[90px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sellerOptions.length > 0 && (
            <Select value={selectedProspectId || 'all'} onValueChange={handleSellerFilter}>
              <SelectTrigger className="w-full h-8 text-xs">
                <Filter className="w-3 h-3 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All Sellers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sellers</SelectItem>
                {sellerOptions.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.count})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Feed Header */}
        <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Home className="w-3.5 h-3.5" />
            <span>{listingsTotal} listings</span>
          </div>
          {listings.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {selectedIndex + 1} / {listings.length}
            </Badge>
          )}
        </div>

        {/* Feed Cards */}
        <ScrollArea className="flex-1">
          {listings.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-15" />
              <h4 className="text-sm font-medium text-foreground mb-1">All caught up!</h4>
              <p className="text-xs">No listings to review. Try changing filters or running a new scrape.</p>
            </div>
          ) : (
            <div className="divide-y">
              {listings.map((item, idx) => (
                <ListingFeedCard
                  key={item.id}
                  listing={item}
                  isSelected={idx === selectedIndex}
                  onClick={() => setSelectedIndex(idx)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right Pane — Detail Panel */}
      <div className="flex-1 flex flex-col h-full bg-background">
        <ProspectDetailPanel
          listing={selectedListing}
          onAccept={handleAccept}
          onReject={handleReject}
          isPending={isPending}
        />
      </div>
    </div>
  );
}
