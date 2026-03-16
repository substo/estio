'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Building2, UserCheck, ExternalLink, Phone, MessageCircle, Calendar, UserPlus, ChevronLeft, ChevronRight, DownloadCloud } from "lucide-react";
import { type ScrapedListingRow } from "@/lib/leads/scraped-listing-repository";
import { acceptProspect } from "../../people/actions";
import { scrapeSellerProfile } from "../_actions/seller-scrape";
import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface ProspectReviewDrawerProps {
  listing: ScrapedListingRow | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProspectReviewDrawer({ listing, isOpen, onOpenChange }: ProspectReviewDrawerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isScrapingSeller, startScrapingSeller] = useTransition();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Reset carousel when opening a new listing
  useEffect(() => {
    if (isOpen) setCurrentImageIndex(0);
  }, [listing?.id, isOpen]);

  if (!listing) return null;

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
      toast.error('No human prospect profile linked to this listing.');
      return;
    }
    startTransition(async () => {
      const res = await acceptProspect(listing.prospectLeadId!);
      if (res.success) {
        toast.success('Prospect converted to CRM Contact!');
        onOpenChange(false);
        router.refresh(); // Refresh the table
      } else {
        toast.error(res.message);
      }
    });
  };

  const handleScrapeSeller = () => {
    if (!listing?.otherListingsUrl) return;

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

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="text-xl">Review Prospect</SheetTitle>
          <SheetDescription>Evaluate this listing and the seller's profile.</SheetDescription>
        </SheetHeader>

        {/* Listing Details Section */}
        <div className="space-y-4 mb-8">
          <h3 className="font-semibold text-lg border-b pb-2">Property Details</h3>

          {listing.images && listing.images.length > 0 ? (
            <div className="space-y-2">
              <div className="relative rounded-lg overflow-hidden border group">
                <a href={listing.images[currentImageIndex]} target="_blank" rel="noreferrer" title="View Full Original Image" className="block hover:opacity-90 transition-opacity">
                  <img src={listing.thumbnails?.[currentImageIndex] || listing.images[currentImageIndex]} alt="Property" className="w-full h-56 object-cover" />
                </a>

                {listing.images.length > 1 && (
                  <>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity z-10"
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentImageIndex((prev) => prev === listing.images.length - 1 ? 0 : prev + 1);
                      }}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>

              {/* Thumbnail Strip */}
              {listing.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                  {listing.images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`relative flex-shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-all ${currentImageIndex === idx ? 'border-primary' : 'border-transparent hover:border-muted-foreground'}`}
                    >
                      <img src={listing.thumbnails?.[idx] || listing.images[idx]} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-48 bg-muted rounded-lg flex items-center justify-center text-muted-foreground border">
              No Preview Image
            </div>
          )}

          <div>
            <div className="flex justify-between items-start gap-4">
              <h4 className="font-medium flex-1">{listing.title || 'Untitled Property'}</h4>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge variant="secondary">{listing.price ? `${listing.currency || '€'}${listing.price.toLocaleString()}` : 'POA'}</Badge>
              <Badge variant="outline">{listing.propertyType || listing.listingType || 'Unknown Type'}</Badge>
              {listing.bedrooms && <Badge variant="outline">{listing.bedrooms} Beds</Badge>}
              {listing.bathrooms && <Badge variant="outline">{listing.bathrooms} Baths</Badge>}
              {(listing.propertyArea || listing.plotArea) && (
                <Badge variant="outline">{listing.propertyArea || listing.plotArea} m²</Badge>
              )}
              {listing.constructionYear && <Badge variant="outline">Built {listing.constructionYear}</Badge>}
              <Badge variant="outline">{listing.locationText || 'Cyprus'}</Badge>
            </div>

            <a href={listing.url} target="_blank" rel="noreferrer" className="text-sm text-primary flex items-center gap-1 mt-4 hover:underline">
              View Original Listing <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Seller / Contact Details Section */}
        <div className="space-y-4 bg-muted/30 p-4 rounded-xl border">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            Seller Profile
            {listing.prospectAgency ? (
              <Badge variant="destructive" className="ml-auto text-xs"><Building2 className="w-3 h-3 justify-center mr-1" /> Agency Detected</Badge>
            ) : (
              <Badge variant="default" className="bg-green-600 ml-auto text-xs"><UserCheck className="w-3 h-3 mr-1" /> Likely Private</Badge>
            )}
          </h3>

          <div className="grid gap-3 text-sm">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Posted By</span>
              <span className="font-medium text-base">{listing.prospectName || 'Unknown Owner'}</span>
            </div>

            {listing.prospectPhone ? (
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">Phone</span>
                <span className="font-mono">{listing.prospectPhone}</span>
              </div>
            ) : (
              <p className="text-muted-foreground italic text-sm">Phone number not extracted yet. Run Deep Scrape.</p>
            )}
          </div>

          {listing.otherListingsUrl && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 gap-2"
              onClick={handleScrapeSeller}
              disabled={isScrapingSeller}
            >
              <DownloadCloud className="w-4 h-4 text-primary" />
              {isScrapingSeller ? 'Starting Export...' : 'Scrape All Seller Listings'}
            </Button>
          )}

          <Separator className="my-4" />

          {/* Outreach Actions */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Outreach Actions</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="w-full gap-2" onClick={handleWhatsApp} disabled={!listing.whatsappPhone && !listing.prospectPhone}>
                <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp {listing.whatsappPhone && '(Direct)'}
              </Button>
              <Button variant="outline" className="w-full gap-2" onClick={handleCall} disabled={!listing.whatsappPhone && !listing.prospectPhone}>
                <Phone className="w-4 h-4 text-blue-500" /> Call Now
              </Button>
            </div>
            <Button
              variant="default"
              className="w-full gap-2 mt-2"
              onClick={handleConvert}
              disabled={isPending || !listing.prospectLeadId}
            >
              <UserPlus className="w-4 h-4" />
              {isPending ? 'Converting...' : 'Convert to CRM Contact'}
            </Button>
          </div>
        </div>

      </SheetContent>
    </Sheet>
  );
}
