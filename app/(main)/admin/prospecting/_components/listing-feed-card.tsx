'use client';

import { formatDistanceToNow } from 'date-fns';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { Building2, Home } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { resolveProspectingReviewState } from '@/lib/leads/prospecting-status';

interface ListingFeedCardProps {
  listing: ScrapedListingRow;
  isSelected: boolean;
  onClick: () => void;
  isBulkSelected?: boolean;
  onBulkSelect?: (checked: boolean) => void;
}

export function ListingFeedCard({ listing, isSelected, onClick, isBulkSelected, onBulkSelect }: ListingFeedCardProps) {
  const reviewState = resolveProspectingReviewState({
    listingStatus: listing.status,
    prospectStatus: listing.prospectStatus,
  });
  const isNew = reviewState === 'new';
  const thumb = listing.thumbnails?.[0] || listing.images?.[0];

  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-start gap-2.5 p-2.5 cursor-pointer transition-all border-l-[3px] hover:bg-muted/50",
        isSelected
          ? "bg-primary/5 border-l-primary shadow-sm"
          : "border-l-transparent",
        !isNew && "opacity-60"
      )}
    >
      {/* Checkbox */}
      <div className="mt-[18px] mr-[-4px]" onClick={(e) => e.stopPropagation()}>
        <Checkbox 
          checked={isBulkSelected}
          onCheckedChange={onBulkSelect}
          className={cn("transition-opacity", isBulkSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
        />
      </div>

      {/* Thumbnail */}
      {thumb ? (
        <div className="w-[60px] h-[60px] rounded-md overflow-hidden shrink-0 border bg-muted">
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-[60px] h-[60px] rounded-md shrink-0 border bg-muted flex items-center justify-center">
          <Home className="w-4 h-4 text-muted-foreground/40" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0">
        <div>
          <div className="flex justify-between items-start gap-2">
            <div className="font-semibold text-[13px] leading-tight line-clamp-1">
              {listing.title || 'Untitled Listing'}
            </div>
            <div className="flex gap-1 shrink-0">
              {listing.isExpired && (
                <Badge variant="destructive" className="bg-slate-800 text-white hover:bg-slate-800 text-[9px] h-4 px-1 shrink-0">Expired</Badge>
              )}
              {!isNew && (
                <Badge
                  variant={reviewState === 'accepted' ? 'default' : 'destructive'}
                  className="text-[9px] h-4 px-1 shrink-0"
                >
                  {reviewState === 'accepted' ? 'ACCEPTED' : reviewState === 'rejected' ? 'REJECTED' : listing.status}
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="font-bold text-[13px] text-primary">
              {listing.price ? `€${listing.price.toLocaleString()}` : 'POA'}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              · {listing.locationText || 'Cyprus'}
              {listing.bedrooms !== null && ` · ${listing.bedrooms}B`}
              {listing.propertyArea !== null && ` · ${listing.propertyArea}m²`}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0 pr-2">
            <Building2 className={cn('w-3 h-3 shrink-0', listing.effectiveSellerType === 'private' ? 'text-green-500' : 'text-orange-500')} />
            <span className="truncate">{listing.prospectName || 'Unknown'} · {listing.effectiveSellerType}</span>
          </div>
          <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
            {formatDistanceToNow(new Date(listing.createdAt), { addSuffix: true })}
          </div>
        </div>
      </div>
    </div>
  );
}
