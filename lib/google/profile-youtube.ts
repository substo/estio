import { Prisma } from "@prisma/client";
import type { StudioDb } from "../studio/db";
import { studioDb } from "@/lib/studio/studio-db";
import "server-only";
import { getPlatformProfile, type PlatformProfile } from "@/lib/platform/profile";
import { encryptStudioSecret, hasStudioSecretsKey } from "@/lib/studio/secrets";
import { readProfileYoutubeConnection, readProfileYoutubeAccess } from "./profile-youtube-credentials";
export type { ProfileYoutubeConnection } from "./profile-youtube-credentials";
import { youtubeClientConfig, youtubeProfileContext } from "./youtube-policy";
export const profileYoutubeConnection = (profile: PlatformProfile) => readProfileYoutubeConnection(studioDb, profile);
export async function getProfileYoutubeSummary() {
  const profile = await getPlatformProfile(); if (!profile) return null;
  const rows = await studioDb.rows<{ connected_at: string }>(Prisma.sql`select connected_at from studio.platform_google_youtube_connections t where app = ${profile.brand} and clerk_user_id = ${profile.userId} limit 1`);
  return { profile, connectedAt: rows[0]?.connected_at ?? null, configured: Boolean(youtubeClientConfig()) && hasStudioSecretsKey() };
}
export const profileYoutubeAccess = (profile: PlatformProfile) => readProfileYoutubeAccess(studioDb, profile);
export async function profileOAuthRpc(profile: PlatformProfile, action: "begin" | "consume" | "commit", stateHash: string, sessionHash: string, refresh?: { refreshToken: string; scopes: string[] }) {
  const client = youtubeClientConfig();
  return studioDb.call<boolean>("platform_youtube_oauth", { p_action: action,
    p_app: profile.brand, p_user: profile.userId, p_session_hash: sessionHash, p_state_hash: stateHash,
    ...(refresh && client ? { p_cipher: encryptStudioSecret(refresh.refreshToken, youtubeProfileContext(profile.brand, profile.userId, "refresh")), p_client_id: client.clientId, p_scopes: refresh.scopes } : {}) });
}
