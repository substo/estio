"use client";
import { useEffect, useState } from "react";

/** Recheck restored tabs too; no provisioning occurs in this preference POST. */
export function TenantSelectionSync({ workspaceId }: { workspaceId: string }) {
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function sync(event?: PageTransitionEvent) {
      if (pending || document.visibilityState !== "visible") return;
      if (event?.persisted) { window.location.reload(); return; }
      pending = true;
      try {
        const response = await fetch("/api/studio/tenant-selection", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) });
        if (active) setError(!response.ok);
      } catch { if (active) setError(true); }
      finally { pending = false; }
    }
    const visible = () => { void sync(); };
    void sync();
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("pageshow", sync); document.removeEventListener("visibilitychange", visible); };
  }, [workspaceId]);
  return error ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">Your last-used selection could not be saved. This page still uses the brand or location shown above. Reload to retry.</p> : null;
}
