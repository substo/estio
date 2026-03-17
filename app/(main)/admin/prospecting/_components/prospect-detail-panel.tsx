'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { acceptProspect } from '../actions';
import { scrapeSellerProfile } from '../listings/_actions/seller-scrape';
import { toast } from 'sonner';
import {
  Building2, UserCheck, ExternalLink, Phone, MessageCircle,
  UserPlus, ChevronLeft, ChevronRight, DownloadCloud, Check, X, Home, Keyboard
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ProspectDetailPanelProps {
  listing: ScrapedListingRow | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}

export function ProspectDetailPanel({ listing, onAccept, onReject, isPending }: ProspectDetailPanelProps) {
  const router = useRouter();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isConverting, startConverting] = useTransition();
  const [isScrapingSeller, startScrapingSeller] = useTransition();

  // Reset carousel when listing changes
  useEffect(() => {
    setCurrentImageIndex(0);
  }, [listing?.id]);

  if (!listing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12">
        <Home className="w-16 h-16 mb-4 opacity-15" />
        <h3 className="text-lg font-medium text-foreground mb-1">Select a listing</h3>
        <p className="text-sm text-center max-w-[280px]">Click a listing on the left to review its details, seller profile, and take action.</p>
        <div className="flex items-center gap-2 mt-6 text-xs bg-muted/50 px-3 py-2 rounded-lg">
          <Keyboard className="w-3.5 h-3.5" />
          <span><kbd className="font-mono bg-background px-1 rounded border">A</kbd> Accept · <kbd className="font-mono bg-background px-1 rounded border">R</kbd> Reject · <kbd className="font-mono bg-background px-1 rounded border">↑↓</kbd> Navigate</span>
        </div>
      </div>
    );
  }

  const handleWhatsApp = () => {
    const phoneToUse = listing.whatsappPhone || listing.prospectPhone;
    if (!phoneToUse) return;
    const phone = phoneToUse.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=Hi ${listing.prospectName || ''}, I saw your property listing on ${listing.platform}. Are you open to agency cooperation?`, '_blank');
  };

  const handleCall = () => {
    const phoneToUse = listing.whatsappPhone || listing.prospectPhone;
    if (!phoneToUse) return;
    window.open(`tel:${phoneToUse}`, '_self');
  };

  const handleConvert = () => {
    if (!listing.prospectLeadId) {
      toast.error('No prospect profile linked.');
      return;
    }
    startConverting(async () => {
      const res = await acceptProspect(listing.prospectLeadId!);
      if (res.success) {
        toast.success('Prospect converted to CRM Contact!');
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  };

  const handleScrapeSeller = () => {
    if (!listing.otherListingsUrl) return;
    startScrapingSeller(async () => {
      const res = await scrapeSellerProfile(
        listing.locationId,
        listing.prospectName || 'Unknown Owner',
        listing.otherListingsUrl!
      );
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    });
  };

  const isNew = listing.status === 'NEW' || listing.status === 'new' || listing.status === 'REVIEWING';

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">

          {/* Photo Carousel */}
          {listing.images && listing.images.length > 0 ? (
            <div className="space-y-2">
              <div className="relative rounded-xl overflow-hidden border group bg-muted aspect-[16/10]">
                <a href={listing.images[currentImageIndex]} target="_blank" rel="noreferrer" title="View Full Image" className="block hover:opacity-95 transition-opacity w-full h-full">
                  <img
                    src={listing.thumbnails?.[currentImageIndex] || listing.images[currentImageIndex]}
                    alt="Property"
                    className="w-full h-full object-cover"
                  />
                </a>
                {listing.images.length > 1 && (
                  <>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentImageIndex((prev) => prev === 0 ? listing.images.length - 1 : prev - 1);
                      }}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentImageIndex((prev) => prev === listing.images.length - 1 ? 0 : prev + 1);
                      }}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                      {currentImageIndex + 1} / {listing.images.length}
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnail strip */}
              {listing.images.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                  {listing.images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`relative flex-shrink-0 w-14 h-10 rounded-md overflow-hidden border-2 transition-all ${currentImageIndex === idx ? 'border-primary ring-1 ring-primary/30' : 'border-transparent hover:border-muted-foreground/30'}`}
                    >
                      <img src={listing.thumbnails?.[idx] || listing.images[idx]} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full aspect-[16/10] bg-muted rounded-xl flex items-center justify-center text-muted-foreground border">
              <div className="text-center">
                <Home className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No Preview Image</p>
              </div>
            </div>
          )}

          {/* Property Info */}
          <div>
            <h2 className="text-xl font-bold leading-tight">{listing.title || 'Untitled Property'}</h2>
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              <Badge variant="secondary" className="font-bold text-sm">
                {listing.price ? `${listing.currency || '€'}${listing.price.toLocaleString()}` : 'POA'}
              </Badge>
              <Badge variant="outline">{listing.propertyType || listing.listingType || 'Property'}</Badge>
              {listing.bedrooms !== null && <Badge variant="outline">{listing.bedrooms} Beds</Badge>}
              {listing.bathrooms !== null && <Badge variant="outline">{listing.bathrooms} Baths</Badge>}
              {(listing.propertyArea || listing.plotArea) && (
                <Badge variant="outline">{listing.propertyArea || listing.plotArea} m²</Badge>
              )}
              {listing.constructionYear && <Badge variant="outline">Built {listing.constructionYear}</Badge>}
              <Badge variant="outline">{listing.locationText || 'Cyprus'}</Badge>
            </div>

            <a href={listing.url} target="_blank" rel="noreferrer" className="text-sm text-primary flex items-center gap-1 mt-3 hover:underline font-medium">
              View Original Listing <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Description */}
          {listing.description && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
              <p className="text-sm text-foreground/80 leading-relaxed line-clamp-6 whitespace-pre-line">{listing.description}</p>
            </div>
          )}

          <Separator />

          {/* Seller Profile Card */}
          <div className="space-y-3 bg-muted/30 p-4 rounded-xl border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base">Seller Profile</h3>
              {listing.prospectAgency ? (
                <Badge variant="destructive" className="text-xs gap-1"><Building2 className="w-3 h-3" /> Agency Detected</Badge>
              ) : (
                <Badge variant="default" className="bg-green-600 text-xs gap-1"><UserCheck className="w-3 h-3" /> Likely Private</Badge>
              )}
            </div>

            <div className="grid gap-2 text-sm">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Posted By</span>
                <span className="font-medium text-base">{listing.prospectName || 'Unknown Owner'}</span>
              </div>

              {listing.prospectPhone ? (
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Phone</span>
                  <span className="font-mono text-sm">{listing.prospectPhone}</span>
                </div>
              ) : (
                <p className="text-muted-foreground italic text-sm">Phone number not extracted yet.</p>
              )}

              {listing.sellerRegisteredAt && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Registration</span>
                  <span className="text-sm">{listing.sellerRegisteredAt}</span>
                </div>
              )}
            </div>

            {listing.otherListingsUrl && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-1 gap-2"
                onClick={handleScrapeSeller}
                disabled={isScrapingSeller}
              >
                <DownloadCloud className="w-4 h-4 text-primary" />
                {isScrapingSeller ? 'Starting Export...' : 'Scrape All Seller Listings'}
              </Button>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Sticky Action Bar */}
      <div className="border-t bg-background p-4 shrink-0">
        <div className="flex items-center gap-2">
          {/* Outreach */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleWhatsApp}
            disabled={!listing.whatsappPhone && !listing.prospectPhone}
          >
            <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleCall}
            disabled={!listing.whatsappPhone && !listing.prospectPhone}
          >
            <Phone className="w-4 h-4 text-blue-500" /> Call
          </Button>

          <div className="flex-1" />

          {/* Primary actions */}
          {isNew ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-red-200 hover:bg-red-50 text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30"
                onClick={() => onReject(listing.id)}
                disabled={isPending}
              >
                <X className="w-4 h-4" /> Reject
                <kbd className="ml-1 text-[9px] bg-red-100 dark:bg-red-900/30 px-1 rounded font-mono">R</kbd>
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => onAccept(listing.id)}
                disabled={isPending}
              >
                <Check className="w-4 h-4" /> Accept
                <kbd className="ml-1 text-[9px] bg-primary-foreground/20 px-1 rounded font-mono">A</kbd>
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={handleConvert}
              disabled={isConverting || !listing.prospectLeadId}
            >
              <UserPlus className="w-4 h-4" />
              {isConverting ? 'Converting...' : 'Convert to CRM Contact'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
