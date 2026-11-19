import { Prisma } from "@prisma/client";
import { studioDb } from "@/lib/studio/studio-db";
import { sameYoutubePrincipal } from "./youtube-consumer-policy";
import "server-only";
import { getPlatformProfile } from "@/lib/platform/profile";
import { profileYoutubeAccess, profileYoutubeConnection } from "@/lib/google/profile-youtube";
import { createYoutubeApi, YoutubeError } from "@/lib/google/youtube-api";
import { channelIdPattern, readDiscoveryRequest } from "@/lib/google/youtube-policy";
import { getStudioAccess } from "./access";
import { canManageStudioAi } from "./ai-settings-policy";
import { openYoutubeSelection, sealYoutubeSelection, type YoutubeProvenance } from "./youtube-selection";
import { hasStudioSecretsKey } from "./secrets";
import db from "@/lib/db";
import { createStudioDb } from "./db";
import { relatedAnchor, saveLinkedYoutubeSelection, saveYoutubeSelection } from "./youtube-bookmark";
import { recordLinkId } from "./record-link-policy";
import { randomUUID } from "node:crypto";
import { readMacYoutubeSearch, startMacYoutubeSearch } from "./youtube-mac-search";
import { relatedYoutubeQueries, relatedYoutubeSourceId, youtubeDescriptionPreview } from "./youtube-related-policy";

export interface ApprovedYoutubeChannel { channel_id: string; label: string; }
async function context(locationId: string, manager = false) {
  const profile = await getPlatformProfile(); const access = await getStudioAccess(locationId);
  if (!profile || !access || !sameYoutubePrincipal(profile, { brand: access.app, userId: access.userId }) || (manager && !canManageStudioAi(access)))
    throw new YoutubeError("access_denied", "Use your own authorized account. Channel approvals require a workspace manager.");
  return { profile, access };
}
export async function getStudioYoutubeSettings(locationId: string) {
  const { access, profile } = await context(locationId);
  const channels = await studioDb.rows<ApprovedYoutubeChannel>(Prisma.sql`select channel_id,label from studio.studio_youtube_channels t where location_id = ${access.locationId} order by label asc,channel_id asc limit 100`);
  const connection = await profileYoutubeConnection(profile);
  return { access, channels, connected: Boolean(connection), canManage: canManageStudioAi(access), publicConfigured: Boolean(process.env.YOUTUBE_DATA_API_KEY?.trim()) || Boolean(connection) };
}
export async function browseStudioYoutube(locationId: string, input: unknown) {
  return browseYoutube(await context(locationId), input);
}

type YoutubeContext = Awaited<ReturnType<typeof context>>;
async function browseYoutube({ access, profile }: YoutubeContext, input: unknown) {
  if (!hasStudioSecretsKey()) throw new YoutubeError("profile_key_unavailable", "Secure profile and discovery storage is not configured on this server yet.");
  let request;
  try { request = readDiscoveryRequest(input); } catch (error) { throw new YoutubeError("invalid_request", (error as Error).message); }
  if (request.mode === "channel") {
    const approved = await studioDb.rows<ApprovedYoutubeChannel>(Prisma.sql`select channel_id,label from studio.studio_youtube_channels t where location_id = ${access.locationId} and channel_id = ${request.channelId} limit 1`);
    if (!approved.length) throw new YoutubeError("channel_not_approved", "A manager must approve this channel for the workspace first.");
  }
  const slot = await studioDb.call<boolean>("studio_youtube_request_slot", { p_location: access.locationId, p_app: access.app, p_user: access.userId });
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
    // The bookmark ticket carries identity and provenance. The chosen title
    // arrives separately when the user saves a reference.
    const provenance: YoutubeProvenance = { kind, observedAt, provider: "youtube_data_api", rights: "research_link_only",
      ...(request.mode === "search" ? { query: request.query } : {}), ...(request.mode === "channel" || request.mode === "subscription" ? { channelId: request.channelId } : {}) };
    return { ...video, ticket: sealYoutubeSelection({ locationId: access.locationId, brand: access.app, userId: access.userId }, video.id, provenance) };
  });
  return { kind: "videos" as const, videos, nextPageToken: result.nextPageToken, identity, provenance: kind, observedAt };
}
export async function saveStudioYoutubeLink(locationId: string, input: { ticket?: unknown; title?: unknown }) {
  const authority = await context(locationId);
  return saveYoutubeSelection(studioDb, authority.access, youtubeSelection(authority, input.ticket), input.title);
}

function youtubeSelection({ profile, access }: YoutubeContext, ticket: unknown, anchorId?: string) {
  const selection = openYoutubeSelection(ticket, { locationId: access.locationId, brand: profile.brand, userId: profile.userId }, { anchorId });
  if (!selection) throw new YoutubeError("invalid_selection", "This selection expired or is unavailable here. Run discovery again.");
  return selection;
}

export async function browseStudioRelatedYoutube(locationId: string, input: { anchorId?: unknown; query?: unknown; expanded?: unknown }) {
  const authority = await context(locationId);
  const anchor = await relatedAnchor(studioDb, authority.access.locationId, input.anchorId);
  const queries = relatedYoutubeQueries(anchor.title, anchor.topic ?? "");
  const query = String(input.query ?? queries[0] ?? "").trim();
  if (!query) throw new YoutubeError("invalid_request", "Enter a YouTube search for this topic.");
  const expanded = input.expanded === true;
  // Default route: the paired Mac searches YouTube in its own signed-in browser profile. The Data API is not used here
  // (it would be metered usage, which is not priced yet) and nothing silently falls back to it.
  const jobId = await startMacYoutubeSearch(authority.access, query.slice(0, 160), expanded ? 12 : 6, `related-${randomUUID()}`);
  return { status: "pending" as const, jobId, query, alternateQuery: queries.find(phrase => phrase !== query) ?? null };
}

export async function readStudioRelatedYoutube(locationId: string, input: { anchorId?: unknown; jobId?: unknown }) {
  const authority = await context(locationId);
  const { access } = authority;
  const anchor = await relatedAnchor(studioDb, access.locationId, input.anchorId);
  const state = await readMacYoutubeSearch(access, input.jobId);
  if (state.status !== "done") return state;
  const seedVideo = relatedYoutubeSourceId(anchor.source_url);
  const observedAt = new Date().toISOString();
  const queries = relatedYoutubeQueries(anchor.title, anchor.topic ?? "");
  const expanded = state.limit > 6;
  return {
    status: "done" as const, query: state.query, alternateQuery: queries.find(phrase => phrase !== state.query) ?? null, signedIn: state.result.signedIn ?? false, viaDevice: state.viaDevice,
    videos: state.result.videos.filter(video => video.id !== seedVideo).slice(0, expanded ? 10 : 3).map(video => {
      const provenance: YoutubeProvenance = { kind: "public_search", observedAt, provider: state.viaDevice ? "device_network_browser" : "mac_browser", rights: "research_link_only", query: state.query };
      return { id: video.id, title: video.title, channelId: video.channelId ?? "", channelTitle: video.channelTitle ?? "", publishedAt: "", publishedText: video.publishedText, viewsText: video.viewsText,
        description: video.description ? youtubeDescriptionPreview(video.description) : undefined,
        ticket: sealYoutubeSelection({ locationId: access.locationId, brand: access.app, userId: access.userId }, video.id, provenance, { anchorId: anchor.id }) };
    }),
  };
}

export async function saveStudioRelatedYoutube(locationId: string, input: { anchorId?: unknown; ticket?: unknown; title?: unknown }) {
  const authority = await context(locationId);
  const { access } = authority;
  if (typeof input.anchorId !== "string" || !recordLinkId(input.anchorId)) throw new YoutubeError("invalid_anchor", "Choose a saved source or idea.");
  const anchorId = input.anchorId.toLowerCase();
  const selection = youtubeSelection(authority, input.ticket, anchorId);
  return db.$transaction(tx => saveLinkedYoutubeSelection(createStudioDb(tx), access, anchorId, selection, input.title));
}
export async function manageStudioYoutubeChannel(locationId: string, input: { channelId?: unknown; label?: unknown; remove?: unknown }) {
  const { access, profile } = await context(locationId, true);
  if (typeof input.channelId !== "string" || input.channelId.length > 300 || typeof input.remove !== "boolean"
    || (!input.remove && (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 180))) throw new YoutubeError("invalid_channel", "Enter a YouTube channel URL or @handle and your own label.");
  let channelId = input.channelId;
  if (input.remove) { if (!channelIdPattern.test(channelId)) throw new YoutubeError("invalid_channel", "Choose an approved channel."); }
  else {
    const slot = await studioDb.call<boolean>("studio_youtube_request_slot", { p_location: access.locationId, p_app: access.app, p_user: access.userId });
    if (!slot) throw new YoutubeError("discovery_daily_limit", "This workspace reached its daily discovery limit. Try tomorrow.");
    const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
    const auth = key ? { apiKey: key } : { accessToken: (await profileYoutubeAccess(profile)).token };
    try { channelId = await createYoutubeApi(auth).resolveChannel(channelId); }
    catch (error) { if (error instanceof YoutubeError) throw error; throw new YoutubeError("invalid_channel", "Enter a YouTube channel URL or @handle."); }
  }
  await studioDb.call("studio_youtube_channel", { p_location: access.locationId, p_app: access.app, p_user: access.userId,
    p_channel: channelId, p_label: input.remove ? "" : (input.label as string).trim(), p_remove: input.remove });
  return channelId;
}
