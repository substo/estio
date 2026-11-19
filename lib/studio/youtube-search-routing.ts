import { YoutubeError } from "../google/youtube-api";

export const macSearchMessages: Record<string, string> = {
  YS001: "Your Mac is not paired for Related search yet. Pair it in Setup.",
  YS002: "Mac processing is off. Turn it on in Setup so Related search can run on your Mac.",
  YS003: "Your Mac's Chrome is not ready. Install Google Chrome on the Mac.",
  YS004: "Your Mac's Studio companion needs updating (git pull, then restart it).",
  YS005: "Too many searches in a minute. Wait a moment and try again.",
  "42501": "Only a Business admin with a paired Mac can search YouTube from their Mac.",
};
const MAC_NOT_READY = new Set(["YS001", "YS002", "YS003", "YS004"]);
export interface SearchRpc { call<T>(fn: string, args: Record<string, unknown>): Promise<T> }
const errorCode = (error: unknown) => (error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "");

/** Order of use: (1) the requesting account's own paired Mac, (2) the Location's connected device network when one is online,
 * (3) the caller's own fallback (the YouTube Data API under its existing daily cap). "mac_not_ready" means (1) and (2) are unavailable
 * and the caller may fall back; any other error must not silently fall back. */
export async function startRelatedSearchJob(rpc: SearchRpc, access: { locationId: string; app: "estio" | "substo"; userId: string },
  query: string, limit: number, requestKey: string, options: { deviceNetwork: boolean }) {
  const identity = { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId };
  try {
    return (await rpc.call<{ jobId: string }>("studio_enqueue_youtube_search", { ...identity, p_command: { query, limit, requestKey } })).jobId;
  } catch (error) {
    const code = errorCode(error);
    if (MAC_NOT_READY.has(code)) {
      if (options.deviceNetwork) {
        try { return (await rpc.call<{ jobId: string }>("studio_enqueue_youtube_search_egress", { ...identity, p_command: { query, limit, requestKey, macReason: code } })).jobId; }
        catch { /* fall through to the Mac's own reason */ }
      }
      throw new YoutubeError("mac_not_ready", macSearchMessages[code]);
    }
    if (macSearchMessages[code]) throw new YoutubeError("mac_search_unavailable", macSearchMessages[code]);
    throw error;
  }
}
