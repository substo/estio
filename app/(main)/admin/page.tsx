import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { GlobalAiUsageWidget } from "./_components/global-ai-usage-widget";
import { Card, CardContent } from "@/components/ui/card";

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to the Estio Dashboard.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/admin/analytics" className="group block">
          <Card className="h-full transition-colors hover:border-gray-400">
            <CardContent className="flex h-full items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-base font-semibold">Analytics</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Review visitors, sessions, listing views, traffic sources, leads, and admin usage.
                </p>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <GlobalAiUsageWidget />
    </div>
  );
}
