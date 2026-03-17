'use client';

import { formatDistanceToNow } from 'date-fns';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { Building2, UserCheck, Home } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ListingFeedCardProps {
  listing: ScrapedListingRow;
  isSelected: boolean;
  onClick: () => void;
}

export function ListingFeedCard({ listing, isSelected, onClick }: ListingFeedCardProps) {
  const isNew = listing.status === 'NEW' || listing.status === 'new' || listing.status === 'REVIEWING';
  const thumb = listing.thumbnails?.[0] || listing.images?.[0];

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex gap-3 p-3 cursor-pointer transition-all border-l-[3px] hover:bg-muted/50",
        isSelected
          ? "bg-primary/5 border-l-primary shadow-sm"
          : "border-l-transparent",
        !isNew && "opacity-60"
      )}
    >
      {/* Thumbnail */}
      {thumb ? (
        <div className="w-[72px] h-[72px] rounded-lg overflow-hidden shrink-0 border bg-muted">
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-[72px] h-[72px] rounded-lg shrink-0 border bg-muted flex items-center justify-center">
          <Home className="w-5 h-5 text-muted-foreground/40" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          <div className="font-semibold text-sm leading-tight line-clamp-1">
            {listing.title || 'Untitled Listing'}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {listing.locationText || 'Cyprus'}
          </div>
        </div>

        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm">
              {listing.price ? `€${listing.price.toLocaleString()}` : 'POA'}
            </span>
            {listing.bedrooms !== null && (
              <span className="text-[10px] text-muted-foreground">{listing.bedrooms}B</span>
            )}
            {listing.propertyArea !== null && (
              <span className="text-[10px] text-muted-foreground">{listing.propertyArea}m²</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {listing.prospectAgency ? (
              <Building2 className="w-3 h-3 text-orange-500" />
            ) : (
              <UserCheck className="w-3 h-3 text-green-500" />
            )}
            {!isNew && (
              <Badge
                variant={listing.status === 'ACCEPTED' ? 'default' : 'destructive'}
                className="text-[9px] h-4 px-1"
              >
                {listing.status}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
