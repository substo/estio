import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, LineChart, MousePointerClick, Search, UsersRound } from "lucide-react";
import { getAnalyticsDashboard, parseAnalyticsRange } from "@/lib/analytics/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@clerk/nextjs/server";

type PageProps = {
  searchParams: Promise<{ range?: string }>;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function StatCard({
  title,
  value,
  caption,
  icon: Icon,
}: {
  title: string;
  value: string;
  caption: string;
  icon: typeof UsersRound;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
          <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function RangeLink({ range, active }: { range: 7 | 30 | 90; active: boolean }) {
  return (
    <Link
      href={`/admin/analytics?range=${range}`}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-gray-900 text-white" : "text-muted-foreground hover:bg-muted"}`}
    >
      {range}d
    </Link>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{label}</div>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;
  const range = parseAnalyticsRange(params.range);
  const dashboard = await getAnalyticsDashboard(range);

  if (!dashboard) {
    return (
      <div className="p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Location analytics access required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Location analytics contains business performance and lead conversion data.</p>
            <p>Ask a location administrator to grant you admin access if you need this report.</p>
            <Link href="/admin" className="inline-flex font-medium text-foreground underline underline-offset-4">
              Return to dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const maxDaily = Math.max(...dashboard.daily.map((day) => day.pageViews), 1);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">Analytics</h1>
            <Badge variant="outline">Location-wide</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Business visitors, traffic sources, listings, conversions, and team admin usage.</p>
        </div>
        <nav className="flex rounded-lg border bg-background p-1" aria-label="Analytics date range">
          <RangeLink range={7} active={range === 7} />
          <RangeLink range={30} active={range === 30} />
          <RangeLink range={90} active={range === 90} />
        </nav>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Visitors" value={formatNumber(dashboard.totals.visitors)} caption={`${formatNumber(dashboard.totals.sessions)} sessions`} icon={UsersRound} />
        <StatCard title="Page views" value={formatNumber(dashboard.totals.pageViews)} caption={`${formatNumber(dashboard.totals.propertyViews)} listing views`} icon={LineChart} />
        <StatCard title="Searches" value={formatNumber(dashboard.totals.searches)} caption={`${formatNumber(dashboard.totals.favorites)} favorite actions`} icon={Search} />
        <StatCard title="Inquiries" value={formatNumber(dashboard.totals.inquiries)} caption={`${formatPercent(dashboard.totals.conversionRate)} conversion rate`} icon={MousePointerClick} />
        <StatCard title="Admin usage" value={formatNumber(dashboard.totals.adminEvents)} caption="Admin page and feature events" icon={BarChart3} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.daily.length ? (
              <div className="overflow-x-auto pb-2">
                <div
                  className="flex h-52 items-end gap-2"
                  role="list"
                  aria-label="Daily public page views"
                  style={{ minWidth: `${Math.max(dashboard.daily.length * 32, 640)}px` }}
                >
                  {dashboard.daily.map((day) => (
                    <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2" role="listitem">
                      <span className="sr-only">{formatDate(day.date)}: {formatNumber(day.pageViews)} page views</span>
                      <div className="flex h-40 w-full items-end rounded-md bg-muted/40 px-1" aria-hidden="true">
                        <div
                          className="w-full rounded-sm bg-gray-900"
                          style={{ height: `${Math.max((day.pageViews / maxDaily) * 100, day.pageViews ? 4 : 0)}%` }}
                        />
                      </div>
                      <span className="truncate text-xs text-muted-foreground">{formatDate(day.date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState label="No traffic recorded for this range yet." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.sources.length ? dashboard.sources.map((source) => (
              <div key={`${source.source}:${source.medium}`} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{source.source}</div>
                  <div className="text-xs text-muted-foreground">{source.medium}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{formatNumber(source.sessions)}</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(source.conversions)} conversions</div>
                </div>
              </div>
            )) : <EmptyState label="No source data yet." />}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Properties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.topProperties.length ? dashboard.topProperties.map((property) => (
              <div key={property.propertyId} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{property.title}</div>
                  <div className="text-xs text-muted-foreground">{property.slug || property.propertyId}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant="secondary">{formatNumber(property.views)} views</Badge>
                  <Badge variant={property.inquiries ? "default" : "outline"}>{formatNumber(property.inquiries)} leads</Badge>
                </div>
              </div>
            )) : <EmptyState label="No property analytics yet." />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Pages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.topPages.length ? dashboard.topPages.map((page) => (
              <div key={page.path} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="truncate text-sm font-medium">{page.path}</div>
                <Badge variant="secondary">{formatNumber(page.views)} views</Badge>
              </div>
            )) : <EmptyState label="No page views yet." />}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Conversions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.recentConversions.length ? dashboard.recentConversions.map((event) => (
              <div key={`${event.occurredAt}:${event.eventName}:${event.path}`} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{event.eventName === "lead_inquiry_success" ? "Inquiry" : "Saved search"}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {[event.propertyTitle, event.contactName, event.path].filter(Boolean).join(" · ")}
                </div>
              </div>
            )) : <EmptyState label="No conversions yet." />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.adminUsage.length ? dashboard.adminUsage.map((item) => (
              <div key={item.path} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="truncate text-sm font-medium">{item.path}</div>
                <Badge variant="secondary">{formatNumber(item.events)} events</Badge>
              </div>
            )) : <EmptyState label="No admin usage events yet." />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
