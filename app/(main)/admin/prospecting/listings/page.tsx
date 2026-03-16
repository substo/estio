import { getLocationContext } from '@/lib/auth/location-context';
import { listScrapedListings, type ScrapedListingScope } from '@/lib/leads/scraped-listing-repository';
import { ScrapedListingTable } from './_components/scraped-listing-table';

export const dynamic = 'force-dynamic';

export default async function ScrapedListingsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const location = await getLocationContext();
  if (!location) return <div>Authentication Error</div>;

  const params = await searchParams;
  const result = await listScrapedListings(location.id, {
    limit: 25,
    skip: parseInt(params.skip || '0'),
    q: params.q,
    source: params.source,
    scope: (params.scope as ScrapedListingScope) || 'new',
  });

  return (
    <div className="w-full">
      <ScrapedListingTable items={result.items} total={result.total} locationId={location.id} />
    </div>
  );
}
