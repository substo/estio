import Link from 'next/link';
import db from '@/lib/db';
import { getActiveContactsAccess } from '@/lib/contacts/active-location-access';
import { selectLocationRows } from '@/lib/location-backup/service';
import { buildLocationClearPreview, LOCATION_CLEAR_MODELS } from '@/lib/location-clear/preview';
import { ResetAnalyticsCard } from './reset-analytics-card';

const storedMediaExamples = [
  'Property photos',
  'Contact and deal documents',
  'Message attachments',
  'Voice notes and recordings',
  'Generated or imported media',
] as const;

const connectedServices = [
  {
    name: 'GoHighLevel',
    description: 'May contain contacts, conversations, appointments, tasks, and property information.',
    note: 'External copies are kept unless separately removed from GoHighLevel.',
    links: [{ href: '/admin/settings/integrations/ghl', label: 'Review GoHighLevel connection' }],
  },
  {
    name: 'Google Workspace',
    description: 'May contain contacts, calendar events, tasks, Gmail messages, or synchronized information.',
    note: 'External copies are kept unless separately removed from Google.',
    links: [{ href: '/admin/settings/integrations/google', label: 'Review Google connection' }],
  },
  {
    name: 'Microsoft Outlook',
    description: 'May contain contacts, calendar events, and email.',
    note: 'External copies are kept unless separately removed from Microsoft.',
    links: [{ href: '/admin/settings/integrations/microsoft', label: 'Review Microsoft connection' }],
  },
  {
    name: 'WhatsApp',
    description: 'Messages remain in the connected WhatsApp account and linked devices.',
    note: 'Removing Estio data does not erase the user’s WhatsApp history.',
    links: [{ href: '/admin/settings/integrations/whatsapp', label: 'Review WhatsApp connection' }],
  },
  {
    name: 'Property feeds and prospecting imports',
    description: 'Active feeds, scraping, or imports may add records back to Estio.',
    note: 'Review each source before removing information from Estio.',
    links: [
      { href: '/admin/settings/prospecting', label: 'Review automatic imports' },
      { href: '/admin/settings/integrations/provider-sync', label: 'Review property feed connections' },
    ],
  },
] as const;

export const dynamic = 'force-dynamic';

export default async function LocationDataPage() {
  const access = await getActiveContactsAccess();
  if (!access || access.role !== 'ADMIN') {
    return <div className="p-6">A current ADMIN role is required.</div>;
  }

  const location = await db.location.findUnique({
    where: { id: access.locationId },
    select: { id: true, name: true },
  });
  if (!location) return <div className="p-6">Location not found.</div>;

  const selected = await selectLocationRows(db, location.id, LOCATION_CLEAR_MODELS);
  const rowCounts = Object.fromEntries(
    [...selected.entries()].map(([model, rows]) => [model, rows.size]),
  );
  const preview = buildLocationClearPreview(rowCounts);
  const [events, sessions, visitors, dailyRollups] = await Promise.all([
    db.analyticsEvent.count({ where: { locationId: location.id } }),
    db.analyticsSession.count({ where: { locationId: location.id } }),
    db.analyticsVisitor.count({ where: { locationId: location.id } }),
    db.analyticsDailyRollup.count({ where: { locationId: location.id } }),
  ]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Location data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and manage the information belonging to {location.name || 'this location'}. Some information is stored in Estio, while connected services may keep their own copies.
        </p>
      </div>

      <ResetAnalyticsCard counts={{ events, sessions, visitors, dailyRollups }} />

      <section className="rounded-lg border p-4 sm:p-5" aria-labelledby="business-data-heading">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h2 id="business-data-heading" className="text-lg font-semibold">Business information in Estio</h2>
          <p className="text-sm text-muted-foreground" aria-label={`${preview.totalRows.toLocaleString()} total records in this preview`}>
            <span className="font-mono font-semibold text-foreground">{preview.totalRows.toLocaleString()}</span> total records
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          These counts show Estio records and references grouped by the work they support.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {preview.groups.map((group) => (
            <article key={group.key} className="rounded-md border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium">{group.label}</h3>
                <span
                  className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold"
                  aria-label={`${group.count.toLocaleString()} records in ${group.label}`}
                >
                  {group.count.toLocaleString()} items
                </span>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {group.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </article>
          ))}
        </div>
        <p className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
          Full business-data deletion is not available from this page yet. Nothing in this section will be deleted unless a separate deletion feature is added and confirmed later.
        </p>
      </section>

      <section className="rounded-lg border p-4 sm:p-5" aria-labelledby="files-media-heading">
        <h2 id="files-media-heading" className="text-lg font-semibold">Files and media</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Photos, documents, voice notes, and message attachments may be stored separately from their Estio records. Deleting a record does not always delete the original uploaded file.
        </p>
        <ul className="mt-3 grid list-disc gap-x-8 gap-y-1 pl-5 text-sm sm:grid-cols-2">
          {storedMediaExamples.map((example) => <li key={example}>{example}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          The preview above counts Estio records or media references, not every uploaded file.
        </p>
        <Link href="/admin/settings/media" className="mt-4 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline">
          Manage stored media
        </Link>
      </section>

      <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5" aria-labelledby="connected-services-heading">
        <h2 id="connected-services-heading" className="text-lg font-semibold text-amber-950">Connected services and automatic imports</h2>
        <p className="mt-2 text-sm text-amber-950">
          <span className="font-semibold">Important:</span> Connected services may keep their own copies of contacts, messages, calendar events, tasks, or property information. They may also add information back to Estio after a reset.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {connectedServices.map((service) => (
            <article key={service.name} className="rounded-md border border-amber-200 bg-white p-4">
              <h3 className="font-medium text-amber-950">{service.name}</h3>
              <p className="mt-2 text-sm text-amber-950">{service.description}</p>
              <p className="mt-1 text-sm text-amber-900">{service.note}</p>
              <div className="mt-3 flex flex-col items-start gap-2">
                {service.links.map((link) => (
                  <Link key={link.href} href={link.href} className="text-sm font-medium text-amber-950 underline underline-offset-4 hover:no-underline focus-visible:no-underline">
                    {link.label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-4 sm:p-5" aria-labelledby="retained-heading">
        <h2 id="retained-heading" className="text-lg font-semibold">Account and settings kept safe</h2>
        <ul className="mt-3 grid list-disc gap-x-8 gap-y-2 pl-5 text-sm sm:grid-cols-2">
          {preview.retained.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      </section>
    </main>
  );
}
