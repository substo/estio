"use client";

import { Loader2, Settings2 } from "lucide-react";
import { AVAILABLE_TASK_REMINDER_OFFSETS_MINUTES, reminderOffsetLabel } from "@/lib/tasks/reminder-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { NotificationFeatureFlagsState, NotificationPreferenceDraft } from "@/components/notifications/use-notification-preferences";

type NotificationPreferencesCardProps = {
  draft: NotificationPreferenceDraft;
  setDraft: React.Dispatch<React.SetStateAction<NotificationPreferenceDraft>>;
  toggleOffset: (offset: number, checked: boolean) => void;
  savePreferences: () => Promise<{ success: boolean }>;
  savingPreferences: boolean;
  featureFlags?: NotificationFeatureFlagsState;
};

export function NotificationPreferencesCard({
  draft,
  setDraft,
  toggleOffset,
  savePreferences,
  savingPreferences,
  featureFlags,
}: NotificationPreferencesCardProps) {
  if (featureFlags?.reminderUi === false) {
    return (
      <Card className="opacity-70">
        <CardHeader>
          <CardTitle>Reminder Preferences</CardTitle>
          <CardDescription>
            Reminder settings are disabled for this environment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Settings2 className="h-5 w-5 text-slate-500" />
          Reminder Preferences
          {savingPreferences ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
        </CardTitle>
        <CardDescription>
          Configure how your assigned task deadlines generate reminders. The bell remains your inbox; this page is the source of truth for settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Enable reminders</Label>
              <p className="text-xs text-muted-foreground">
                Master switch for all deadline reminders on tasks assigned to you.
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">In-app reminders</Label>
              <p className="text-xs text-muted-foreground">
                Show reminder items in the admin bell and realtime inbox.
              </p>
            </div>
            <Switch
              checked={draft.inAppEnabled}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, inAppEnabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Allow web push</Label>
              <p className="text-xs text-muted-foreground">
                Let subscribed browsers receive push deliveries for your reminders.
              </p>
            </div>
            <Switch
              checked={draft.webPushEnabled}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, webPushEnabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Quiet hours</Label>
              <p className="text-xs text-muted-foreground">
                Defer reminders that land inside your quiet-hours window.
              </p>
            </div>
            <Switch
              checked={draft.quietHoursEnabled}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, quietHoursEnabled: checked }))}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="notifications-quiet-start">Quiet hours start (0-23)</Label>
            <Input
              id="notifications-quiet-start"
              type="number"
              min={0}
              max={23}
              value={draft.quietHoursStartHour}
              onChange={(event) => setDraft((current) => ({
                ...current,
                quietHoursStartHour: Math.max(0, Math.min(23, Number(event.target.value || 0))),
              }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notifications-quiet-end">Quiet hours end (0-23)</Label>
            <Input
              id="notifications-quiet-end"
              type="number"
              min={0}
              max={23}
              value={draft.quietHoursEndHour}
              onChange={(event) => setDraft((current) => ({
                ...current,
                quietHoursEndHour: Math.max(0, Math.min(23, Number(event.target.value || 0))),
              }))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Default reminder timing</Label>
            <p className="text-xs text-muted-foreground">
              These offsets apply when a task uses `default` reminder mode. Custom task reminders override them.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {AVAILABLE_TASK_REMINDER_OFFSETS_MINUTES.map((offset) => (
              <label
                key={offset}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <Checkbox
                  checked={draft.defaultOffsets.includes(offset)}
                  onCheckedChange={(checked) => toggleOffset(offset, checked === true)}
                />
                <span>{reminderOffsetLabel(offset)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/10 dark:text-blue-300">
          Reminders are created only for open tasks that have both an assignee and a due date.
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={() => void savePreferences()} disabled={savingPreferences}>
            {savingPreferences ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save preferences
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
