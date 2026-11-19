import { StudioJobError, type StudioJobHandler } from "./handlers";
import { egressSearchPayloadSchema, isSignedInTopbar, macSearchResultSchema, parseYoutubeSearchData, youtubeSearchUrl, type MacSearchResult } from "../youtube-mac-search-policy";

export interface EgressProxy { host: string; port: number }
/** Asks the device-tunnel gateway (same server, internal secret) for the Location's isolated Studio listener. */
export interface EgressGateway { lease(locationId: string, signal: AbortSignal): Promise<EgressProxy | null> }
export interface EgressBrowser { search(query: string, limit: number, proxy: EgressProxy, signal: AbortSignal): Promise<MacSearchResult> }

export function createGatewayClient(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): EgressGateway | null {
  const secret = env.DEVICE_TUNNEL_INTERNAL_SECRET?.trim();
  if (!secret) return null;
  const base = (env.DEVICE_TUNNEL_GATEWAY_URL?.trim() || "http://127.0.0.1:3220").replace(/\/+$/, "");
  return {
    async lease(locationId, signal) {
      const response = await fetcher(`${base}/studio/egress`, { method: "POST", headers: { "content-type": "application/json", "x-device-tunnel-secret": secret },
        body: JSON.stringify({ locationId }), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      if (response.status === 503) return null;
      if (!response.ok) throw new Error("gateway_error");
      const body = await response.json() as { available?: boolean; proxyHost?: string; proxyPort?: number };
      // Only the server's own loopback is ever acceptable as the proxy address.
      if (body.available !== true || body.proxyHost !== "127.0.0.1" || !Number.isInteger(body.proxyPort) || Number(body.proxyPort) < 1 || Number(body.proxyPort) > 65535) return null;
      return { host: "127.0.0.1", port: Number(body.proxyPort) };
    },
  };
}

/** The server's headless Chrome, with every connection (and DNS lookup) going through the device's network. */
export function createPuppeteerEgressBrowser(): EgressBrowser {
  return {
    async search(query, limit, proxy, signal) {
      const { default: puppeteer } = await import("puppeteer");
      const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-zygote", "--disable-quic",
        `--proxy-server=socks5://${proxy.host}:${proxy.port}`, `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxy.host}`] });
      const abort = () => { void browser.close().catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const page = await browser.newPage();
        await page.goto(youtubeSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
        if (/\/sorry\/|accounts\.google\.com|consent\.youtube\.com/.test(page.url())) throw new StudioJobError("youtube_blocked", "YouTube asked for a check on the connected phone's network. Try again later or use your Mac.", false);
        await page.waitForFunction(() => Boolean((window as unknown as { ytInitialData?: unknown }).ytInitialData), { timeout: 25_000 });
        const data = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { ytInitialData?: unknown }).ytInitialData ?? null)));
        return { videos: parseYoutubeSearchData(data, limit), signedIn: isSignedInTopbar(data) };
      } finally { signal.removeEventListener("abort", abort); await browser.close().catch(() => {}); }
    },
  };
}

export function createYoutubeEgressSearchHandler(deps: { gateway: EgressGateway | null; browser: EgressBrowser }): StudioJobHandler {
  return async (job, context) => {
    const payload = egressSearchPayloadSchema.parse(job.payload);
    if (!deps.gateway) throw new StudioJobError("youtube_egress_unavailable", "Searching through a connected phone is not configured on this server.", false);
    let proxy: EgressProxy | null;
    try { proxy = await deps.gateway.lease(job.location_id, context.signal); }
    catch { throw new StudioJobError("youtube_egress_unavailable", "The phone network relay could not be reached. Try again or use your Mac.", false); }
    if (!proxy) throw new StudioJobError("youtube_no_device", "No connected phone network is online for this workspace. Pair your Mac in Setup, or bring the phone relay online.", false);
    try {
      // Nothing from this search is paid or stored beyond the public facts returned.
      return { ...macSearchResultSchema.parse(await deps.browser.search(payload.query, payload.limit, proxy, context.signal)), via: "device_network" };
    } catch (error) {
      if (error instanceof StudioJobError) throw error;
      if (context.signal.aborted) throw new StudioJobError("youtube_search_cancelled", "The search was interrupted. Search again.", false);
      throw new StudioJobError("youtube_search_failed", "YouTube results could not be read through the connected phone's network. Search again.", false);
    }
  };
}
