import Link from "next/link";
import { normalizeSmsRelayPlatform } from "@/lib/sms-relay/device-capabilities";
import { Button } from "@/components/ui/button";
import { getSmsRelayDevices } from "../integrations/sms-relay/actions";
import { DeviceStatus } from "./device-status";

const RELAY_SETTINGS = "/settings/integrations/sms-relay";
// The Android gateway polls approximately every 15 seconds. Allow several missed polls.
const ANDROID_HEARTBEAT_TIMEOUT = 60_000;

/** Keep the existing relay authority and pairing flow as the source of truth for mobile devices. */
export async function MobileDevices({ app, role, impersonating }: {
  app: "estio" | "substo"; role: "ADMIN" | "MEMBER"; impersonating: boolean;
}) {
  let content;
  if (app === "substo") {
    content = <p className="text-muted-foreground">SIM Relay is available on Estio.</p>;
  } else if (role !== "ADMIN" || impersonating) {
    content = <p className="text-muted-foreground">A Location admin can manage mobile devices from their own account.</p>;
  } else {
    const devices = await getSmsRelayDevices().catch(() => null);
    content = <>
      {devices === null ? <p role="alert" className="text-destructive">Could not load mobile devices.</p> : devices.length ? <ul className="space-y-3">{devices.map(device => {
        const isIPhone = normalizeSmsRelayPlatform(device.platform) === "ios";
        const lastSeen = device.lastSeenAt ? Date.parse(device.lastSeenAt) : NaN;
        const online = device.status.toLowerCase() === "online" && Date.now() - lastSeen <= ANDROID_HEARTBEAT_TIMEOUT;
        return <li key={device.id} className="space-y-1 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words font-medium">{device.label}</span>
            <DeviceStatus state={!device.paired ? "Awaiting pairing" : isIPhone ? "Approval required" : online ? "Online" : "Offline"} />
          </div>
          <p className="text-muted-foreground">{isIPhone ? "iPhone" : "Android"}{device.lastSeenAt && <> · Last seen <time dateTime={device.lastSeenAt}>{new Date(device.lastSeenAt).toLocaleString("en-GB", { timeZone: "Asia/Nicosia", dateStyle: "medium", timeStyle: "short" })}</time></>}</p>
        </li>;
      })}</ul> : <p className="text-muted-foreground">No mobile devices connected yet.</p>}
      <Button variant="outline" asChild><Link href={RELAY_SETTINGS}>Manage mobile devices</Link></Button>
    </>;
  }

  return <section className="space-y-4 rounded-xl border bg-card p-5 text-sm" aria-labelledby="mobile-devices-heading">
    <h2 id="mobile-devices-heading" className="text-lg font-medium">Mobile devices</h2>
    {content}
  </section>;
}
