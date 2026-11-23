export interface MacStatusInput { hasDevice: boolean; processing: boolean; paused: boolean; online: boolean; assemblyReady: boolean | null; missing: string[] }
export type MacTone = "ok" | "warn" | "off";
export interface MacStatus { tone: MacTone; label: string; detail: string; href: string | null }
const safeName = (s: string) => /^[A-Za-z0-9 ._+-]{1,40}$/.test(s) ? s : null;
/** Name exactly what is missing; a generic "check Setup" is never enough. */
export function describeMac(m: MacStatusInput): MacStatus {
  if (!m.hasDevice) return { tone: "off", label: "No Mac connected", detail: "Connect a Mac in Devices to make and edit videos.", href: "/settings/computer?from=studio" };
  if (!m.processing) return { tone: "off", label: "Mac processing is off", detail: "Turn processing on in Devices.", href: "/settings/computer?from=studio" };
  if (m.paused) return { tone: "warn", label: "Mac is paused", detail: "Resume it in Devices.", href: "/settings/computer?from=studio" };
  if (!m.online) return { tone: "warn", label: "Mac is offline", detail: "Jobs wait until the companion is running again.", href: null };
  if (m.assemblyReady === false) { const names = m.missing.map(safeName).filter((x): x is string => x !== null); return { tone: "warn", label: names.length ? `Mac needs ${names.join(", ")}` : "Mac is not ready for video", detail: "Install or sign in on the Mac, then Recheck.", href: null }; }
  if (m.assemblyReady === null) return { tone: "warn", label: "Mac is starting", detail: "It has not reported its video tools yet. Recheck in a moment.", href: null };
  return { tone: "ok", label: "Mac ready", detail: "Videos are made and edited on your Mac.", href: null };
}
