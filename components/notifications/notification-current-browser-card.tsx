"use client";

import { BellRing, CheckCircle2, Laptop, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NotificationFeatureFlagsState, NotificationSubscriptionRecord } from "@/components/notifications/use-notification-preferences";

type NotificationCurrentBrowserCardProps = {
  compact?: boolean;
  featureFlags?: NotificationFeatureFlagsState;
  browserSupported: boolean;
  pushPermission: string;
  pushEnabledForCurrentBrowser: boolean;
  activePushDeviceCount: number;
  currentBrowserSubscription?: NotificationSubscriptionRecord | null;
  managingBrowserPush: boolean;
  onEnable: () => Promise<{ success: boolean }>;
  onDisable: () => Promise<{ success: boolean }>;
};

function getStatusLabel(args: {
  featureFlags?: NotificationFeatureFlagsState;
  browserSupported: boolean;
  pushPermission: string;
  pushEnabledForCurrentBrowser: boolean;
  activePushDeviceCount: number;
}) {
  if (!args.browserSupported) {
    return "This browser does not support push notifications.";
  }
  if (args.featureFlags?.webPush === false) {
    return "Web push is disabled for this environment.";
  }
  if (args.pushEnabledForCurrentBrowser) {
    return args.activePushDeviceCount > 1
      ? `Enabled on this browser and ${args.activePushDeviceCount - 1} other device${args.activePushDeviceCount - 1 === 1 ? "" : "s"}.`
      : "Enabled on this browser.";
  }
  if (args.pushPermission === "denied") {
    return "Browser notifications are blocked. Re-enable them from your browser site settings.";
  }
  if (args.pushPermission === "granted") {
    return "Permission is granted, but this browser is not currently subscribed.";
  }
  return "Enable browser notifications from an explicit click.";
}

function getBadgeTone(args: {
  browserSupported: boolean;
  featureFlags?: NotificationFeatureFlagsState;
  pushPermission: string;
  pushEnabledForCurrentBrowser: boolean;
}) {
  if (!args.browserSupported || args.featureFlags?.webPush === false || args.pushPermission === "denied") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (args.pushEnabledForCurrentBrowser) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  return "bg-blue-50 text-blue-700 border-blue-200";
}

export function NotificationCurrentBrowserCard({
  compact = false,
  featureFlags,
  browserSupported,
  pushPermission,
  pushEnabledForCurrentBrowser,
  activePushDeviceCount,
  currentBrowserSubscription,
  managingBrowserPush,
  onEnable,
  onDisable,
}: NotificationCurrentBrowserCardProps) {
  const statusText = getStatusLabel({
    featureFlags,
    browserSupported,
    pushPermission,
    pushEnabledForCurrentBrowser,
    activePushDeviceCount,
  });

  const actionButton = pushEnabledForCurrentBrowser ? (
    <Button type="button" variant="outline" size="sm" onClick={() => void onDisable()} disabled={managingBrowserPush}>
      {managingBrowserPush ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
      Disable
    </Button>
  ) : (
    <Button
      type="button"
      size="sm"
      onClick={() => void onEnable()}
      disabled={managingBrowserPush || !browserSupported || featureFlags?.webPush === false}
    >
      {managingBrowserPush ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
      Enable
    </Button>
  );

  if (compact) {
    return (
      <div className="rounded-lg border bg-slate-50/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Laptop className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium">This browser</span>
              <Badge variant="outline" className={getBadgeTone({ browserSupported, featureFlags, pushPermission, pushEnabledForCurrentBrowser })}>
                {pushEnabledForCurrentBrowser ? "Enabled" : pushPermission === "denied" ? "Blocked" : !browserSupported ? "Unsupported" : "Not enabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{statusText}</p>
            {currentBrowserSubscription?.deviceLabel ? (
              <p className="text-[11px] text-slate-600">{currentBrowserSubscription.deviceLabel}</p>
            ) : null}
          </div>
          {actionButton}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <BellRing className="h-5 w-5 text-slate-500" />
          This Browser
        </CardTitle>
        <CardDescription>
          Manage web push on the browser you are using right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={getBadgeTone({ browserSupported, featureFlags, pushPermission, pushEnabledForCurrentBrowser })}>
                {pushEnabledForCurrentBrowser ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Enabled
                  </span>
                ) : pushPermission === "denied" ? (
                  <span className="inline-flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Blocked
                  </span>
                ) : !browserSupported ? "Unsupported" : "Not enabled"}
              </Badge>
              {currentBrowserSubscription?.browser || currentBrowserSubscription?.platform ? (
                <Badge variant="outline" className="bg-white">
                  {currentBrowserSubscription?.browser || "Browser"}
                  {currentBrowserSubscription?.platform ? ` - ${currentBrowserSubscription.platform}` : ""}
                </Badge>
              ) : null}
            </div>

            <p className="text-sm text-muted-foreground">{statusText}</p>

            {currentBrowserSubscription?.deviceLabel ? (
              <p className="text-xs text-slate-600">
                Device: {currentBrowserSubscription.deviceLabel}
              </p>
            ) : null}
          </div>

          {actionButton}
        </div>

        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/10 dark:text-blue-300">
          Browser permission is requested only when you click Enable.
        </div>
      </CardContent>
    </Card>
  );
}
