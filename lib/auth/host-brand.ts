/** Host identities for the two first-party application experiences. */
export type HostBrand = "estio" | "substo" | "tenant";

export interface HostBrandConfig {
  estioHosts: readonly string[];
  substoHosts: readonly string[];
  /** Local hosts that should open the Estio experience by default. */
  estioDevelopmentHosts?: readonly string[];
}

/** Construct an origin without treating domains containing "localhost" as local. */
export function getHostOrigin(host: string | null | undefined): string | null {
  if (!host) return null;
  try {
    const url = new URL(`https://${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
    url.hostname = hostname;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]") url.protocol = "http:";
    const port = host.match(/:(\d+)$/)?.[1];
    if (port) url.port = port;
    return url.origin;
  } catch { return null; }
}

function normalizeHost(host: string | null | undefined): string {
  if (!host) return "";
  const normalized = host.trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const closingBracket = normalized.indexOf("]");
    if (closingBracket >= 0) return normalized.slice(1, closingBracket);
  }
  // Host headers may include a port. A bare IPv6 address is left intact.
  const withoutPort = normalized.includes(":") && !normalized.includes("::")
    ? normalized.replace(/:\d+$/, "")
    : normalized;
  return withoutPort.replace(/\.$/, "");
}

function parseHostList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
}

/**
 * Resolve a request host using exact allowlist membership only.
 * Unknown hosts intentionally remain tenant hosts for Estio's public-site routing.
 */
export function resolveHostBrand(
  requestHost: string | null | undefined,
  config: HostBrandConfig,
): HostBrand {
  const host = normalizeHost(requestHost);
  if (!host) return "tenant";

  if (config.substoHosts.some((allowed) => normalizeHost(allowed) === host)) {
    return "substo";
  }

  const estioHosts = [
    ...config.estioHosts,
    ...(config.estioDevelopmentHosts ?? []),
  ];
  if (estioHosts.some((allowed) => normalizeHost(allowed) === host)) {
    return "estio";
  }

  return "tenant";
}

/** Runtime host configuration. Production Substo hosts must be explicitly allowlisted. */
export function getHostBrandConfig(env: NodeJS.ProcessEnv = process.env): HostBrandConfig {
  return {
    estioHosts: [
      "estio.co",
      "www.estio.co",
      "clerk.estio.co",
      env.NEXT_PUBLIC_APP_DOMAIN,
      env.NEXT_PUBLIC_CLERK_DOMAIN,
      ...parseHostList(env.ESTIO_APP_HOSTS),
    ].filter((host): host is string => Boolean(host)),
    substoHosts: parseHostList(env.SUBSTO_APP_HOSTS),
    estioDevelopmentHosts: ["localhost", "127.0.0.1", "::1"],
  };
}
