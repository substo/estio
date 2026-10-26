import { spawn } from "node:child_process";
import { appOrigin, configSchema, defaultConfigDir, saveConfig } from "./config";
import { pollPairing, startPairing, type DeviceCallOptions } from "./http-queue";
import { createKeychainStore, type DeviceTokenStore } from "./keychain";

export interface PairingDeps extends DeviceCallOptions {
  store?: DeviceTokenStore; configDir?: string; now?: () => number;
  /** Open the approval page on this Mac (no shell). */
  openUrl?: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
  print?: (line: string) => void;
}
export const openInBrowser = (url: string) => {
  const child = spawn("/usr/bin/open", [url], { shell: false, stdio: "ignore", detached: true });
  child.on("error", () => {}); child.unref();
};
const printable = (value: string) => value.replace(/[^\p{L}\p{N} .,'&()_-]/gu, "").slice(0, 100);
/** Device-initiated, browser-approved pairing. The token goes straight to Keychain; config keeps origin/deviceId/name. */
export async function pairDevice(input: { origin: string; name: string; platform: string }, deps: PairingDeps = {}) {
  const origin = appOrigin(input.origin);
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const print = deps.print ?? (line => console.log(line));
  const name = configSchema.shape.name.parse(input.name.trim().slice(0, 100));
  const start = await startPairing(origin, { name, platform: input.platform }, deps);
  // Only open an approval page on the app we are pairing with, never a server-chosen site.
  const url = new URL(start.verificationUrl);
  if (url.origin !== origin || url.pathname !== "/studio/settings/computer" || url.username || url.password) throw new Error("invalid_pairing_url");
  print(`Approve this Mac in your browser: ${url.href}`);
  print(`Confirm the code shown there is ${start.userCode}. Waiting for approval…`);
  (deps.openUrl ?? openInBrowser)(url.href);
  const expiresAt = Math.min(Date.parse(start.expiresAt), now() + 15 * 60_000);
  while (now() < expiresAt) {
    await sleep(start.intervalSeconds * 1000);
    let result;
    try { result = await pollPairing(origin, { pairingId: start.pairingId, deviceCode: start.deviceCode }, deps); }
    catch { continue; } // Transient network/rate-limit failure: keep polling until expiry.
    if (result.status === "pending") continue;
    if (result.status !== "approved") throw new Error(`pairing_${result.status}`);
    const store = deps.store ?? createKeychainStore();
    await store.save(origin, result.token);
    await saveConfig({ version: 2, origin, name, deviceId: result.deviceId }, deps.configDir ?? defaultConfigDir());
    const business = printable(result.businessName);
    print(`Paired with ${business || "your Business"}. Run: npm run start:studio-companion -- start`);
    return { deviceId: result.deviceId, businessName: business };
  }
  throw new Error("pairing_expired");
}
