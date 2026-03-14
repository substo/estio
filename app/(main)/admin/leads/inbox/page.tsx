import { getLocationContext } from '@/lib/auth/location-context';
import { listProspectInbox, type ProspectInboxScope } from '@/lib/leads/prospect-repository';
import { ProspectInboxFilters } from './_components/prospect-inbox-filters';
import { ProspectInboxTable } from './_components/prospect-inbox-table';

export const dynamic = 'force-dynamic';

export default async function LeadInboxPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const location = await getLocationContext();
  if (!location) return <div>Authentication Error</div>;

  const params = await searchParams;
  const result = await listProspectInbox(location.id, {
    limit: 25,
    skip: parseInt(params.skip || '0'),
    q: params.q,
    source: params.source,
    scope: (params.scope as ProspectInboxScope) || 'new',
  });

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-2">Lead Inbox</h1>
      <p className="text-muted-foreground mb-6">Review and triage discovered prospects before CRM entry.</p>
      
      <ProspectInboxFilters />
      
      <div className="mt-6">
        <ProspectInboxTable items={result.items} total={result.total} locationId={location.id} />
      </div>
    </div>
  );
}
