type RequestOriginInput = {
  origin: string | null;
  requestOrigin: string;
  appUrl: string;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
};

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string {
  return String(value || "").split(",")[0].trim();
}

export function isAllowedRequestOrigin(input: RequestOriginInput): boolean {
  if (!input.origin) return true;
  const origin = normalizedOrigin(input.origin);
  if (!origin) return false;

  const allowed = new Set<string>();
  for (const candidate of [input.requestOrigin, input.appUrl]) {
    const normalized = normalizedOrigin(candidate);
    if (normalized) allowed.add(normalized);
  }

  const host = firstHeaderValue(input.forwardedHost) || firstHeaderValue(input.host);
  const forwardedProto = firstHeaderValue(input.forwardedProto).toLowerCase();
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : normalizedOrigin(input.requestOrigin)?.split(":")[0];
  if (host && protocol) {
    const publicRequestOrigin = normalizedOrigin(`${protocol}://${host}`);
    if (publicRequestOrigin) allowed.add(publicRequestOrigin);
  }

  return allowed.has(origin);
}
