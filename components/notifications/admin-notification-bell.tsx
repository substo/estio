"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  BellDot,
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  getNotificationSnapshot,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(main)/admin/notifications/actions";
import { NotificationCurrentBrowserCard } from "@/components/notifications/notification-current-browser-card";
import { useNotificationPreferences } from "@/components/notifications/use-notification-preferences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type NotificationItem = any;

function formatNotificationTime(input?: string | Date | null) {
  if (!input) return null;
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return null;
  return formatDistanceToNow(value, { addSuffix: true });
}

function getNotificationStatusTone(notification: NotificationItem) {
  if (!notification.readAt) return "border-blue-200 bg-blue-50/60";
  return "border-slate-200 bg-white";
}

export function AdminNotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<{
    unreadCount: number;
    notifications: NotificationItem[];
    featureFlags?: {
      reminderUi?: boolean;
      notificationSse?: boolean;
      webPush?: boolean;
    };
  } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastToastNotificationIdRef = useRef<string | null>(null);
  const notificationPreferences = useNotificationPreferences();

  const refreshSnapshot = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const nextSnapshot = await getNotificationSnapshot(30, false);
      setSnapshot(nextSnapshot);
    } catch (error) {
      console.error("[notifications] Failed to refresh bell snapshot:", error);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot(true);
  }, [refreshSnapshot]);

  useEffect(() => {
    if (!snapshot?.featureFlags?.notificationSse) return;

    const eventSource = new EventSource("/api/notifications/events");
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("notification", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data || "{}");
        const payload = parsed?.payload || {};
        const notificationId = String(payload.notificationId || "");

        if (notificationId && notificationId !== lastToastNotificationIdRef.current) {
          lastToastNotificationIdRef.current = notificationId;
          const title = String(payload.title || "Task reminder");
          const body = String(payload.body || "");
          const deepLinkUrl = String(payload.deepLinkUrl || "");

          toast(title, {
            description: body || undefined,
            action: deepLinkUrl
              ? {
                  label: "Open",
                  onClick: () => {
                    void markNotificationReadAction(notificationId, true);
                    router.push(deepLinkUrl);
                  },
                }
              : undefined,
          });
        }
      } catch (error) {
        console.warn("[notifications] Failed to process realtime event:", error);
      }

      void refreshSnapshot(false);
    });

    eventSource.addEventListener("error", () => {
      eventSource.close();
    });

    return () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };
  }, [refreshSnapshot, router, snapshot?.featureFlags?.notificationSse]);

  const openNotification = useCallback(async (notification: NotificationItem) => {
    const deepLinkUrl = String(notification?.deepLinkUrl || "").trim();
    if (!notification?.id) return;

    try {
      await markNotificationReadAction(notification.id, true);
      setSnapshot((current) => {
        if (!current) return current;
        const nextNotifications = current.notifications.map((item) => (
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString(), clickedAt: new Date().toISOString() }
            : item
        ));
        const nextUnread = nextNotifications.filter((item) => !item.readAt).length;
        return {
          ...current,
          unreadCount: nextUnread,
          notifications: nextNotifications,
        };
      });
    } catch (error) {
      console.error("[notifications] Failed to mark notification as clicked:", error);
    }

    setOpen(false);
    if (deepLinkUrl) {
      router.push(deepLinkUrl);
    }
  }, [router]);

  useEffect(() => {
    if (!open) return;
    void refreshSnapshot(false);
    void notificationPreferences.refreshSettings(false);
  }, [notificationPreferences.refreshSettings, open, refreshSnapshot]);

  const unreadCount = snapshot?.unreadCount || 0;
  const notificationCountLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const reminderUiEnabled = (snapshot?.featureFlags?.reminderUi ?? notificationPreferences.featureFlags.reminderUi) !== false;

  if (!reminderUiEnabled) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative h-9 w-9">
          {unreadCount > 0 ? <BellDot className="h-4.5 w-4.5" /> : <Bell className="h-4.5 w-4.5" />}
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-blue-600 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
              {notificationCountLabel}
            </span>
          ) : null}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Task reminders</div>
            <div className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread reminder${unreadCount === 1 ? "" : "s"}` : "No unread reminders"}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => {
              void markAllNotificationsReadAction().then(() => refreshSnapshot(false));
            }}
            disabled={unreadCount === 0}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Mark all read
          </Button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-4">
          <div className="space-y-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Quick actions</div>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                  <Link href="/admin/settings/notifications" onClick={() => setOpen(false)}>
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Manage settings
                  </Link>
                </Button>
              </div>

              <NotificationCurrentBrowserCard
                compact
                featureFlags={notificationPreferences.featureFlags}
                browserSupported={notificationPreferences.browserSupported}
                pushPermission={notificationPreferences.pushPermission}
                pushEnabledForCurrentBrowser={notificationPreferences.pushEnabledForCurrentBrowser}
                activePushDeviceCount={notificationPreferences.activePushDeviceCount}
                currentBrowserSubscription={notificationPreferences.currentBrowserSubscription}
                managingBrowserPush={notificationPreferences.managingBrowserPush}
                onEnable={notificationPreferences.enableCurrentBrowserPush}
                onDisable={notificationPreferences.disableCurrentBrowserPush}
              />

              <p className="text-[11px] text-muted-foreground">
                Update quiet hours, default reminder timing, and delivery preferences from notification settings.
              </p>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Recent reminders</div>
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
              </div>

              {snapshot?.notifications?.length ? (
                <div className="space-y-2">
                  {snapshot.notifications.map((notification) => {
                    const createdLabel = formatNotificationTime(notification.createdAt);
                    const channelLabels = Array.isArray(notification.deliveries)
                      ? notification.deliveries
                          .filter((delivery: any) => String(delivery?.status || "").toLowerCase() === "delivered")
                          .map((delivery: any) => delivery.channel === "web_push" ? "Push" : "In-app")
                      : [];

                    return (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => void openNotification(notification)}
                        className={cn(
                          "w-full rounded-lg border p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50",
                          getNotificationStatusTone(notification)
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">{notification.title}</span>
                              {!notification.readAt ? (
                                <Badge variant="outline" className="h-5 border-blue-200 bg-blue-100 text-[10px] text-blue-700">
                                  Unread
                                </Badge>
                              ) : null}
                            </div>

                            <p className="text-xs text-muted-foreground">{notification.body}</p>

                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              {notification.task?.dueAt ? (
                                <span className="inline-flex items-center gap-1">
                                  <Clock3 className="h-3 w-3" />
                                  Due {new Date(notification.task.dueAt).toLocaleString()}
                                </span>
                              ) : null}
                              {createdLabel ? <span>{createdLabel}</span> : null}
                              {channelLabels.map((label: string) => (
                                <Badge key={`${notification.id}-${label}`} variant="outline" className="h-5 bg-white text-[10px]">
                                  {label}
                                </Badge>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                              {notification.task?.title ? <span>Task: {notification.task.title}</span> : null}
                              {notification.contact?.name ? <span>Contact: {notification.contact.name}</span> : null}
                            </div>
                          </div>

                          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No reminders yet. Deadline reminders will appear here once a task has a due date and assignee.
                </div>
              )}
            </section>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
