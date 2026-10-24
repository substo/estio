import { getHostBrandConfig, resolveHostBrand, type HostBrand } from "@/lib/auth/host-brand";

export interface ClerkBrandKeys {
  publishableKey: string;
  secretKey: string;
}

type ClerkSatelliteProps = { isSatellite: true; domain: string } | { isSatellite?: never; domain?: never };

/** Primary realms omit satellite options; tenant satellites name their own host. */
export function getClerkSatelliteProps(brand: HostBrand, origin: string): ClerkSatelliteProps {
  const url = new URL(origin);
  return brand === "tenant" && url.protocol === "https:"
    ? { isSatellite: true, domain: url.hostname }
    : {};
}

/** Reject shared realm settings: SDK OR-merging makes false/empty overrides ineffective. */
export function getSubstoClerkConfigConflicts(env: NodeJS.ProcessEnv = process.env): string[] {
  const conflicts = [
    "NEXT_PUBLIC_CLERK_DOMAIN",
    "NEXT_PUBLIC_CLERK_PROXY_URL",
    "CLERK_DOMAIN",
    "CLERK_PROXY_URL",
    "NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL",
    "NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL",
    "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
    "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
  ].filter((key) => Boolean(env[key]?.trim()));
  if (env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true" || env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "1") {
    conflicts.push("NEXT_PUBLIC_CLERK_IS_SATELLITE");
  }
  if (env.CLERK_IS_SATELLITE === "true" || env.CLERK_IS_SATELLITE === "1") {
    conflicts.push("CLERK_IS_SATELLITE");
  }
  const scriptUrl = env.NEXT_PUBLIC_CLERK_JS_URL?.trim();
  if (scriptUrl) {
    try {
      const url = new URL(scriptUrl, "https://clerk-cdn.invalid");
      if (url.pathname === "/api/__clerk" || url.pathname.startsWith("/api/__clerk/") ||
          resolveHostBrand(url.host, getHostBrandConfig(env)) === "estio") {
        conflicts.push("NEXT_PUBLIC_CLERK_JS_URL");
      }
    } catch { /* The SDK can report malformed generic script URLs separately. */ }
  }
  return conflicts;
}

/** Resolve auth keys only for a brand established by the trusted host allowlist. */
export function getClerkBrandKeys(
  brand: Exclude<HostBrand, "tenant">,
  env: NodeJS.ProcessEnv = process.env,
): ClerkBrandKeys | null {
  if (brand === "substo") {
    const publishableKey = env.SUBSTO_CLERK_PUBLISHABLE_KEY?.trim();
    const secretKey = env.SUBSTO_CLERK_SECRET_KEY?.trim();
    return publishableKey && secretKey ? { publishableKey, secretKey } : null;
  }

  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  return publishableKey && secretKey ? { publishableKey, secretKey } : null;
}

export function hasClerkEncryptionKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CLERK_ENCRYPTION_KEY?.trim());
}
