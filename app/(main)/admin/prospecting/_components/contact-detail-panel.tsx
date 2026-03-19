'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { acceptProspectWithListings, rejectProspectWithListings } from '../actions';
import { scrapeSellerProfile } from '../listings/_actions/seller-scrape';
import { toast } from 'sonner';
import {
  Building2, UserCheck, ExternalLink, Phone, MessageCircle,
  UserPlus, DownloadCloud, Check, X, Home, Keyboard, Hash, Mail
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ContactDetailPanelProps {
  prospect: ProspectInboxRow | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
  locationId: string;
}

export function ContactDetailPanel({ prospect, onAccept, onReject, isPending, locationId }: ContactDetailPanelProps) {
  const router = useRouter();
  const [isScrapingSeller, startScrapingSeller] = useTransition();

  if (!prospect) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12">
        <Home className="w-16 h-16 mb-4 opacity-15" />
        <h3 className="text-lg font-medium text-foreground mb-1">Select a contact</h3>
        <p className="text-sm text-center max-w-[280px]">Click a contact on the left to review their properties, profile, and take action.</p>
        <div className="flex items-center gap-2 mt-6 text-xs bg-muted/50 px-3 py-2 rounded-lg">
          <Keyboard className="w-3.5 h-3.5" />
          <span><kbd className="font-mono bg-background px-1 rounded border">A</kbd> Accept · <kbd className="font-mono bg-background px-1 rounded border">R</kbd> Reject · <kbd className="font-mono bg-background px-1 rounded border">↑↓</kbd> Navigate</span>
        </div>
      </div>
    );
  }

  const isNew = prospect.status === 'new' || prospect.status === 'reviewing';

  const handleWhatsApp = () => {
    if (!prospect.phone) return;
    const phone = prospect.phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=Hi ${prospect.name || ''}, I saw your property listings. Are you open to agency cooperation?`, '_blank');
  };

  const handleCall = () => {
    if (!prospect.phone) return;
    window.open(`tel:${prospect.phone}`, '_self');
  };

  // Use profileUrl directly from the prospect, falling back to listing data
  const sellerProfileUrl = prospect.profileUrl || prospect.scrapedListings?.find((l: any) => l.otherListingsUrl)?.otherListingsUrl as string | undefined;

  const handleScrapeSeller = () => {
    if (!sellerProfileUrl) return;
    startScrapingSeller(async () => {
      const res = await scrapeSellerProfile(
        locationId,
        prospect.name || 'Unknown Owner',
        sellerProfileUrl
      );
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  };

  const newListingsCount = prospect.scrapedListings?.filter(l => l.status === 'NEW' || l.status === 'new' || l.status === 'REVIEWING').length || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Contact Header */}
      <div className="shrink-0 bg-muted/30 p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{prospect.name || 'Unknown Seller'}</h2>
            {prospect.isAgency ? (
              <Badge variant="destructive" className="text-[10px] h-5 px-1.5 gap-1"><Building2 className="w-3 h-3" /> Agency</Badge>
            ) : (
              <Badge variant="default" className="bg-green-600 text-[10px] h-5 px-1.5 gap-1"><UserCheck className="w-3 h-3" /> Private</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {sellerProfileUrl && (
              <a href={sellerProfileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                View Profile <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <Badge variant="outline" className="text-xs gap-1"><Hash className="w-3 h-3" /> {prospect.scrapedListingsCount} listings</Badge>
          </div>
        </div>

        {/* Contact details */}
        <div className="flex items-center gap-4 mt-2 text-sm">
          {prospect.phone && (
            <span className="flex items-center gap-1 font-mono"><Phone className="w-3.5 h-3.5 text-blue-500" /> {prospect.phone}</span>
          )}
          {prospect.email && (
            <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-amber-500" /> {prospect.email}</span>
          )}
          {prospect.platformRegistered && (
            <span className="text-xs text-muted-foreground">{prospect.platformRegistered}</span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center flex-wrap gap-2 pt-3 mt-3 border-t border-border/50">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleWhatsApp} disabled={!prospect.phone}>
            <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCall} disabled={!prospect.phone}>
            <Phone className="w-4 h-4 text-blue-500" /> Call
          </Button>

          {sellerProfileUrl && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleScrapeSeller} disabled={isScrapingSeller}>
              <DownloadCloud className="w-4 h-4 text-primary" /> {isScrapingSeller ? 'Scraping...' : 'Scrape Other Listings'}
            </Button>
          )}

          <div className="flex-1 min-w-[0.5rem]" />

          {isNew ? (
            <>
              <Button variant="outline" size="sm" className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30" onClick={() => onReject(prospect.id)} disabled={isPending}>
                <X className="w-4 h-4" /> Reject All ({newListingsCount})
                <kbd className="hidden xl:inline ml-1 text-[9px] bg-red-100 dark:bg-red-900/30 px-1 rounded font-mono">R</kbd>
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => onAccept(prospect.id)} disabled={isPending}>
                <Check className="w-4 h-4" /> Accept All ({newListingsCount})
                <kbd className="hidden xl:inline ml-1 text-[9px] bg-primary-foreground/20 px-1 rounded font-mono">A</kbd>
              </Button>
            </>
          ) : (
            <Badge variant={prospect.status === 'accepted' ? 'default' : 'destructive'} className="text-xs">
              {prospect.status === 'accepted' ? 'Accepted' : 'Rejected'}
            </Badge>
          )}
        </div>
      </div>

      {/* Properties Grid */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Properties ({prospect.scrapedListingsCount})</h3>
          {prospect.scrapedListings && prospect.scrapedListings.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {prospect.scrapedListings.map((listing) => {
                const thumb = listing.thumbnails?.[0] || listing.images?.[0];
                const isListingNew = listing.status === 'NEW' || listing.status === 'new' || listing.status === 'REVIEWING';
                return (
                  <div
                    key={listing.id}
                    onClick={() => {
                      const params = new URLSearchParams(window.location.search);
                      params.set('view', 'properties');
                      params.set('listingId', listing.id);
                      params.delete('contactId');
                      router.push(`?${params.toString()}`);
                    }}
                    className={`rounded-lg border bg-background overflow-hidden transition-all cursor-pointer hover:ring-2 hover:ring-primary/30 hover:shadow-md ${!isListingNew ? 'opacity-50' : ''}`}
                  >
                    {thumb ? (
                      <div className="h-32 bg-muted">
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="h-32 bg-muted flex items-center justify-center">
                        <Home className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="p-2.5 space-y-1">
                      <p className="font-semibold text-sm line-clamp-1">{listing.title || 'Untitled'}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-xs font-bold">
                          {listing.price ? `${listing.currency || '€'}${listing.price.toLocaleString()}` : 'POA'}
                        </Badge>
                        {listing.bedrooms !== null && <Badge variant="outline" className="text-[10px]">{listing.bedrooms}B</Badge>}
                        {listing.propertyArea !== null && <Badge variant="outline" className="text-[10px]">{listing.propertyArea}m²</Badge>}
                        {!isListingNew && (
                          <Badge variant={listing.status === 'IMPORTED' ? 'default' : 'destructive'} className="text-[9px]">{listing.status}</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{listing.locationText || 'Cyprus'}</p>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-primary font-medium">Open Details →</span>
                        <a href={listing.url} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground flex items-center gap-1 hover:underline hover:text-primary" onClick={(e) => e.stopPropagation()}>
                          External <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-10">
              <Home className="w-10 h-10 mx-auto mb-2 opacity-15" />
              <p className="text-sm">No properties found for this contact.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
