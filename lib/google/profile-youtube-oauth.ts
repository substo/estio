import { studioDb } from "@/lib/studio/studio-db";
import { readYoutubeRequestText } from "./youtube-request";
import { readProfileYoutubeState } from "./profile-youtube-state";
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPlatformProfile } from "@/lib/platform/profile";
import { encryptStudioSecret, hasStudioSecretsKey } from "@/lib/studio/secrets";
import { studioRest } from "@/lib/studio/rest";
import { exchangeYoutubeCode, newYoutubeOAuth, stateHash } from "./youtube-api";
import { youtubeClientConfig, youtubeProfileContext } from "./youtube-policy";
import { profileOAuthRpc } from "./profile-youtube";
const cookie = "platform-youtube-oauth";
const cookiePath = "/account/connections/google-youtube";
function response(origin: string, status: string) {
  const value = NextResponse.redirect(new URL(`/account/connections?youtube=${status}`, origin), 303);
  value.headers.set("Cache-Control", "private, no-store"); value.headers.set("Referrer-Policy", "no-referrer");
  value.cookies.set(cookie, "", { path: cookiePath, maxAge: 0 }); return value;
}
export async function startProfileYoutube(request: NextRequest) {
  const profile = await getPlatformProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  if (request.headers.get("origin") !== profile.origin) return new Response("Forbidden", { status: 403 });
  const client = youtubeClientConfig(); if (!client || !hasStudioSecretsKey()) return response(profile.origin, "not-configured");
  let form: URLSearchParams;
  try { form = new URLSearchParams(await readYoutubeRequestText(request)); } catch { return response(profile.origin, "consent-required"); }
  if (form.getAll("consent").length !== 1 || form.get("consent") !== "yes") return response(profile.origin, "consent-required");
  const redirectUri = `${profile.origin}${cookiePath}/callback`;
  const oauth = newYoutubeOAuth(client, redirectUri);
  if (!await profileOAuthRpc(profile, "begin", stateHash(oauth.state), stateHash(profile.sessionId))) return response(profile.origin, "invalid-state");
  const sealed = encryptStudioSecret(JSON.stringify({ ...profile, state: oauth.state, verifier: oauth.verifier, expires: Date.now() + 600_000 }), youtubeProfileContext(profile.brand, profile.userId, "oauth"));
  const result = NextResponse.redirect(oauth.url, 303);
  result.headers.set("Cache-Control", "private, no-store"); result.headers.set("Referrer-Policy", "no-referrer");
  result.cookies.set(cookie, Buffer.from(JSON.stringify(sealed)).toString("base64url"), { httpOnly: true, secure: profile.origin.startsWith("https:"), sameSite: "lax", maxAge: 600, path: cookiePath });
  return result;
}
export async function finishProfileYoutube(request: NextRequest) {
  const profile = await getPlatformProfile(); if (!profile) return new Response("Unauthorized", { status: 401 });
  try {
    const client = youtubeClientConfig();
    const params = request.nextUrl.searchParams;
    const state = readProfileYoutubeState(request.cookies.get(cookie)?.value, profile, params);
    if (!client || !state) return response(profile.origin, "invalid-state");
    if (!await profileOAuthRpc(profile, "consume", stateHash(state.state), stateHash(profile.sessionId))) return response(profile.origin, "invalid-state");
    if (params.has("error") || params.getAll("code").length !== 1 || !params.get("code") || params.get("code")!.length > 4096) return response(profile.origin, "not-connected");
    const refresh = await exchangeYoutubeCode(client, params.get("code")!, state.verifier, `${profile.origin}${cookiePath}/callback`);
    if (!await profileOAuthRpc(profile, "commit", stateHash(state.state), stateHash(profile.sessionId), refresh)) return response(profile.origin, "invalid-state");
    return response(profile.origin, "connected");
  } catch { return response(profile.origin, "not-connected"); }
}
export async function removeProfileYoutube(request: NextRequest) {
  const profile = await getPlatformProfile(); if (!profile) return new Response("Unauthorized", { status: 401 });
  if (request.headers.get("origin") !== profile.origin) return new Response("Forbidden", { status: 403 });
  await studioDb.call("platform_clear_youtube_connection", { p_app: profile.brand, p_user: profile.userId });
  return response(profile.origin, "removed");
}
