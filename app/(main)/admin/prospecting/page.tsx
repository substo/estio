import { getLocationContext } from '@/lib/auth/location-context';
import { listProspectInbox, type ProspectInboxScope } from '@/lib/leads/prospect-repository';
import { listScrapedListings } from '@/lib/leads/scraped-listing-repository';
import { ProspectingTriageView } from './_components/prospecting-triage-view';

export const dynamic = 'force-dynamic';

export default async function ProspectingHubPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const location = await getLocationContext();
  if (!location) return <div>Authentication Error</div>;

  const params = await searchParams;
  const prospectId = params.prospectId;
  const scope = (params.scope as 'new' | 'all') || 'new';
  const view = (params.view as 'properties' | 'contacts') || 'properties';

  // Fetch prospects (used for both Contacts view and seller filter dropdown)
  const prospectsResult = await listProspectInbox(location.id, {
    limit: 100,
    scope: scope as ProspectInboxScope,
    q: view === 'contacts' ? params.q : undefined,
  });

  // Fetch listings with filters (for Properties view)
  const listingsResult = await listScrapedListings(location.id, {
    ...(prospectId ? { prospectLeadId: prospectId } : {}),
    scope,
    q: view === 'properties' ? params.q : undefined,
    limit: 100,
  });

  return (
    <ProspectingTriageView
      listings={listingsResult.items as any}
      listingsTotal={listingsResult.total}
      prospects={prospectsResult.items}
      prospectsTotal={prospectsResult.total}
      locationId={location.id}
      selectedProspectId={prospectId}
      initialView={view}
    />
  );
}
