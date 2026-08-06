import { redirect } from "next/navigation";

export default async function LegacyImpersonationPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const locationId = String((await searchParams).locationId || "").trim();
  redirect(locationId ? `/platform?locationId=${encodeURIComponent(locationId)}` : "/platform");
}
