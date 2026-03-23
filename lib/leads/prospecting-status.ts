import { normalizeProspectStatus } from './prospect-status';

export type ProspectingReviewState = 'new' | 'accepted' | 'rejected' | 'processed';

export function normalizeScrapedListingStatus(status: string | null | undefined): string {
  return String(status || '').trim().toUpperCase();
}

export function isOpenScrapedListingStatus(status: string | null | undefined): boolean {
  const normalized = normalizeScrapedListingStatus(status);
  return normalized === 'NEW' || normalized === 'REVIEWING';
}

export function isAcceptedScrapedListingStatus(status: string | null | undefined): boolean {
  return normalizeScrapedListingStatus(status) === 'IMPORTED';
}

export function isRejectedScrapedListingStatus(status: string | null | undefined): boolean {
  return normalizeScrapedListingStatus(status) === 'REJECTED';
}

export function resolveProspectingReviewState(input: {
  listingStatus?: string | null;
  prospectStatus?: string | null;
}): ProspectingReviewState {
  const prospectStatus = normalizeProspectStatus(input.prospectStatus || null);
  if (prospectStatus === 'accepted') return 'accepted';
  if (prospectStatus === 'rejected') return 'rejected';

  if (isAcceptedScrapedListingStatus(input.listingStatus || null)) return 'accepted';
  if (isRejectedScrapedListingStatus(input.listingStatus || null)) return 'rejected';
  if (isOpenScrapedListingStatus(input.listingStatus || null)) return 'new';

  return 'processed';
}
