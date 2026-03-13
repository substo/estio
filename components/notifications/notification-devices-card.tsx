"use client";

import { formatDistanceToNow } from "date-fns";
import { Laptop, Loader2, Smartphone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NotificationSubscriptionRecord } from "@/components/notifications/use-notification-preferences";

type NotificationDevicesCardProps = {
  subscriptions: NotificationSubscriptionRecord[];
  currentBrowserEndpoint?: string | null;
  revokingEndpoint?: string | null;
  onRevoke: (endpoint: string) => Promise<{ success: boolean }>;
};

function formatRelative(input?: string | Date | null) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

export function NotificationDevicesCard({
  subscriptions,
  currentBrowserEndpoint,
  revokingEndpoint,
  onRevoke,
}: NotificationDevicesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">My Devices</CardTitle>
        <CardDescription>
          Review the browsers currently registered for web push and revoke ones you no longer use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {subscriptions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No browser subscriptions yet. Enable browser push from this page or from the notification bell.
          </div>
        ) : (
          subscriptions.map((subscription) => {
            const active = String(subscription.status || "").toLowerCase() === "active";
            const isCurrentBrowser = subscription.endpoint === currentBrowserEndpoint;
            const updatedLabel = formatRelative(subscription.updatedAt || null);
            const lastSuccessLabel = formatRelative(subscription.lastSuccessAt || null);
            const lastFailureLabel = formatRelative(subscription.lastFailureAt || null);

            return (
              <div key={subscription.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-2 text-sm font-medium">
                        {subscription.platform?.toLowerCase().includes("iphone") || subscription.platform?.toLowerCase().includes("android") ? (
                          <Smartphone className="h-4 w-4 text-slate-500" />
                        ) : (
                          <Laptop className="h-4 w-4 text-slate-500" />
                        )}
                        {subscription.deviceLabel || subscription.browser || "Browser device"}
                      </span>

                      <Badge variant="outline" className={active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-50 text-zinc-700 border-zinc-200"}>
                        {active ? "Active" : "Inactive"}
                      </Badge>

                      {isCurrentBrowser ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Current browser
                        </Badge>
                      ) : null}
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>
                        {subscription.browser || "Unknown browser"}
                        {subscription.platform ? ` - ${subscription.platform}` : ""}
                      </p>
                      {updatedLabel ? <p>Updated {updatedLabel}</p> : null}
                      {lastSuccessLabel ? <p>Last success {lastSuccessLabel}</p> : null}
                      {lastFailureLabel ? <p>Last failure {lastFailureLabel}</p> : null}
                      {Number(subscription.failureCount || 0) > 0 ? (
                        <p>Failure count: {subscription.failureCount}</p>
                      ) : null}
                    </div>
                  </div>

                  {active ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onRevoke(subscription.endpoint)}
                      disabled={revokingEndpoint === subscription.endpoint}
                    >
                      {revokingEndpoint === subscription.endpoint ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
