"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type PlatformLocationDeletionSummary = {
  id: string;
  name: string;
  isPlatformMaster: boolean;
  users: Array<{ id: string; label: string; email: string }>;
  counts: {
    contacts: number;
    properties: number;
    companies: number;
    projects: number;
    conversations: number;
    pages: number;
    posts: number;
    mediaAssets: number;
    retainedAudits: number;
    externalResources: number;
  };
};

export function DeleteLocationDialog({ location }: { location: PlatformLocationDeletionSummary }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [pending, setPending] = useState(false);
  const blockedReason = location.isPlatformMaster
    ? "The platform master location is protected."
    : location.counts.retainedAudits > 0
      ? "Retained audit history prevents deletion."
      : location.counts.mediaAssets > 0
        ? "Remove this location's media assets before deleting it."
        : location.counts.externalResources > 0
          ? "Disconnect integrations and release active domains before deleting this location."
          : null;
  const canDelete = !blockedReason && confirmationName.trim() === location.name && !pending;
  const contentCounts = [
    ["contacts", location.counts.contacts],
    ["properties", location.counts.properties],
    ["companies", location.counts.companies],
    ["projects", location.counts.projects],
    ["conversations", location.counts.conversations],
    ["pages", location.counts.pages],
    ["posts", location.counts.posts],
  ] as const;

  async function handleDelete() {
    if (!canDelete) return;
    setPending(true);
    try {
      const response = await fetch(`/api/platform/locations/${encodeURIComponent(location.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationName }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The location could not be deleted.");
      setOpen(false);
      setConfirmationName("");
      toast({
        title: "Location deleted",
        description: `${location.name} and its tenant data were permanently removed. Linked user accounts were detached, not deleted.`,
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "The location could not be deleted.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setConfirmationName("");
    }}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={location.isPlatformMaster}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Delete {location.name}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete location?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This permanently deletes <span className="font-medium text-foreground">{location.name}</span> and its tenant data.
                User identities remain in Estio and Clerk, but are detached from this location.
              </p>
              <div className="rounded-md border bg-muted/40 p-3 text-foreground">
                <p className="font-medium">Linked users ({location.users.length})</p>
                {location.users.length ? location.users.map((user) => (
                  <p key={user.id} className="mt-1 break-all text-xs text-muted-foreground">{user.label} · {user.email}</p>
                )) : <p className="mt-1 text-xs text-muted-foreground">No linked users</p>}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-foreground">
                {contentCounts.map(([label, count]) => <p key={label}>{count.toLocaleString()} {label}</p>)}
              </div>
              {blockedReason ? <p className="font-medium text-destructive">{blockedReason}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`delete-location-${location.id}`}>Type the location name to confirm</Label>
          <Input
            id={`delete-location-${location.id}`}
            value={confirmationName}
            onChange={(event) => setConfirmationName(event.target.value)}
            placeholder={location.name}
            autoComplete="off"
            disabled={Boolean(blockedReason) || pending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel asChild><Button type="button" variant="outline">Cancel</Button></AlertDialogCancel>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={!canDelete}>
            {pending ? "Deleting..." : "Delete location"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
