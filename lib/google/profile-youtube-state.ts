import type { PlatformProfile } from "@/lib/platform/profile";
import { decryptStudioSecret } from "../studio/secrets";
import { equalOAuthState } from "./youtube-api";
import { youtubeProfileContext } from "./youtube-policy";
export function readProfileYoutubeState(raw: string | undefined, profile: PlatformProfile, params: URLSearchParams, now = Date.now()): { state: string; verifier: string } | null {
  try {
    if (!raw || raw.length > 4096 || params.getAll("state").length !== 1) return null;
    const sealed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const value = JSON.parse(decryptStudioSecret(sealed, youtubeProfileContext(profile.brand, profile.userId, "oauth")));
    if (value.brand !== profile.brand || value.userId !== profile.userId || value.sessionId !== profile.sessionId || value.origin !== profile.origin
      || typeof value.expires !== "number" || value.expires <= now || value.expires > now + 600_000
      || typeof value.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.state)
      || typeof value.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier)
      || !equalOAuthState(value.state, params.get("state")!)) return null;
    return { state: value.state, verifier: value.verifier };
  } catch { return null; }
}
