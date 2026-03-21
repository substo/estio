'use client';

import { useState, useEffect, useCallback, useTransition, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import {
  acceptScrapedListing, rejectScrapedListing, bulkAcceptListings, bulkRejectListings,
  rejectProspectWithListings, acceptProspectWithListings
} from '../actions';
import { toast } from 'sonner';
import { ListingFeedCard } from './listing-feed-card';
import { ContactFeedCard } from './contact-feed-card';
import { ProspectDetailPanel } from './prospect-detail-panel';
import { ContactDetailPanel } from './contact-detail-panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Filter, Home, Users, Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

type FeedView = 'properties' | 'contacts';

interface ProspectingTriageViewProps {
  listings: ScrapedListingRow[];
  listingsTotal: number;
  prospects: ProspectInboxRow[];
  prospectsTotal: number;
  locationId: string;
  selectedProspectId?: string;
  initialView?: FeedView;
}

export function ProspectingTriageView({
  listings,
  listingsTotal,
  prospects,
  prospectsTotal,
  locationId,
  selectedProspectId,
  initialView = 'properties',
}: ProspectingTriageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  // --- View mode from URL ---
  const currentView: FeedView = (searchParams.get('view') as FeedView) || initialView;

  // --- URL-synced selected item ---
  const urlListingId = searchParams.get('listingId');
  const urlContactId = searchParams.get('contactId');

  // Compute selectedIndex from URL param
  const selectedIndex = useMemo(() => {
    if (currentView === 'properties') {
      if (urlListingId) {
        const idx = listings.findIndex(l => l.id === urlListingId);
        return idx >= 0 ? idx : 0;
      }
      return 0;
    } else {
      if (urlContactId) {
        const idx = prospects.findIndex(p => p.id === urlContactId);
        return idx >= 0 ? idx : 0;
      }
      return 0;
    }
  }, [currentView, urlListingId, urlContactId, listings, prospects]);

  const selectedListing = currentView === 'properties' ? (listings[selectedIndex] ?? null) : null;
  const selectedProspect = currentView === 'contacts' ? (prospects[selectedIndex] ?? null) : null;

  // --- Helper to push URL params without losing existing ones ---
  const pushParam = useCallback((key: string, value: string | null, removeKeys?: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (removeKeys) removeKeys.forEach(k => params.delete(k));
    router.push(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const selectItem = useCallback((index: number) => {
    if (currentView === 'properties') {
      const item = listings[index];
      if (item) pushParam('listingId', item.id, ['contactId']);
    } else {
      const item = prospects[index];
      if (item) pushParam('contactId', item.id, ['listingId']);
    }
  }, [currentView, listings, prospects, pushParam]);

  // --- View toggle ---
  const switchView = useCallback((v: FeedView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', v);
    params.delete('listingId');
    params.delete('contactId');
    setSelectedBulkIds([]);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // --- Listing Actions ---
  const handleAcceptListing = useCallback((id: string) => {
    startTransition(async () => {
      const res = await acceptScrapedListing(id);
      if (res.success) {
        toast.success(`Owner converted to Contact (${(res as any).propertiesImported || 1} properties imported)`);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }, [router]);

  const handleRejectListing = useCallback((id: string) => {
    startTransition(async () => {
      const res = await rejectScrapedListing(id);
      if (res.success) {
        toast.success('Listing rejected');
        router.refresh();
      } else {
        toast.error((res as any).message);
      }
    });
  }, [router]);

  // --- Contact Actions (cascade) ---
  const handleAcceptContact = useCallback((id: string) => {
    startTransition(async () => {
      const res = await acceptProspectWithListings(id);
      if (res.success) {
        toast.success(`Contact accepted (${(res as any).propertiesImported || 1} properties imported)`);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }, [router]);

  const handleRejectContact = useCallback((id: string) => {
    startTransition(async () => {
      const res = await rejectProspectWithListings(id);
      if (res.success) {
        toast.success(`Contact rejected (${(res as any).listingsRejected} listings removed)`);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }, [router]);

  // --- Bulk Actions ---
  const handleBulkAccept = useCallback(() => {
    if (selectedBulkIds.length === 0) return;
    startTransition(async () => {
      const res = await bulkAcceptListings(selectedBulkIds);
      if (res.success) {
        toast.success(`Accepted ${res.count} listings`);
        setSelectedBulkIds([]);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }, [selectedBulkIds, router]);

  const handleBulkReject = useCallback(() => {
    if (selectedBulkIds.length === 0) return;
    startTransition(async () => {
      const res = await bulkRejectListings(selectedBulkIds);
      if (res.success) {
        toast.success(`Rejected ${res.count} listings`);
        setSelectedBulkIds([]);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }, [selectedBulkIds, router]);

  const toggleBulkSelect = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedBulkIds(prev => [...prev, id]);
    } else {
      setSelectedBulkIds(prev => prev.filter(x => x !== id));
    }
  };

  const selectAllRendered = (checked: boolean) => {
    if (checked) {
      if (currentView === 'properties') {
        setSelectedBulkIds(listings.map(l => l.id));
      } else {
        setSelectedBulkIds(prospects.map(p => p.id));
      }
    } else {
      setSelectedBulkIds([]);
    }
  };

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const feedItems = currentView === 'properties' ? listings : prospects;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      switch (e.key) {
        case 'a':
        case 'A':
          e.preventDefault();
          if (currentView === 'properties' && selectedListing) {
            if (selectedListing.status === 'NEW' || selectedListing.status === 'new' || selectedListing.status === 'REVIEWING') {
              handleAcceptListing(selectedListing.id);
            }
          } else if (currentView === 'contacts' && selectedProspect) {
            if (selectedProspect.status === 'new' || selectedProspect.status === 'reviewing') {
              handleAcceptContact(selectedProspect.id);
            }
          }
          break;
        case 'r':
          e.preventDefault();
          if (currentView === 'properties' && selectedListing) {
            if (selectedListing.status === 'NEW' || selectedListing.status === 'new' || selectedListing.status === 'REVIEWING') {
              handleRejectListing(selectedListing.id);
            }
          } else if (currentView === 'contacts' && selectedProspect) {
            if (selectedProspect.status === 'new' || selectedProspect.status === 'reviewing') {
              handleRejectContact(selectedProspect.id);
            }
          }
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          selectItem(Math.min(selectedIndex + 1, feedItems.length - 1));
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          selectItem(Math.max(selectedIndex - 1, 0));
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentView, selectedListing, selectedProspect, selectedIndex, listings, prospects, handleAcceptListing, handleRejectListing, handleAcceptContact, handleRejectContact, selectItem]);

  // --- URL-synced Filters ---
  const handleSellerFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete('prospectId');
    } else {
      params.set('prospectId', value);
    }
    params.delete('listingId');
    router.push(`?${params.toString()}`);
  };

  const handleScopeFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'new') {
      params.delete('scope');
    } else {
      params.set('scope', value);
    }
    params.delete('listingId');
    params.delete('contactId');
    router.push(`?${params.toString()}`);
  };

  const handleSearch = (q: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (q) {
      params.set('q', q);
    } else {
      params.delete('q');
    }
    params.delete('listingId');
    params.delete('contactId');
    router.push(`?${params.toString()}`);
  };

  const currentScope = searchParams.get('scope') || 'new';
  const currentSearch = searchParams.get('q') || '';

  // Build seller options from prospects (for properties view filter)
  const sellerOptions = prospects
    .filter(p => p.name)
    .map(p => ({ id: p.id, name: p.name!, count: p.scrapedListingsCount }));

  const feedItems = currentView === 'properties' ? listings : prospects;
  const feedTotal = currentView === 'properties' ? listingsTotal : prospectsTotal;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Pane — Feed */}
      <div className="w-[clamp(320px,24vw,360px)] shrink-0 flex flex-col h-full border-r bg-background">

        {/* View Toggle Tabs */}
        <div className="flex border-b shrink-0">
          <button
            onClick={() => switchView('properties')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors border-b-2",
              currentView === 'properties'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Home className="w-3.5 h-3.5" /> Properties
          </button>
          <button
            onClick={() => switchView('contacts')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors border-b-2",
              currentView === 'contacts'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="w-3.5 h-3.5" /> Contacts
          </button>
        </div>

        {/* Filter Bar */}
        <div className="p-2.5 border-b space-y-2 shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder={currentView === 'properties' ? 'Search listings...' : 'Search contacts...'}
                className="h-8 pl-8 text-sm"
                defaultValue={currentSearch}
                key={currentView} // re-mount on view switch to reset
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch((e.target as HTMLInputElement).value);
                  }
                }}
              />
            </div>
            <Select value={currentScope} onValueChange={handleScopeFilter}>
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {currentView === 'properties' && sellerOptions.length > 0 && (
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

        {/* Feed Header or Bulk Actions */}
        <div className={cn("px-3 border-b flex items-center justify-between shrink-0 transition-colors", selectedBulkIds.length > 0 ? "bg-muted/30 py-1.5" : "py-2")}>
          {selectedBulkIds.length > 0 ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Checkbox 
                  checked={selectedBulkIds.length === feedItems.length && feedItems.length > 0} 
                  onCheckedChange={selectAllRendered} 
                  title="Deselect All"
                />
                <span className="text-xs font-medium text-primary">{selectedBulkIds.length} selected</span>
              </div>
              {currentView === 'properties' && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleBulkReject} disabled={isPending}>
                     <XCircle className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={handleBulkAccept} disabled={isPending}>
                     <CheckCircle2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                {currentView === 'properties' ? <Home className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                <span>{feedTotal} {currentView === 'properties' ? 'listings' : 'contacts'}</span>
              </div>
              {feedItems.length > 0 && (
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-[10px]">
                    {selectedIndex + 1} / {feedItems.length}
                  </Badge>
                  {currentView === 'properties' && (
                    <Checkbox 
                      checked={false} 
                      onCheckedChange={selectAllRendered} 
                      className="opacity-50 hover:opacity-100 transition-opacity w-3.5 h-3.5"
                      title="Select All for Bulk Actions"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Feed Cards */}
        <ScrollArea className="flex-1">
          {feedItems.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-15" />
              <h4 className="text-sm font-medium text-foreground mb-1">All caught up!</h4>
              <p className="text-xs">No {currentView === 'properties' ? 'listings' : 'contacts'} to review. Try changing filters or running a new scrape.</p>
            </div>
          ) : currentView === 'properties' ? (
            <div className="divide-y">
              {listings.map((item, idx) => (
                <ListingFeedCard
                  key={item.id}
                  listing={item}
                  isSelected={idx === selectedIndex}
                  onClick={() => selectItem(idx)}
                  isBulkSelected={selectedBulkIds.includes(item.id)}
                  onBulkSelect={(checked) => toggleBulkSelect(item.id, checked === true)}
                />
              ))}
            </div>
          ) : (
            <div className="divide-y">
              {prospects.map((item, idx) => (
                <ContactFeedCard
                  key={item.id}
                  prospect={item}
                  isSelected={idx === selectedIndex}
                  onClick={() => selectItem(idx)}
                  isBulkSelected={selectedBulkIds.includes(item.id)}
                  onBulkSelect={(checked) => toggleBulkSelect(item.id, checked === true)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right Pane — Detail Panel */}
      <div className="flex-1 flex flex-col h-full bg-background">
        {currentView === 'properties' ? (
          <ProspectDetailPanel
            listing={selectedListing}
            onAccept={handleAcceptListing}
            onReject={handleRejectListing}
            isPending={isPending}
          />
        ) : (
          <ContactDetailPanel
            prospect={selectedProspect}
            onAccept={handleAcceptContact}
            onReject={handleRejectContact}
            isPending={isPending}
            locationId={locationId}
          />
        )}
      </div>
    </div>
  );
}
