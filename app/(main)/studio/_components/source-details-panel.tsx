"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sourceDetailsCount, type SourceDetailsState } from "@/lib/studio/source-details-policy";
import type { SourceMeta } from "@/lib/studio/youtube-source-meta";
import { CommentsSection, DetailsSection } from "./source-sections";

const endpoint = "/api/studio/library/source-details";

export function SourceDetailsPanel({ locationId, recordId, initial, canFetch, youtube, legacy, description, channelUrl, channel }: {
  locationId: string; recordId: string; initial: SourceDetailsState | null; canFetch: boolean; youtube: boolean;
  legacy: SourceMeta | null; description: string; channelUrl: string | null; channel: string | null;
}) {
  const [details, setDetails] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pollError, setPollError] = useState("");
  const requestId = useRef<string | null>(null);
  const running = details?.status === "queued" || details?.status === "running";
  const headers = { "X-Studio-Tenant": locationId };
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch(`${endpoint}?recordId=${recordId}`, {
          headers: { "X-Studio-Tenant": locationId }, signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to refresh");
        const data: SourceDetailsState = await response.json();
        if (!controller.signal.aborted) {
          setDetails(data);
          setPollError("");
        }
      } catch {
        if (!controller.signal.aborted) setPollError("Live progress is temporarily unavailable. Studio will check again.");
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      controller.abort();
    };
  }, [locationId, recordId, running]);

  async function request() {
    setSubmitting(true);
    setMessage("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, requestId: requestId.current }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) requestId.current = null;
        throw new Error(result.error ?? "Fetch details could not be started.");
      }
      requestId.current = null;
      setDetails(result);
      setPollError("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach Studio. Try again.");
    } finally { setSubmitting(false); }
  }

  const action = canFetch ? <Button type="button" size="sm" variant="outline" onClick={() => void request()} disabled={submitting || running}>
    {submitting || running ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 motion-safe:animate-spin" /> : null}
    {running ? "Fetching details" : "Fetch details"}
  </Button> : null;
  const status = message || pollError || details?.error ||
    (details?.status === "queued" ? "Waiting for your paired Mac. You can keep using this page."
      : details?.status === "running" ? `Loading on your Mac · ${sourceDetailsCount(details.fetchedComments, details.fetchedReplies)} saved`
      : details?.status === "succeeded" ? details.reason ?? "Fetch finished." : "");
  return <>
    <DetailsSection meta={details?.meta ?? legacy} description={details?.meta?.description || description} channelUrl={details?.meta?.channelUrl ?? channelUrl}
      channel={channel} action={action} status={status ? <p role={message || details?.error ? "alert" : "status"} className="text-sm text-muted-foreground">{status}</p> : null} />
    <CommentsSection meta={legacy} mac={youtube} details={details} />
  </>;
}
