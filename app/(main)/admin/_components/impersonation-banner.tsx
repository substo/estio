"use client";

import { useEffect, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export type ImpersonationBannerData = {
  targetName: string;
  targetEmail: string;
  locationName: string;
  sessionId: string;
};

export function ImpersonationBanner({ context }: { context: ImpersonationBannerData }) {
  const { actor, isLoaded } = useAuth();
  const clerk = useClerk();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !actor) return;
    void fetch("/api/platform/impersonation/activate", { method: "POST" }).then((response) => {
      if (!response.ok) setError("This master login could not be verified. Sign out now.");
    }).catch(() => setError("This master login could not be verified. Sign out now."));
  }, [actor, isLoaded]);

  async function exitUserSession() {
    setEnding(true); setError(null);
    try {
      await fetch("/api/platform/impersonation/end", { method: "POST" });
      await clerk.signOut({ sessionId: context.sessionId, redirectUrl: "/sign-in" });
    } catch {
      setError("Sign out failed. Try again from the account menu.");
      setEnding(false);
    }
  }

  return (
    <aside aria-label="Master login status" className="sticky top-0 z-[100] flex min-h-14 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-amber-950 bg-amber-300 px-4 py-2 text-sm text-amber-950 shadow-sm">
      <div className="min-w-0 text-center sm:text-left">
        <strong>Logged in as {context.targetName}</strong> <span>({context.targetEmail}) at {context.locationName}.</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={exitUserSession} disabled={ending} className="border-amber-950 bg-amber-50 text-amber-950 hover:bg-white">{ending ? "Signing out…" : "Sign out user"}</Button>
      {error ? <p role="alert" className="basis-full text-center font-medium">{error}</p> : null}
    </aside>
  );
}
