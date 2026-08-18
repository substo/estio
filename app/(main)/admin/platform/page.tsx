import Link from "next/link";
import { Building2, ContactRound, House, UsersRound } from "lucide-react";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PAGE_SIZE = 20;

function formatActivity(value: Date | null | undefined) {
  if (!value) return "No recorded activity";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}

export default async function AdminPlatformPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const query = String(params.q || "").trim().slice(0, 100);
  const requestedPage = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const where = query ? { name: { contains: query, mode: "insensitive" as const } } : {};

  const [totalLocations, totalMemberships, totalContacts, totalProperties, filteredLocations] = await Promise.all([
    db.location.count(),
    db.userLocationRole.count(),
    db.contact.count(),
    db.property.count(),
    db.location.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(filteredLocations / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const locations = await db.location.findMany({
    where,
    orderBy: [{ isPlatformMaster: "desc" }, { name: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      name: true,
      isPlatformMaster: true,
      _count: { select: { contacts: true, properties: true } },
    },
  });
  const locationIds = locations.map((location) => location.id);
  const [memberCounts, activities] = await Promise.all([
    Promise.all(locations.map((location) => db.userLocationRole.count({
      where: {
        locationId: location.id,
        user: { locations: { some: { id: location.id } } },
      },
    }))),
    locationIds.length ? db.locationSessionActivity.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locationIds } },
      _max: { lastSeenAt: true },
    }) : Promise.resolve([]),
  ]);
  const activityByLocation = new Map(activities.map((entry) => [entry.locationId, entry._max.lastSeenAt]));
  const pageHref = (target: number) => `/admin/platform?page=${target}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const stats = [
    { label: "Locations", value: totalLocations, icon: Building2 },
    { label: "Memberships", value: totalMemberships, icon: UsersRound },
    { label: "Contacts", value: totalContacts, icon: ContactRound },
    { label: "Properties", value: totalProperties, icon: House },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-2 sm:p-4">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Estio</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Platform overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">A simple location-level snapshot. More platform metrics can be added here later.</p>
      </div>

      <section aria-label="Platform totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p></CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-4" aria-labelledby="location-breakdown-heading">
        <div>
          <h2 id="location-breakdown-heading" className="text-xl font-semibold">Location breakdown</h2>
          <p className="text-sm text-muted-foreground">Aggregate operational counts only; no tenant content is displayed.</p>
        </div>
        <form method="get" className="flex max-w-xl gap-2" role="search">
          <label htmlFor="platform-location-search" className="sr-only">Search locations</label>
          <input id="platform-location-search" name="q" defaultValue={query} placeholder="Search locations" className="min-h-11 flex-1 rounded-md border bg-background px-3 text-sm" />
          <Button type="submit">Search</Button>
        </form>
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Platform location statistics</caption>
            <thead className="bg-muted/50 text-left">
              <tr><th className="p-3">Location</th><th className="p-3">Members</th><th className="p-3">Contacts</th><th className="p-3">Properties</th><th className="p-3">Recent activity (UTC)</th></tr>
            </thead>
            <tbody>
              {locations.map((location, index) => (
                <tr key={location.id} className="border-t">
                  <td className="p-3 font-medium">
                    {location.name || "Unnamed location"}
                    {location.isPlatformMaster ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Master</span> : null}
                  </td>
                  <td className="p-3 tabular-nums">{memberCounts[index].toLocaleString()}</td>
                  <td className="p-3 tabular-nums">{location._count.contacts.toLocaleString()}</td>
                  <td className="p-3 tabular-nums">{location._count.properties.toLocaleString()}</td>
                  <td className="p-3 text-muted-foreground">{formatActivity(activityByLocation.get(location.id))}</td>
                </tr>
              ))}
              {locations.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No locations found.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <nav aria-label="Location pages" className="flex items-center justify-between gap-3">
          <Button asChild variant="outline" aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}><Link href={pageHref(page - 1)}>Previous</Link></Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button asChild variant="outline" aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none opacity-50" : ""}><Link href={pageHref(page + 1)}>Next</Link></Button>
        </nav>
      </section>
    </div>
  );
}
