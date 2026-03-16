import { getLocationContext } from '@/lib/auth/location-context';
import { listProspectInbox, type ProspectInboxScope } from '@/lib/leads/prospect-repository';
import { listScrapedListings } from '@/lib/leads/scraped-listing-repository';
import { ProspectingSplitView } from './_components/prospecting-split-view';

export const dynamic = 'force-dynamic';

export default async function ProspectingHubPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const location = await getLocationContext();
  if (!location) return <div>Authentication Error</div>;

  const params = await searchParams;
  const prospectId = params.prospectId;

  // Fetch leads for the left pane
  const prospectsResult = await listProspectInbox(location.id, {
    limit: 25,
    skip: parseInt(params.skip || '0'),
    q: params.q,
    source: params.source,
    scope: (params.scope as ProspectInboxScope) || 'new',
  });

  // Fetch listings: filtered by prospect when selected, or ALL listings by default
  const listingsResult = await listScrapedListings(location.id, {
    ...(prospectId ? { prospectLeadId: prospectId, scope: 'all' as const } : { scope: 'new' as const }),
    limit: 50,
  });

  return (
    <div className="h-full flex flex-col">
      <ProspectingSplitView 
        prospects={prospectsResult.items} 
        prospectsTotal={prospectsResult.total}
        listings={listingsResult.items as any}
        listingsTotal={listingsResult.total}
        selectedProspectId={prospectId}
        locationId={location.id}
      />
    </div>
  );
}
