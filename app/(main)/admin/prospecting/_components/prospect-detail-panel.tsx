'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { acceptProspect, deleteProspect, linkProspectAgencyCompany } from '../actions';
import { scrapeSellerProfile } from '../listings/_actions/seller-scrape';
import { ScrapeListingDialog } from './scrape-listing-dialog';
import { toast } from 'sonner';
import {
  Building2, UserCheck, ExternalLink, Phone, MessageCircle,
  UserPlus, ChevronLeft, ChevronRight, DownloadCloud, Check, X, Home, Keyboard, RefreshCw, Trash2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface ProspectDetailPanelProps {
  listing: ScrapedListingRow | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}

export function ProspectDetailPanel({ listing: originalListing, onAccept, onReject, isPending }: ProspectDetailPanelProps) {
  const router = useRouter();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isConverting, startConverting] = useTransition();
  const [isScrapingSeller, startScrapingSeller] = useTransition();
  const [isLinkingCompany, startLinkingCompany] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [isScrapeOpen, setIsScrapeOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [optimisticUpdate, setOptimisticUpdate] = useState<any>(null);

  // Reset carousel and optimistic data when listing changes
  useEffect(() => {
    setCurrentImageIndex(0);
    setOptimisticUpdate(null);
  }, [originalListing?.id]);

  const listing = originalListing && optimisticUpdate 
    ? { 
        ...originalListing, 
        ...optimisticUpdate, 
        prospectLeadId: optimisticUpdate.prospectLeadId || originalListing.prospectLeadId,
        prospectName: optimisticUpdate.prospectName || optimisticUpdate.ownerName || originalListing.prospectName,
        prospectPhone: optimisticUpdate.ownerPhone || originalListing.prospectPhone
      } 
    : originalListing;

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
        listing.otherListingsUrl!,
        listing.prospectLeadId || undefined
      );
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    });
  };

  const handleLinkCompany = () => {
    if (!listing.prospectLeadId) return;
    startLinkingCompany(async () => {
      const res = await linkProspectAgencyCompany(listing.prospectLeadId!);
      if (res.success) {
        toast.success(res.message || 'Company linked');
        router.refresh();
      } else {
        toast.error(res.message || 'Failed to link company');
      }
    });
  };

  const handleDelete = () => {
    if (!listing.prospectLeadId) return;
    startDeleting(async () => {
      const res = await deleteProspect(listing.prospectLeadId!);
      if (res.success) {
        toast.success('Prospect deleted successfully');
        setIsDeleteDialogOpen(false);
        router.push('/admin/prospecting');
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  };

  const isNew = listing.status === 'NEW' || listing.status === 'new' || listing.status === 'REVIEWING';

  return (
    <div className="flex flex-col h-full">
      <ScrapeListingDialog
        isOpen={isScrapeOpen}
        onOpenChange={setIsScrapeOpen}
        listingId={listing.id}
        listingUrl={listing.url}
        platform={listing.platform}
        listingTitle={listing.title}
        onSuccess={(data) => {
          if (data) setOptimisticUpdate(data);
          router.refresh();
        }}
      />

      {/* Strict Viewport Layout */}
      <div className="flex-1 overflow-hidden p-4 lg:p-6">
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 h-full min-h-0">

          {/* LEFT COLUMN: Details, Seller, Actions */}
          <ScrollArea className="lg:col-span-5 h-full pr-2">
            <div className="space-y-6 pb-4">
              
              {/* Property Info */}
              <div>
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold leading-tight">{listing.title || 'Untitled Property'}</h2>
                    {listing.isExpired && (
                      <Badge variant="destructive" className="bg-slate-800 hover:bg-slate-800 text-white uppercase translate-y-px">Expired Listing</Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0 -mt-1 text-muted-foreground hover:text-foreground" onClick={() => setIsScrapeOpen(true)} title="Re-scrape Listing">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
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

                  {/* Dynamic Features from Scraping */}
                  {listing.rawAttributes && Object.entries(listing.rawAttributes)
                    .filter(([key]) => !['Bedrooms', 'Bathrooms', 'Property area', 'Plot area', 'Construction year'].includes(key))
                    .filter(([key]) => !/^Seller business /i.test(key))
                    .map(([key, value]) => (
                      <Badge key={key} variant="outline" className="bg-muted/30">
                        <span className="text-muted-foreground mr-1 font-normal">{key}:</span> {String(value)}
                      </Badge>
                    ))
                  }
                </div>

                <a href={listing.url} target="_blank" rel="noreferrer" className="text-sm text-primary flex items-center gap-1 mt-3 hover:underline font-medium">
                  View Original Listing <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Description */}
              {listing.description && (
                <div className="pt-1">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</h3>
                  <p className="text-sm text-foreground/80 leading-relaxed line-clamp-5 hover:line-clamp-none transition-all whitespace-pre-line cursor-ns-resize">{listing.description}</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* RIGHT COLUMN: Actions & Photos */}
          <div className="lg:col-span-7 h-full flex flex-col gap-4 min-w-0">
            
            {/* Top: Seller Profile & Actions (Fixed height, always visible) */}
            <div className="shrink-0 bg-muted/30 p-4 rounded-xl border flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wider hidden xl:inline-block">Seller:</span>
                  {listing.prospectLeadId ? (
                    <h3
                      className="font-semibold text-base text-primary cursor-pointer hover:underline"
                      onClick={() => {
                        const params = new URLSearchParams(window.location.search);
                        params.set('view', 'contacts');
                        params.set('contactId', listing.prospectLeadId!);
                        params.set('scope', 'all');
                        params.delete('listingId');
                        router.push(`?${params.toString()}`);
                      }}
                    >
                      {listing.prospectName || 'Unknown Owner'}
                    </h3>
                  ) : (
                    <h3 className="font-semibold text-base">{listing.prospectName || 'Unknown Owner'}</h3>
                  )}
                  {listing.prospectAgency ? (
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5 gap-1"><Building2 className="w-3 h-3" /> Agency</Badge>
                  ) : (
                    <Badge variant="default" className="bg-green-600 text-[10px] h-5 px-1.5 gap-1"><UserCheck className="w-3 h-3" /> Private</Badge>
                  )}
                </div>
                
                {listing.prospectPhone ? (
                  <span className="font-mono text-sm font-medium">{listing.prospectPhone}</span>
                ) : (
                  <span className="text-muted-foreground italic text-[11px]">No phone</span>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-border/50">
                <Button variant="outline" size="sm" className="gap-1.5 mt-2" onClick={handleWhatsApp} disabled={!listing.whatsappPhone && !listing.prospectPhone}>
                  <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 mt-2" onClick={handleCall} disabled={!listing.whatsappPhone && !listing.prospectPhone}>
                  <Phone className="w-4 h-4 text-blue-500" /> Call
                </Button>

                {listing.otherListingsUrl && (
                  <Button variant="outline" size="sm" className="gap-1.5 mt-2 ml-1" onClick={handleScrapeSeller} disabled={isScrapingSeller}>
                    <DownloadCloud className="w-4 h-4 text-primary" /> {isScrapingSeller ? 'Scraping...' : 'Scrape Other Listings'}
                  </Button>
                )}

                {listing.prospectAgency && listing.prospectLeadId && (
                  <Button variant="outline" size="sm" className="gap-1.5 mt-2 ml-1" onClick={handleLinkCompany} disabled={isLinkingCompany}>
                    <Building2 className="w-4 h-4 text-emerald-600" /> {isLinkingCompany ? 'Linking...' : 'Link As Company'}
                  </Button>
                )}

                <div className="flex-1 min-w-[0.5rem]" />

                {isNew ? (
                  <>
                    <Button variant="outline" size="sm" className="gap-1.5 mt-2 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30" onClick={() => onReject(listing.id)} disabled={isPending}>
                      <X className="w-4 h-4" /> Reject
                      <kbd className="hidden xl:inline ml-1 text-[9px] bg-red-100 dark:bg-red-900/30 px-1 rounded font-mono">R</kbd>
                    </Button>
                    {!listing.prospectAgency ? (
                      <Button size="sm" className="gap-1.5 mt-2" onClick={() => onAccept(listing.id)} disabled={isPending}>
                        <Check className="w-4 h-4" /> Accept
                        <kbd className="hidden xl:inline ml-1 text-[9px] bg-primary-foreground/20 px-1 rounded font-mono">A</kbd>
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-[10px] mt-2">Agency: private accept disabled</Badge>
                    )}
                  </>
                ) : (
                  <Button variant="default" size="sm" className="gap-1.5 mt-2" onClick={handleConvert} disabled={isConverting || !listing.prospectLeadId}>
                    <UserPlus className="w-4 h-4" /> Convert to Contact
                  </Button>
                )}

                {listing.prospectLeadId && (
                  <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="mt-2 ml-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10" disabled={isDeleting}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogTitle>Delete Prospect</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to permanently delete this prospect? Any currently associated listings will be unlinked and return to the New properties queue.
                      </DialogDescription>
                      <div className="flex justify-end gap-2 mt-4">
                        <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>

            {/* Bottom: Photos (Takes remaining space, scales perfectly) */}
            <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden border bg-black/5 dark:bg-black/40">
              
              {/* Main Carousel Image */}
              <div className="flex-1 relative min-h-0 bg-transparent group overflow-hidden">
                {listing.images && listing.images.length > 0 ? (
                  <>
                    <Dialog>
                      <DialogTrigger asChild>
                        <button title="View Full Image" className="w-full h-full flex items-center justify-center p-2 outline-none cursor-zoom-in overflow-hidden">
                          <img
                            src={listing.images[currentImageIndex]}
                            alt="Property"
                            className="w-full h-full object-contain drop-shadow-md rounded-md transition-transform hover:scale-[1.02]"
                          />
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-[95vw] w-auto h-[95vh] p-4 bg-black/95 border-none flex flex-col items-center justify-center">
                        <DialogTitle className="sr-only">Image Gallery</DialogTitle>
                        <DialogDescription className="sr-only">Full resolution property image</DialogDescription>
                        <div className="relative w-full h-full flex items-center justify-center">
                          <img
                            src={listing.images[currentImageIndex]}
                            alt="Property Full"
                            className="w-full h-full object-contain"
                          />
                          {listing.images.length > 1 && (
                            <>
                              <Button variant="ghost" size="icon" className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/80 text-white rounded-full z-10" onClick={(e) => { e.preventDefault(); setCurrentImageIndex((prev) => prev === 0 ? listing.images.length - 1 : prev - 1); }}>
                                <ChevronLeft className="w-8 h-8" />
                              </Button>
                              <Button variant="ghost" size="icon" className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/80 text-white rounded-full z-10" onClick={(e) => { e.preventDefault(); setCurrentImageIndex((prev) => prev === listing.images.length - 1 ? 0 : prev + 1); }}>
                                <ChevronRight className="w-8 h-8" />
                              </Button>
                              <div className="absolute top-4 right-4 bg-black/60 text-white text-sm font-medium px-3 py-1 rounded-full z-10">
                                {currentImageIndex + 1} / {listing.images.length}
                              </div>
                            </>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                    {listing.images.length > 1 && (
                      <>
                        <Button variant="secondary" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 opacity-50 bg-black/40 text-white hover:bg-black/70 hover:opacity-100 group-hover:opacity-100 transition-opacity z-10 shadow-lg border-none" onClick={(e) => { e.preventDefault(); setCurrentImageIndex((prev) => prev === 0 ? listing.images.length - 1 : prev - 1); }}>
                          <ChevronLeft className="w-5 h-5" />
                        </Button>
                        <Button variant="secondary" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 opacity-50 bg-black/40 text-white hover:bg-black/70 hover:opacity-100 group-hover:opacity-100 transition-opacity z-10 shadow-lg border-none" onClick={(e) => { e.preventDefault(); setCurrentImageIndex((prev) => prev === listing.images.length - 1 ? 0 : prev + 1); }}>
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                        <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full z-10">
                          {currentImageIndex + 1} / {listing.images.length}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Home className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">No Preview Image</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Thumbnail strip */}
              {listing.images && listing.images.length > 1 && (
                <div className="shrink-0 flex gap-1.5 overflow-x-auto p-2 scrollbar-thin border-t bg-muted/10">
                  {listing.images.map((img: string, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`relative w-14 h-10 shrink-0 flex items-center justify-center rounded overflow-hidden border-2 transition-all ${currentImageIndex === idx ? 'border-primary ring-1 ring-primary/30' : 'border-transparent opacity-60 hover:opacity-100 bg-black/5'}`}
                    >
                      <img src={listing.thumbnails?.[idx] || img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
