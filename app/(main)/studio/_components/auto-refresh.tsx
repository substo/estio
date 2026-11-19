"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** While a background run is working, re-read the page's server data. */
export function AutoRefresh({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => { if (!active) return; const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, everyMs); return () => clearInterval(timer); }, [active, everyMs, router]);
  return null;
}
