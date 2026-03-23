'use client';

import { formatDistanceToNow } from 'date-fns';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { Building2, Phone, Home, Hash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { resolveProspectingReviewState } from '@/lib/leads/prospecting-status';

interface ContactFeedCardProps {
  prospect: ProspectInboxRow;
  isSelected: boolean;
  onClick: () => void;
  isBulkSelected?: boolean;
  onBulkSelect?: (checked: boolean) => void;
}

export function ContactFeedCard({ prospect, isSelected, onClick, isBulkSelected, onBulkSelect }: ContactFeedCardProps) {
  const reviewState = resolveProspectingReviewState({ prospectStatus: prospect.status });
  const isNew = reviewState === 'new';
  const thumb = prospect.scrapedListings?.[0]?.thumbnails?.[0] || prospect.scrapedListings?.[0]?.images?.[0];

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

      {/* Avatar / Thumbnail */}
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
              {prospect.name || 'Unknown Seller'}
            </div>
            {!isNew && (
              <Badge
                variant={reviewState === 'accepted' ? 'default' : 'destructive'}
                className="text-[9px] h-4 px-1 shrink-0"
              >
                {reviewState}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge
              variant={prospect.effectiveSellerType === 'private' ? 'default' : 'destructive'}
              className={cn('text-[9px] h-4 px-1 gap-0.5', prospect.effectiveSellerType === 'private' ? 'bg-green-600' : '')}
            >
              <Building2 className="w-2.5 h-2.5" /> {prospect.effectiveSellerType}
            </Badge>
            <span className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
              <Hash className="w-2.5 h-2.5" />{prospect.scrapedListingsCount} listing{prospect.scrapedListingsCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0 pr-2">
            {prospect.phone ? (
              <>
                <Phone className="w-3 h-3 shrink-0 text-blue-500" />
                <span className="truncate font-mono">{prospect.phone}</span>
              </>
            ) : (
              <span className="italic">No phone</span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
            {formatDistanceToNow(new Date(prospect.createdAt), { addSuffix: true })}
          </div>
        </div>
      </div>
    </div>
  );
}
