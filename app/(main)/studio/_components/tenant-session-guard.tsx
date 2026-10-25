"use client";
import { useEffect } from "react";

/** Clean URLs follow the selected Location, including when another tab changes it. */
export function TenantSessionGuard({ locationId }: { locationId: string | null }) {
  useEffect(() => {
    let alive = true;
    async function check(event?: PageTransitionEvent) {
      if (document.visibilityState !== "visible") return;
      if (event?.persisted) { window.location.reload(); return; }
      try {
        const response = await fetch("/api/studio/tenant-context", { cache: "no-store" });
        if (!response.ok) return;
        const current = await response.json();
        if (alive && current.locationId !== locationId) window.location.assign("/studio");
      } catch { /* Commands still revalidate the rendered tenant on the server. */ }
    }
    const visible = () => { void check(); };
    void check();
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; window.removeEventListener("pageshow", check); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [locationId]);
  return null;
}
