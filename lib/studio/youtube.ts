import { sameYoutubePrincipal } from "./youtube-consumer-policy";
import "server-only";
import { getPlatformProfile } from "@/lib/platform/profile";
import { profileYoutubeAccess, profileYoutubeConnection } from "@/lib/google/profile-youtube";
import { createYoutubeApi, YoutubeError } from "@/lib/google/youtube-api";
import { channelIdPattern, readDiscoveryRequest } from "@/lib/google/youtube-policy";
import { getStudioWorkspaceAccess } from "./access";
import { canManageStudioAi } from "./ai-settings-policy";
import { openYoutubeSelection, sealYoutubeSelection, type YoutubeProvenance } from "./youtube-selection";
import { hasStudioSecretsKey } from "./secrets";
import { queryPath, studioRest } from "./rest";

export interface ApprovedYoutubeChannel { channel_id: string; label: string; }
async function context(workspaceId: string, manager = false) {
  const profile = await getPlatformProfile(); const access = await getStudioWorkspaceAccess(workspaceId);
  if (!profile || !access || !sameYoutubePrincipal(profile, access) || (manager && !canManageStudioAi(access)))
    throw new YoutubeError("access_denied", "Use your own authorized account. Channel approvals require a workspace manager.");
  return { profile, access };
}
export async function getStudioYoutubeSettings(workspaceId: string) {
  const { access, profile } = await context(workspaceId);
  const channels = await studioRest<ApprovedYoutubeChannel[]>(queryPath("studio_youtube_channels", { select: "channel_id,label", workspace_id: `eq.${access.workspace.id}`, order: "label.asc,channel_id.asc", limit: "100" }));
  const connection = await profileYoutubeConnection(profile);
  return { access, channels, connected: Boolean(connection), canManage: canManageStudioAi(access), publicConfigured: Boolean(process.env.YOUTUBE_DATA_API_KEY?.trim()) || Boolean(connection) };
}
export async function browseStudioYoutube(workspaceId: string, input: unknown) {
  const { access, profile } = await context(workspaceId);
  if (!hasStudioSecretsKey()) throw new YoutubeError("profile_key_unavailable", "Secure profile and discovery storage is not configured on this server yet.");
  let request;
  try { request = readDiscoveryRequest(input); } catch (error) { throw new YoutubeError("invalid_request", (error as Error).message); }
  if (request.mode === "channel") {
    const approved = await studioRest<ApprovedYoutubeChannel[]>(queryPath("studio_youtube_channels", { select: "channel_id,label", workspace_id: `eq.${access.workspace.id}`, channel_id: `eq.${request.channelId}`, limit: "1" }));
    if (!approved.length) throw new YoutubeError("channel_not_approved", "A manager must approve this channel for the workspace first.");
  }
  const slot = await studioRest<boolean>("rpc/studio_youtube_request_slot", { method: "POST", body: JSON.stringify({ p_workspace: access.workspace.id, p_brand: access.brand, p_user: access.userId }) });
  if (!slot) throw new YoutubeError("discovery_daily_limit", "This workspace reached its daily discovery limit. Try tomorrow.");
  const personal = request.mode === "subscriptions" || request.mode === "subscription";
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  let version: string | null = null;
  let token: string | undefined;
  if (personal || !key) { const grant = await profileYoutubeAccess(profile); token = grant.token; version = grant.version; }
  const api = createYoutubeApi(token ? { accessToken: token } : { apiKey: key });
  let identity: string | null = null;
  if (personal) identity = (await api.identity()) ?? "Connected YouTube account";
  async function stillConnected() {
    if (version && (await profileYoutubeConnection(profile))?.version !== version) throw new YoutubeError("connection_changed", "Your profile connection changed. Reload discovery.");
  }
  if (request.mode === "subscriptions") {
    const result = await api.subscriptions(request.pageToken); await stillConnected();
    return { kind: "channels" as const, ...result, identity };
  }
  if (request.mode === "subscription") {
    const subscribed = await api.subscriptions("", request.channelId);
    if (!subscribed.channels.some(c => c.id === request.channelId)) throw new YoutubeError("not_subscribed", "This channel is not in your connected account’s subscriptions.");
  }
  const result = request.mode === "search" ? await api.search(request.query, request.pageToken)
    : request.mode === "url" ? { videos: await api.videos([request.videoId!]), nextPageToken: null }
    : await api.channelVideos(request.channelId, request.pageToken);
  await stillConnected();
  const kind = ({ search: "public_search", url: "saved_url", subscription: "subscription", channel: "approved_channel" } as const)[request.mode];
  const observedAt = new Date().toISOString();
  const videos = result.videos.map(video => {
    // Persist no API title/description/statistics in the bookmark ticket. The
    // user supplies their own research title when explicitly sharing a link.
    const provenance: YoutubeProvenance = { kind, observedAt, provider: "youtube_data_api", rights: "research_link_only",
      ...(request.mode === "search" ? { query: request.query } : {}), ...(request.mode === "channel" || request.mode === "subscription" ? { channelId: request.channelId } : {}) };
    return { ...video, ticket: sealYoutubeSelection({ workspaceId: access.workspace.id, brand: access.brand, userId: access.userId }, video.id, provenance) };
  });
  return { kind: "videos" as const, videos, nextPageToken: result.nextPageToken, identity, provenance: kind, observedAt };
}
export async function saveStudioYoutubeLink(workspaceId: string, input: { ticket?: unknown; title?: unknown }) {
  const { profile, access } = await context(workspaceId);
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 180) throw new YoutubeError("invalid_title", "Enter your own research title, up to 180 characters.");
  const selection = openYoutubeSelection(input.ticket, { workspaceId: access.workspace.id, brand: profile.brand, userId: profile.userId });
  if (!selection) throw new YoutubeError("invalid_selection", "This selection expired or belongs to another profile. Run discovery again.");
  return studioRest<string>("rpc/studio_save_youtube_bookmark", { method: "POST", body: JSON.stringify({ p_workspace: access.workspace.id, p_brand: access.brand, p_user: access.userId,
    p_record: selection.recordId, p_video: selection.videoId, p_title: input.title.trim(), p_provenance: selection.provenance }) });
}
export async function manageStudioYoutubeChannel(workspaceId: string, input: { channelId?: unknown; label?: unknown; remove?: unknown }) {
  const { access, profile } = await context(workspaceId, true);
  if (typeof input.channelId !== "string" || input.channelId.length > 300 || typeof input.remove !== "boolean"
    || (!input.remove && (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 180))) throw new YoutubeError("invalid_channel", "Enter a YouTube channel URL or @handle and your own label.");
  let channelId = input.channelId;
  if (input.remove) { if (!channelIdPattern.test(channelId)) throw new YoutubeError("invalid_channel", "Choose an approved channel."); }
  else {
    const slot = await studioRest<boolean>("rpc/studio_youtube_request_slot", { method: "POST", body: JSON.stringify({ p_workspace: access.workspace.id, p_brand: access.brand, p_user: access.userId }) });
    if (!slot) throw new YoutubeError("discovery_daily_limit", "This workspace reached its daily discovery limit. Try tomorrow.");
    const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
    const auth = key ? { apiKey: key } : { accessToken: (await profileYoutubeAccess(profile)).token };
    try { channelId = await createYoutubeApi(auth).resolveChannel(channelId); }
    catch (error) { if (error instanceof YoutubeError) throw error; throw new YoutubeError("invalid_channel", "Enter a YouTube channel URL or @handle."); }
  }
  await studioRest("rpc/studio_youtube_channel", { method: "POST", body: JSON.stringify({ p_workspace: access.workspace.id, p_brand: access.brand, p_user: access.userId,
    p_channel: channelId, p_label: input.remove ? "" : (input.label as string).trim(), p_remove: input.remove }) });
  return channelId;
}
