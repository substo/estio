'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { setProspectSellerTypeManual } from '../actions';
import { openOrStartConversationForContact } from '@/app/(main)/admin/contacts/actions';
import { scrapeSellerProfile } from '../listings/_actions/seller-scrape';
import { toast } from 'sonner';
import {
  Building2,
  ExternalLink,
  Phone,
  MessageCircle,
  DownloadCloud,
  Check,
  X,
  Home,
  Keyboard,
  Hash,
  Mail,
  MessageSquare,
  Link2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CompanyLinkDialog } from './company-link-dialog';
import { isProspectStatusLinkable } from '@/lib/leads/prospect-status';
import {
  type ProspectSellerType,
  isNonPrivateSellerType,
  resolveEffectiveSellerType,
} from '@/lib/leads/seller-type';
import { resolveProspectingReviewState } from '@/lib/leads/prospecting-status';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ContactDetailPanelProps {
  prospect: ProspectInboxRow | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
  locationId: string;
}

const SELLER_TYPE_OPTIONS: Array<{ value: ProspectSellerType; label: string }> = [
  { value: 'private', label: 'Private' },
  { value: 'agency', label: 'Agency' },
  { value: 'management', label: 'Management' },
  { value: 'developer', label: 'Developer' },
  { value: 'other', label: 'Other' },
];

function getSellerTypeLabel(value: ProspectSellerType): string {
  const option = SELLER_TYPE_OPTIONS.find((item) => item.value === value);
  return option?.label || 'Private';
}

function getSellerTypeBadgeClass(value: ProspectSellerType): string {
  switch (value) {
    case 'private':
      return 'bg-green-600 text-white';
    case 'agency':
      return 'bg-orange-600 text-white';
    case 'management':
      return 'bg-blue-600 text-white';
    case 'developer':
      return 'bg-indigo-600 text-white';
    case 'other':
      return 'bg-slate-700 text-white';
    default:
      return 'bg-green-600 text-white';
  }
}

export function ContactDetailPanel({ prospect, onAccept, onReject, isPending, locationId }: ContactDetailPanelProps) {
  const router = useRouter();
  const [isScrapingSeller, startScrapingSeller] = useTransition();
  const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
  const [isUpdatingSellerType, startUpdatingSellerType] = useTransition();
  const [isOpeningConversation, startOpeningConversation] = useTransition();

  useEffect(() => {
    setIsCompanyDialogOpen(false);
  }, [prospect?.id]);

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

  const effectiveSellerType = resolveEffectiveSellerType({
    sellerType: prospect.sellerType,
    sellerTypeManual: prospect.sellerTypeManual,
    isAgency: prospect.isAgency,
    isAgencyManual: prospect.isAgencyManual,
  });
  const isManualOverride = Boolean(prospect.sellerTypeManual);
  const reviewState = resolveProspectingReviewState({ prospectStatus: prospect.status });
  const isNew = reviewState === 'new';
  const hasAcceptedContact = Boolean(prospect.createdContactId);
  const showConversationCta = reviewState === 'accepted' && hasAcceptedContact;

  const handleSetSellerType = (value: string) => {
    const nextValue: ProspectSellerType | null = value === 'auto' ? null : (value as ProspectSellerType);
    startUpdatingSellerType(async () => {
      const res = await setProspectSellerTypeManual(prospect.id, nextValue);
      if (!res.success) {
        toast.error(res.message || 'Failed to update seller type');
        return;
      }
      toast.success(nextValue ? `Seller type set to ${getSellerTypeLabel(nextValue)}` : 'Seller type reset to AI/auto');
      router.refresh();
    });
  };

  const handleOpenConversation = () => {
    if (!prospect.createdContactId) {
      toast.error('No CRM contact is linked yet. Accept this prospect first.');
      return;
    }

    startOpeningConversation(async () => {
      const res = await openOrStartConversationForContact(prospect.createdContactId!);
      if (res?.success && res.conversationId) {
        router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
        router.refresh();
        return;
      }
      toast.error(res?.error || 'Failed to open conversation');
    });
  };

  const handleWhatsApp = () => {
    if (!prospect.phone) return;
    const phone = prospect.phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=Hi ${prospect.name || ''}, I saw your property listings. Are you open to agency cooperation?`, '_blank');
  };

  const handleCall = () => {
    if (!prospect.phone) return;
    window.open(`tel:${prospect.phone}`, '_self');
  };

  const sellerProfileUrl = prospect.profileUrl || prospect.scrapedListings?.find((l: any) => l.otherListingsUrl)?.otherListingsUrl as string | undefined;

  const handleScrapeSeller = () => {
    if (!sellerProfileUrl) return;
    startScrapingSeller(async () => {
      const res = await scrapeSellerProfile(
        locationId,
        prospect.name || 'Unknown Owner',
        sellerProfileUrl,
        prospect.id
      );
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  };

  const newListingsCount = prospect.scrapedListings?.filter((listing) => {
    return resolveProspectingReviewState({
      listingStatus: listing.status,
      prospectStatus: prospect.status,
    }) === 'new';
  }).length || 0;

  const canLinkCompany = isNonPrivateSellerType(effectiveSellerType) && isProspectStatusLinkable(prospect.status);
  const strategicScrape = (prospect.aiScoreBreakdown as any)?.strategicScrape || {};
  const stagedCompanyMatch = strategicScrape?.companyMatch;
  const linkedCompany = strategicScrape?.companyLink;

  return (
    <div className="flex flex-col h-full">
      <CompanyLinkDialog
        prospectId={prospect.id}
        open={isCompanyDialogOpen}
        onOpenChange={setIsCompanyDialogOpen}
        onLinked={() => router.refresh()}
      />
      <div className="shrink-0 bg-muted/30 p-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{prospect.name || 'Unknown Seller'}</h2>
            <Badge className={`text-[10px] h-5 px-1.5 gap-1 ${getSellerTypeBadgeClass(effectiveSellerType)}`}>
              <Building2 className="w-3 h-3" /> {getSellerTypeLabel(effectiveSellerType)}
            </Badge>
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

        <div className="mt-2 flex items-center gap-2">
          <Select
            value={prospect.sellerTypeManual || 'auto'}
            onValueChange={handleSetSellerType}
            disabled={isUpdatingSellerType}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue placeholder="Seller type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (AI)</SelectItem>
              {SELLER_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-[10px]">
            {isManualOverride ? 'Manual override' : 'AI/auto'}
            {prospect.agencyConfidence !== null && prospect.agencyConfidence !== undefined ? ` · ${prospect.agencyConfidence}%` : ''}
          </Badge>
          {prospect.agencyReasoning && (
            <span className="hidden xl:inline text-[11px] text-muted-foreground truncate max-w-[360px]" title={prospect.agencyReasoning}>
              {prospect.agencyReasoning}
            </span>
          )}
        </div>

        {(stagedCompanyMatch?.name || linkedCompany?.name) && (
          <div className="flex items-center gap-2 mt-2 text-xs">
            {linkedCompany?.name ? (
              <a
                href={linkedCompany.companyId ? `/admin/companies/${linkedCompany.companyId}/view` : '/admin/companies'}
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                title="Linked company profile"
              >
                <Building2 className="w-3 h-3" /> Company Linked: {linkedCompany.name}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground" title="Pre-import company match candidate">
                <Building2 className="w-3 h-3" /> Company Match: {stagedCompanyMatch.name}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center flex-wrap gap-2 pt-3 mt-3 border-t border-border/50">
          {showConversationCta ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleOpenConversation} disabled={isOpeningConversation || !prospect.createdContactId}>
              <MessageSquare className="w-4 h-4 text-primary" /> {isOpeningConversation ? 'Opening...' : 'Open Conversation'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleWhatsApp} disabled={!prospect.phone}>
              <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCall} disabled={!prospect.phone}>
            <Phone className="w-4 h-4 text-blue-500" /> Call
          </Button>

          {sellerProfileUrl && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleScrapeSeller} disabled={isScrapingSeller}>
              <DownloadCloud className="w-4 h-4 text-primary" /> {isScrapingSeller ? 'Scraping...' : 'Scrape Other Listings'}
            </Button>
          )}

          {hasAcceptedContact && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => router.push(`/admin/contacts/${prospect.createdContactId}/view`)}
            >
              <Link2 className="w-4 h-4 text-indigo-600" /> Open CRM Contact
            </Button>
          )}

          {isNonPrivateSellerType(effectiveSellerType) && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setIsCompanyDialogOpen(true)}
              disabled={!canLinkCompany}
              title={!isProspectStatusLinkable(prospect.status) ? 'Prospect must be in New/Reviewing status to link company.' : undefined}
            >
              <Building2 className="w-4 h-4 text-emerald-600" /> {(linkedCompany?.companyId ? 'Refresh Company Link' : 'Link As Company')}
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
          ) : reviewState === 'accepted' ? (
            <>
              <Badge variant="default" className="text-xs">Accepted</Badge>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onReject(prospect.id)}
                disabled={isPending}
              >
                <X className="w-4 h-4" /> Mark Rejected
              </Button>
            </>
          ) : (
            <>
              <Badge variant={reviewState === 'rejected' ? 'destructive' : 'outline'} className="text-xs">
                {reviewState === 'rejected' ? 'Rejected' : 'Processed'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onReject(prospect.id)}
                disabled={isPending || reviewState === 'rejected'}
              >
                <X className="w-4 h-4" /> Mark Rejected
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => onAccept(prospect.id)}
                disabled={isPending}
              >
                <Check className="w-4 h-4" /> Mark Accepted
              </Button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Properties ({prospect.scrapedListingsCount})</h3>
          {prospect.scrapedListings && prospect.scrapedListings.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {prospect.scrapedListings.map((listing) => {
                const thumb = listing.thumbnails?.[0] || listing.images?.[0];
                const listingReviewState = resolveProspectingReviewState({
                  listingStatus: listing.status,
                  prospectStatus: prospect.status,
                });
                const isListingNew = listingReviewState === 'new';
                const petsAllowed = listing.rawAttributes
                  ? Object.entries(listing.rawAttributes).find(([key]) => /pet/i.test(key))?.[1]
                  : null;

                return (
                  <div
                    key={listing.id}
                    onClick={() => {
                      const params = new URLSearchParams(window.location.search);
                      params.set('view', 'properties');
                      params.set('listingId', listing.id);
                      params.set('prospectId', prospect.id);
                      params.set('scope', 'all');
                      params.delete('contactId');
                      params.delete('q');
                      router.push(`?${params.toString()}`);
                    }}
                    className={`rounded-lg border bg-background overflow-hidden transition-all cursor-pointer hover:ring-2 hover:ring-primary/30 hover:shadow-md ${(!isListingNew || listing.isExpired) ? 'opacity-60' : ''}`}
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
                        {listing.bathrooms !== null && <Badge variant="outline" className="text-[10px]">{listing.bathrooms}Bath</Badge>}
                        {listing.propertyArea !== null && <Badge variant="outline" className="text-[10px]">{listing.propertyArea}m²</Badge>}
                        {petsAllowed && <Badge variant="outline" className="text-[10px]">Pets {String(petsAllowed)}</Badge>}
                        {listing.isExpired && (
                          <Badge variant="destructive" className="bg-slate-800 text-white hover:bg-slate-800 text-[9px]">Expired</Badge>
                        )}
                        {listingReviewState !== 'new' && (
                          <Badge variant={listingReviewState === 'accepted' ? 'default' : 'destructive'} className="text-[9px]">
                            {listingReviewState === 'accepted' ? 'Accepted' : listingReviewState === 'rejected' ? 'Rejected' : listing.status}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{listing.locationText || 'Cyprus'}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[11px] text-primary font-medium">Open Details →</span>
                        {listing.importedPropertyId && (
                          <a
                            href={`/admin/properties/${listing.importedPropertyId}/view`}
                            className="text-[11px] text-indigo-700 flex items-center gap-1 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Open Property <Link2 className="w-2.5 h-2.5" />
                          </a>
                        )}
                        <a href={listing.url} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground flex items-center gap-1 hover:underline hover:text-primary" onClick={(event) => event.stopPropagation()}>
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
