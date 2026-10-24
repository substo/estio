import { queryPath } from "../studio/rest-client";
import { decryptStudioSecret, type StudioSecretCiphertext } from "../studio/secrets";
import { refreshYoutubeAccess, YoutubeError } from "./youtube-api";
import { youtubeClientConfig, youtubeProfileContext } from "./youtube-policy";
export interface ProfileYoutubeConnection { version: string; client_id: string; connected_at: string; refresh_cipher: StudioSecretCiphertext; }
export type YoutubePrincipal = { brand: "estio" | "substo"; userId: string };
type Rest = <T>(path: string, init?: RequestInit) => Promise<T>;
export async function readProfileYoutubeConnection(rest: Rest, principal: YoutubePrincipal) {
  const [connection] = await rest<ProfileYoutubeConnection[]>(queryPath("platform_google_youtube_connections", {
    select: "version,client_id,connected_at,refresh_cipher", brand: `eq.${principal.brand}`, clerk_user_id: `eq.${principal.userId}`, limit: "1" }));
  return connection ?? null;
}
/** Reused by own-session discovery and hosted jobs; no workspace credential path. */
export async function readProfileYoutubeAccess(rest: Rest, principal: YoutubePrincipal, expectedVersion?: string, fetcher: typeof fetch = fetch) {
  const connection = await readProfileYoutubeConnection(rest, principal); const client = youtubeClientConfig();
  if (!connection || !client || connection.client_id !== client.clientId || (expectedVersion && connection.version !== expectedVersion))
    throw new YoutubeError("youtube_not_connected", "Reconnect YouTube in your profile and authorize discovery again.");
  let refresh: string;
  try { refresh = decryptStudioSecret(connection.refresh_cipher, youtubeProfileContext(principal.brand, principal.userId, "refresh")); }
  catch { throw new YoutubeError("profile_key_unavailable", "Reconnect YouTube from your profile."); }
  return { token: await refreshYoutubeAccess(client, refresh, fetcher), version: connection.version };
}
