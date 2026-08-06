"use client";

import { useEffect, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export type ImpersonationBannerData = {
  targetName: string;
  targetEmail: string;
  locationName: string;
  reason: string;
  sessionId: string;
  sessionExpiresAt: string;
};

export function ImpersonationBanner({ context }: { context: ImpersonationBannerData }) {
  const { actor, isLoaded } = useAuth();
  const clerk = useClerk();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !actor) return;
    void fetch("/api/platform/impersonation/activate", { method: "POST" }).then((response) => {
      if (!response.ok) setError("This support session could not be verified. Exit it now.");
    }).catch(() => setError("This support session could not be verified. Exit it now."));
  }, [actor, isLoaded]);

  async function exitSupportAccess() {
    setEnding(true); setError(null);
    try {
      await fetch("/api/platform/impersonation/end", { method: "POST" });
      await clerk.signOut({ sessionId: context.sessionId, redirectUrl: "/sign-in" });
    } catch {
      setError("Exit failed. Sign out to end this support session.");
      setEnding(false);
    }
  }

  return (
    <aside aria-label="Support access status" className="sticky top-0 z-[100] flex min-h-14 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-amber-950 bg-amber-300 px-4 py-2 text-sm text-amber-950 shadow-sm">
      <div className="min-w-0 text-center sm:text-left" title={`Support reason: ${context.reason}`}>
        <strong>Viewing as {context.targetName}</strong> <span>({context.targetEmail}) at {context.locationName}.</span>
        <span className="ml-2">Read-only until {new Date(context.sessionExpiresAt).toLocaleTimeString()}.</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={exitSupportAccess} disabled={ending} className="border-amber-950 bg-amber-50 text-amber-950 hover:bg-white">{ending ? "Exiting…" : "Exit support access"}</Button>
      {error ? <p role="alert" className="basis-full text-center font-medium">{error}</p> : null}
    </aside>
  );
}
