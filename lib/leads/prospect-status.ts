export const LINKABLE_PROSPECT_STATUSES = new Set(['new', 'reviewing']);

export function normalizeProspectStatus(status: string | null | undefined): string {
  return String(status || '').trim().toLowerCase();
}

export function isProspectStatusLinkable(status: string | null | undefined): boolean {
  return LINKABLE_PROSPECT_STATUSES.has(normalizeProspectStatus(status));
}
