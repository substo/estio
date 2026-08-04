import db from '@/lib/db';
import { getActiveContactsAccess } from '@/lib/contacts/active-location-access';
import { selectLocationRows } from '@/lib/location-backup/service';
import { buildLocationClearPreview, LOCATION_CLEAR_MODELS } from '@/lib/location-clear/preview';
import { ResetAnalyticsCard } from './reset-analytics-card';

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
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Clear location data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reset dashboard and business data for {location.name || 'this location'} without replacing the Location.
        </p>
      </div>

      <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        The full location-data preview remains read-only. The separate analytics reset below affects analytics records only. Users, access, settings, domains, and integrations remain unchanged.
      </div>

      <ResetAnalyticsCard counts={{ events, sessions, visitors, dailyRollups }} />

      <section className="rounded-lg border p-4" aria-labelledby="erase-preview-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="erase-preview-heading" className="text-lg font-semibold">Dashboard and business data to reset</h2>
          <span className="font-mono text-sm">{preview.totalRows.toLocaleString()} rows</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Location ID: {location.id}</p>
        <div className="mt-4 divide-y">
          {preview.groups.map((group) => (
            <div key={group.key} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span>{group.label}</span>
              <span className="font-mono">{group.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="retained-heading">
        <h2 id="retained-heading" className="text-lg font-semibold">Would remain under this proposed scope</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {preview.retained.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      </section>

      <section className="rounded-lg border border-red-200 bg-red-50 p-4" aria-labelledby="external-heading">
        <h2 id="external-heading" className="text-lg font-semibold text-red-950">Before reset: prevent automatic re-import</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-red-900">
          {preview.external.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      </section>
    </main>
  );
}
