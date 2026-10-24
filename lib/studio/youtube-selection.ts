import { randomUUID } from "node:crypto";
import { decryptStudioSecret, encryptStudioSecret } from "./secrets";
export interface YoutubeSelectionPrincipal { workspaceId: string; brand: "estio" | "substo"; userId: string; }
export interface YoutubeProvenance { kind: "public_search" | "approved_channel" | "subscription" | "saved_url"; observedAt: string; provider: "youtube_data_api"; rights: "research_link_only"; query?: string; channelId?: string; }
const context = (p: YoutubeSelectionPrincipal) => `studio:youtube-selection:${p.workspaceId}:${p.brand}:${p.userId}`;
export function sealYoutubeSelection(principal: YoutubeSelectionPrincipal, videoId: string, provenance: YoutubeProvenance, now = Date.now()) {
  const selection = { ...principal, videoId, recordId: randomUUID(), expires: now + 20 * 60_000, provenance };
  return Buffer.from(JSON.stringify(encryptStudioSecret(JSON.stringify(selection), context(principal)))).toString("base64url");
}
export function openYoutubeSelection(ticket: unknown, principal: YoutubeSelectionPrincipal, now = Date.now()): { recordId: string; videoId: string; provenance: YoutubeProvenance } | null {
  try {
    if (typeof ticket !== "string" || ticket.length > 8192) return null;
    const selection = JSON.parse(decryptStudioSecret(JSON.parse(Buffer.from(ticket, "base64url").toString("utf8")), context(principal)));
    if (selection.workspaceId !== principal.workspaceId || selection.brand !== principal.brand || selection.userId !== principal.userId
      || typeof selection.expires !== "number" || selection.expires <= now || selection.expires > now + 20 * 60_000) return null;
    return { recordId: selection.recordId, videoId: selection.videoId, provenance: selection.provenance };
  } catch { return null; }
}
