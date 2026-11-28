"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordLinkId } from "@/lib/studio/record-link-policy";

export function LibrarySourceAction({ locationId, url, sourceId, sourceVersion, savedChannelId }: {
  locationId: string; url: string; sourceId: string; sourceVersion: number; savedChannelId?: string;
}) {
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const channelId = savedChannelId ?? savedId;
  const savedLabel = "Channel saved in Studio. Open channel";

  async function watch() {
    if (pending || channelId) return;
    setPending(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/studio/library/import", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId },
        body: JSON.stringify({ input: url, idempotencyKey: key.current, sourceId, sourceVersion }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t save this channel. Try again.");
      if (typeof result.recordId !== "string" || !recordLinkId(result.recordId)) throw new Error("Couldn’t confirm the saved channel. Try again.");
      key.current = null;
      setSavedId(result.recordId);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t connect. Try again.");
    } finally { setPending(false); }
  }

  return <div className="relative shrink-0">
    {channelId ? <Button variant="ghost" size="icon" className="h-11 w-11 text-primary" asChild>
      <Link href={`/studio/library/${channelId}`} aria-label={savedLabel} title={savedLabel}><Heart aria-hidden="true" className="h-4 w-4 fill-current" /></Link>
    </Button> : <Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={pending}
      aria-label={pending ? "Saving channel" : "Watch channel in Studio"} title="Watch channel in Studio" onClick={() => void watch()}>
      {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> : <Heart aria-hidden="true" className="h-4 w-4" />}
    </Button>}
    <span className="sr-only" role="status">{savedId ? "Channel saved in Studio." : ""}</span>
    {error ? <p role="alert" className="absolute right-0 top-full z-40 w-48 rounded-md border bg-popover p-2 text-xs text-destructive shadow-sm">{error}</p> : null}
  </div>;
}
