"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StudioUnavailable } from "../_components/studio-unavailable";

/** Keeps Studio page failures inside the app shell; a restricted provider shows the unavailable state. */
export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [unavailable, setUnavailable] = useState<boolean | null>(null);
  useEffect(() => {
    console.error("Studio page error", error.digest ?? "");
    let alive = true;
    fetch("/api/studio/tenant-context", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (alive) setUnavailable(body?.studioUnavailable === true); })
      .catch(() => { if (alive) setUnavailable(false); });
    return () => { alive = false; };
  }, [error]);
  if (unavailable === null) return null;
  if (unavailable) return <StudioUnavailable />;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6 md:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">This Studio page couldn&apos;t load</h1>
      <p className="text-muted-foreground">Something went wrong. Try again, or reload the page.</p>
      <div><Button onClick={() => reset()}>Try again</Button></div>
    </main>
  );
}
