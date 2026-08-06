import Link from "next/link";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const query = String(params.q || "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const where = query ? { name: { contains: query, mode: "insensitive" as const } } : {};
  const [total, locations] = await Promise.all([
    db.location.count({ where }),
    db.location.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true },
    }),
  ]);
  const [memberCounts, activities] = await Promise.all([
    Promise.all(locations.map((location) => db.userLocationRole.count({
      where: { locationId: location.id, user: { locations: { some: { id: location.id } } } },
    }))),
    db.locationSessionActivity.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locations.map((location) => location.id) } },
      _max: { lastSeenAt: true },
    }),
  ]);
  const activityByLocation = new Map(activities.map((entry) => [entry.locationId, entry._max.lastSeenAt]));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (target: number) => `/platform?page=${target}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Platform administration</h1><p className="text-sm text-muted-foreground">Location access overview. Tenant content is not shown.</p></div>
        <Button asChild variant="outline"><Link href="/admin">Open application</Link></Button>
      </div>
      <form method="get" className="flex gap-2" role="search">
        <label htmlFor="platform-location-search" className="sr-only">Search locations</label>
        <input id="platform-location-search" name="q" defaultValue={query} placeholder="Search locations" className="min-h-11 flex-1 rounded-md border bg-background px-3" />
        <Button type="submit">Search</Button>
      </form>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Platform locations and aggregate access activity</caption>
          <thead className="bg-muted/50 text-left"><tr><th className="p-3">Location</th><th className="p-3">Active members</th><th className="p-3">Most recent activity</th><th className="p-3"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {locations.map((location, index) => <tr key={location.id} className="border-t"><td className="p-3 font-medium">{location.name || "Unnamed location"}</td><td className="p-3">{memberCounts[index]}</td><td className="p-3">{activityByLocation.get(location.id)?.toLocaleString() || "No recorded activity"}</td><td className="p-3 text-right"><Button asChild size="sm" variant="outline"><Link href={`/platform/impersonation?locationId=${encodeURIComponent(location.id)}`}>Support access</Link></Button></td></tr>)}
            {locations.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No locations found.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <nav aria-label="Location pages" className="flex items-center justify-between">
        <Button asChild variant="outline" aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}><Link href={pageHref(page - 1)}>Previous</Link></Button>
        <span className="text-sm text-muted-foreground">Page {Math.min(page, totalPages)} of {totalPages}</span>
        <Button asChild variant="outline" aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none opacity-50" : ""}><Link href={pageHref(page + 1)}>Next</Link></Button>
      </nav>
    </main>
  );
}
