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
import { getWhatsAppDeviceEgressStatus } from "@/lib/device-tunnel/status";
import { readMacYoutubeSearch, recordRelatedRun, startMacYoutubeSearch } from "./youtube-mac-search";
import { buildRelevanceContext } from "./video-discovery";
import type { RelatedContext, RelatedSource, RelatedTrace } from "./related-search-policy";
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
async function browseYoutube({ access, profile }: YoutubeContext, input: unknown, related?: { anchorId: string; expanded: boolean }) {
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
  const result = request.mode === "search" ? await api.search(request.query, request.pageToken,
    related ? { limit: related.expanded ? 11 : 5, includeStatistics: true } : undefined)
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
    return { ...video, ticket: sealYoutubeSelection({ locationId: access.locationId, brand: access.app, userId: access.userId }, video.id, provenance, { anchorId: related?.anchorId }) };
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

type RelatedAccess = YoutubeContext["access"];
export type RelatedCard = { id: string; title: string; channelId: string; channelTitle: string; publishedAt?: string; publishedText?: string; viewsText?: string; statistics?: { views?: string; likes?: string; comments?: string };
  description?: string; ticket: string; score: number | null; reason: string; band: "relevant" | "maybe" | "off_topic" | "unranked" };
const MAX_CARDS = 12;

async function relatedModelContext(access: RelatedAccess): Promise<RelatedContext> {
  const full = await buildRelevanceContext(studioDb, access.locationId).catch(() => ({ approvedTitles: [], pinnedKnowledge: [], profile: {} }));
  return { approvedTitles: (full.approvedTitles ?? []).slice(0, 15), pinnedKnowledge: (full.pinnedKnowledge ?? []).slice(0, 10), profile: full.profile ?? {} };
}
const seal = (access: RelatedAccess, anchorId: string, videoId: string, provider: YoutubeProvenance["provider"], query: string) => sealYoutubeSelection(
  { locationId: access.locationId, brand: access.app, userId: access.userId }, videoId, { kind: "public_search", observedAt: new Date().toISOString(), provider, rights: "research_link_only", query }, { anchorId });
const countText = (value: string | undefined, label: string) => (value ? `${BigInt(value).toLocaleString("en")} ${label}` : undefined);

export async function browseStudioRelatedYoutube(locationId: string, input: { anchorId?: unknown; query?: unknown; expanded?: unknown }) {
  const authority = await context(locationId);
  const { access } = authority;
  const anchor = await relatedAnchor(studioDb, access.locationId, input.anchorId);
  const queries = relatedYoutubeQueries(anchor.title, anchor.topic ?? "");
  const query = String(input.query ?? queries[0] ?? "").trim();
  if (!query) throw new YoutubeError("invalid_request", "Enter a YouTube search for this topic.");
  const expanded = input.expanded === true;
  const alternateQuery = queries.find(phrase => phrase !== query) ?? null;
  const source: RelatedSource = { kind: anchor.kind === "content" ? "idea" : "reference", title: anchor.title.slice(0, 300), summary: (anchor.topic ?? "").slice(0, 2000) };
  const modelContext = await relatedModelContext(access);
  // Order: the paired Mac plans, searches and ranks with its own subscription; else the connected device network searches; else the Data API finds
  // candidates and the Mac ranks them; else the results are shown unranked and labelled as such.
  const deviceNetwork = await getWhatsAppDeviceEgressStatus(access.locationId).then(status => status.required && status.available).catch(() => false);
  const requestKey = `related-${randomUUID()}`;
  try {
    const started = await startMacYoutubeSearch(access, { query: query.slice(0, 160), limit: expanded ? 12 : 8, requestKey, mode: "plan_search_rank", source, context: modelContext }, { deviceNetwork });
    return { status: "pending" as const, jobId: started.jobId, query, alternateQuery, ranking: started.mode === "plan_search_rank" };
  } catch (error) {
    if (!(error instanceof YoutubeError) || error.code !== "mac_not_ready") throw error;
    const macReason = error.message;
    let api: Awaited<ReturnType<typeof browseYoutube>>;
    try { api = await browseYoutube(authority, { mode: "search", query }, { anchorId: anchor.id, expanded }); }
    catch (apiError) { throw new YoutubeError(apiError instanceof YoutubeError ? apiError.code : "youtube_unavailable", `${macReason} Falling back to YouTube's API also failed: ${apiError instanceof YoutubeError ? apiError.message : "check the YouTube connection and API access."}`); }
    if (api.kind !== "videos") throw new Error("Related search must return videos.");
    const seed = relatedYoutubeSourceId(anchor.source_url);
    const found = api.videos.filter(video => video.id !== seed).slice(0, MAX_CARDS);
    const candidates = found.map(video => ({ id: video.id, title: video.title.slice(0, 300), channelId: video.channelId, channelTitle: video.channelTitle.slice(0, 200), publishedAt: video.publishedAt?.slice(0, 40),
      viewsText: countText(video.statistics?.views, "views"), description: youtubeDescriptionPreview(video.description)?.slice(0, 400) }));
    try {
      const started = await startMacYoutubeSearch(access, { query: query.slice(0, 160), limit: 8, requestKey, mode: "rank", source, context: modelContext, candidates }, { deviceNetwork: false });
      return { status: "pending" as const, jobId: started.jobId, query, alternateQuery, ranking: true };
    } catch (rankError) {
      if (!(rankError instanceof YoutubeError) || !["mac_not_ready", "mac_search_unavailable"].includes(rankError.code)) throw rankError;
      // Nothing can judge relevance: show the candidates, clearly unchecked, and keep the reasoning log.
      const note = `Not checked for relevance: ${rankError.message}`;
      const trace: RelatedTrace = { version: 1, route: "api", mode: "heuristic", queries: [{ query, by: "heuristic", found: found.length }], notes: [macReason.slice(0, 200), note.slice(0, 200)],
        candidates: found.map(video => ({ id: video.id, title: video.title, channel: video.channelTitle, score: null, reason: "", band: "unranked" as const })) };
      const runId = await recordRelatedRun(access, anchor.id, null, trace);
      return { status: "done" as const, query, alternateQuery, route: "api" as const, viaDevice: false, ranked: false, note, runId,
        videos: found.map((video): RelatedCard => ({ ...video, description: youtubeDescriptionPreview(video.description), score: null, reason: "", band: "unranked" })) };
    }
  }
}

export async function readStudioRelatedYoutube(locationId: string, input: { anchorId?: unknown; jobId?: unknown }) {
  const authority = await context(locationId);
  const { access } = authority;
  const anchor = await relatedAnchor(studioDb, access.locationId, input.anchorId);
  const state = await readMacYoutubeSearch(access, input.jobId);
  if (state.status !== "done") return state;
  const seed = relatedYoutubeSourceId(anchor.source_url);
  const videos = state.result.videos.filter(video => video.id !== seed).slice(0, MAX_CARDS);
  const route = state.result.trace?.route ?? (state.egress ? "device_network" : "mac_browser");
  const provider: YoutubeProvenance["provider"] = route === "api" ? "youtube_data_api" : route === "device_network" ? "device_network_browser" : "mac_browser";
  const cards = videos.map((video): RelatedCard => ({ id: video.id, title: video.title, channelId: video.channelId ?? "", channelTitle: video.channelTitle ?? "", publishedText: video.publishedText, viewsText: video.viewsText,
    description: video.description ? youtubeDescriptionPreview(video.description) : undefined, score: video.score ?? null, reason: video.reason ?? "", band: video.band ?? "unranked",
    ticket: seal(access, anchor.id, video.id, provider, state.query) }));
  const base = state.result.trace;
  const trace: RelatedTrace = base
    ? { ...base, ...(base.mode === "rank" ? { queries: [{ query: state.query, by: "heuristic" as const, found: videos.length }] } : {}) }
    : { version: 1, route, mode: "search", queries: [{ query: state.query, by: "heuristic", found: videos.length }],
        notes: [state.egress ? "Searched through the connected device network. Relevance was not checked: the models run on your Mac." : "Plain search."],
        candidates: videos.map(video => ({ id: video.id, title: video.title, channel: video.channelTitle, score: null, reason: "", band: "unranked" as const })) };
  const runId = await recordRelatedRun(access, anchor.id, state.jobId, trace);
  const queries = relatedYoutubeQueries(anchor.title, anchor.topic ?? "");
  return { status: "done" as const, query: state.query, alternateQuery: queries.find(phrase => phrase !== state.query) ?? null, route, viaDevice: state.viaDevice, runId,
    ranked: cards.some(card => card.band !== "unranked"), note: trace.notes?.join(" "), videos: cards };
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
