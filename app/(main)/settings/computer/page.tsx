import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getPlatformProfile } from "@/lib/platform/profile";
import { getStudioDevices } from "@/lib/studio/devices";
import { requireSettingsContext } from "../_components/context";
import { CompanionSettings } from "./companion-settings";
import { MobileDevices } from "./mobile-devices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices" };

export default async function DevicesPage({ searchParams }: {
  searchParams: Promise<{ code?: string | string[]; type?: string | string[]; from?: string | string[] }>;
}) {
  const { app, locationId, access, tenantHost } = await requireSettingsContext();
  if (tenantHost) notFound();
  if (!locationId || !access) return null;

  const { code: rawCode, type, from } = await searchParams;
  const code = typeof rawCode === "string" && /^[A-Za-z0-9-]{4,16}$/.test(rawCode) ? rawCode : null;
  const mobile = type === "mobile" && !code;
  const originQuery = from === "crm" || from === "studio" ? `from=${from}` : "";
  const computersHref = "/settings/computer" + (originQuery ? `?${originQuery}` : "");
  const mobileHref = "/settings/computer?type=mobile" + (originQuery ? `&${originQuery}` : "");

  let content;
  if (mobile) {
    content = <MobileDevices app={app} role={access.role} impersonating={app === "estio" && Boolean((await auth()).actor)} />;
  } else {
    const [devices, profile] = await Promise.all([getStudioDevices(locationId), getPlatformProfile()]);
    if (!devices) notFound();
    content = <CompanionSettings {...devices} origin={profile?.origin ?? "https://substo.com"} businessName={access.locationName} code={code} computersHref={computersHref} />;
  }

  return (
    <main className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
      <nav aria-label="Device type" className="flex flex-wrap gap-2">
        <Button asChild variant={mobile ? "outline" : "secondary"}><Link href={computersHref} aria-current={mobile ? undefined : "page"}>Computers</Link></Button>
        <Button asChild variant={mobile ? "secondary" : "outline"}><Link href={mobileHref} aria-current={mobile ? "page" : undefined}>Mobile</Link></Button>
      </nav>
      {content}
    </main>
  );
}
