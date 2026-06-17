import { auth } from "@clerk/nextjs/server";
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import crypto from "crypto";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { getSiteConfig } from "@/lib/public-data";
import {
  analyticsEventNameSchema,
  isConversionEvent,
  type AnalyticsEventName,
} from "@/lib/analytics/events";

const VISITOR_COOKIE = "estio_visitor_id";
const SESSION_COOKIE = "estio_session_id";

const BOT_UA_PATTERN =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|linkedinbot|pinterest|discordbot|embedly|quora link preview|preview/i;

const STATIC_PATH_PATTERN =
  /^\/(?:_next|favicon\.ico|robots\.txt|sitemap\.xml|images\/|api\/health)|\.(?:css|js|png|jpg|jpeg|gif|webp|svg|ico|csv|docx?|xlsx?|zip|webmanifest)$/i;

export type AnalyticsRequestContext = {
  headers?: Headers;
  cookies?: {
    get(name: string): { value: string } | undefined;
  };
  setCookie?: (name: string, value: string, options: string) => void;
};

export type RecordAnalyticsInput = {
  eventName: AnalyticsEventName | string;
  locationId?: string | null;
  domain?: string | null;
  anonymousId?: string | null;
  externalSessionId?: string | null;
  path?: string | null;
  title?: string | null;
  referrer?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  propertyId?: string | null;
  contactId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date | string | null;
  context?: AnalyticsRequestContext;
};

export type AnalyticsRecordResult = {
  recorded: boolean;
  visitorAnonymousId?: string;
  externalSessionId?: string;
};

export type AnalyticsRouteRecordResult = AnalyticsRecordResult & {
  headers: Headers;
};

function normalizeId(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(trimmed) ? trimmed : "";
}

function newPublicId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

function truncate(value: string | null | undefined, max: number) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function getHeader(headers: Headers | undefined, name: string) {
  return headers?.get(name) || headers?.get(name.toLowerCase()) || null;
}

function getIp(headers?: Headers) {
  const forwarded = getHeader(headers, "x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  return (
    firstForwarded ||
    getHeader(headers, "x-real-ip") ||
    getHeader(headers, "cf-connecting-ip") ||
    null
  );
}

function hashIp(ip: string | null) {
  if (!ip) return null;
  const salt = process.env.ANALYTICS_IP_HASH_SALT || process.env.NEXTAUTH_SECRET || "estio-analytics";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function parseDevice(userAgent: string | null) {
  const ua = userAgent || "";
  const lower = ua.toLowerCase();
  const deviceType = /mobile|iphone|android/.test(lower)
    ? "mobile"
    : /ipad|tablet/.test(lower)
      ? "tablet"
      : "desktop";
  const browser = lower.includes("edg/")
    ? "Edge"
    : lower.includes("chrome/")
      ? "Chrome"
      : lower.includes("safari/") && !lower.includes("chrome/")
        ? "Safari"
        : lower.includes("firefox/")
          ? "Firefox"
          : null;
  const os = lower.includes("windows")
    ? "Windows"
    : lower.includes("mac os")
      ? "macOS"
      : lower.includes("android")
        ? "Android"
        : lower.includes("iphone") || lower.includes("ipad")
          ? "iOS"
          : lower.includes("linux")
            ? "Linux"
            : null;
  return { browser, os, deviceType };
}

function parseAttribution(path: string | null, referrer: string | null) {
  let source: string | null = null;
  let medium: string | null = null;
  let campaign: string | null = null;
  let term: string | null = null;
  let content: string | null = null;

  try {
    const url = new URL(path || "/", "https://estio.local");
    source = truncate(url.searchParams.get("utm_source"), 128);
    medium = truncate(url.searchParams.get("utm_medium"), 128);
    campaign = truncate(url.searchParams.get("utm_campaign"), 128);
    term = truncate(url.searchParams.get("utm_term"), 128);
    content = truncate(url.searchParams.get("utm_content"), 128);
  } catch {
    // Ignore malformed paths; direct traffic fallback below still applies.
  }

  if (!source && referrer) {
    try {
      source = new URL(referrer).hostname.replace(/^www\./, "");
      medium = "referral";
    } catch {
      source = "referral";
      medium = "referral";
    }
  }

  return {
    source: source || "direct",
    medium: medium || (source ? "none" : "direct"),
    campaign,
    term,
    content,
  };
}

function getGeo(headers?: Headers) {
  return {
    country: truncate(getHeader(headers, "x-vercel-ip-country") || getHeader(headers, "cf-ipcountry"), 64),
    region: truncate(getHeader(headers, "x-vercel-ip-country-region"), 128),
    city: truncate(getHeader(headers, "x-vercel-ip-city"), 128),
  };
}

function isIgnorableRequest(path: string | null, userAgent: string | null) {
  if (path && STATIC_PATH_PATTERN.test(path)) return true;
  return Boolean(userAgent && BOT_UA_PATTERN.test(userAgent));
}

async function resolveLocationId(input: RecordAnalyticsInput) {
  if (input.locationId) return input.locationId;
  if (input.domain) {
    const config = await getSiteConfig(input.domain);
    return config?.locationId || null;
  }
  const location = await getLocationContext().catch(() => null);
  return location?.id || null;
}

async function resolveLocalUserId(explicitUserId?: string | null) {
  if (explicitUserId) return explicitUserId;
  const { userId: clerkId } = await auth().catch(() => ({ userId: null }));
  if (!clerkId) return null;
  const user = await db.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  return user?.id || null;
}

async function resolveAnalyticsContext(context?: AnalyticsRequestContext): Promise<AnalyticsRequestContext> {
  if (context?.headers || context?.cookies) return context;

  try {
    const [headerList, cookieStore] = await Promise.all([
      nextHeaders(),
      nextCookies(),
    ]);
    return {
      headers: headerList,
      cookies: cookieStore,
    };
  } catch {
    return context || {};
  }
}

export function buildAnalyticsCookie(name: string, value: string) {
  return `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

export async function recordAnalyticsRouteEvent(input: Omit<RecordAnalyticsInput, "context"> & {
  headers: Headers;
  cookies: AnalyticsRequestContext["cookies"];
}): Promise<AnalyticsRouteRecordResult> {
  const { headers, cookies, ...eventInput } = input;
  const responseHeaders = new Headers();
  const result = await recordAnalyticsEvent({
    ...eventInput,
    context: {
      headers,
      cookies,
      setCookie: (_name, _value, header) => responseHeaders.append("Set-Cookie", header),
    },
  });

  return {
    ...result,
    headers: responseHeaders,
  };
}

export async function recordPropertyAnalyticsEvent(input: Omit<RecordAnalyticsInput, "entityType" | "entityId"> & {
  propertyId: string;
}) {
  return recordAnalyticsEvent({
    ...input,
    entityType: "property",
    entityId: input.propertyId,
  });
}

export async function recordAnalyticsEvent(input: RecordAnalyticsInput): Promise<AnalyticsRecordResult> {
  const parsedName = analyticsEventNameSchema.safeParse(input.eventName);
  if (!parsedName.success) return { recorded: false };

  const eventName = parsedName.data;
  const context = await resolveAnalyticsContext(input.context);
  const headers = context.headers;
  const cookies = context.cookies;
  const userAgent = truncate(getHeader(headers, "user-agent"), 2048);
  const path = truncate(input.path || getHeader(headers, "x-invoke-path"), 2048);

  if (isIgnorableRequest(path, userAgent)) return { recorded: false };

  const locationId = await resolveLocationId(input);
  if (!locationId) return { recorded: false };

  const anonymousId =
    normalizeId(input.anonymousId) ||
    normalizeId(cookies?.get(VISITOR_COOKIE)?.value) ||
    newPublicId("vis");
  const externalSessionId =
    normalizeId(input.externalSessionId) ||
    normalizeId(cookies?.get(SESSION_COOKIE)?.value) ||
    newPublicId("ses");

  const referrer = truncate(input.referrer || getHeader(headers, "referer"), 2048);
  const attribution = parseAttribution(path, referrer);
  const ipHash = hashIp(getIp(headers));
  const geo = getGeo(headers);
  const device = parseDevice(userAgent);
  const now = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const userId = await resolveLocalUserId(input.userId);
  const contactId = truncate(input.contactId, 128);
  const propertyId = truncate(input.propertyId, 128);

  context.setCookie?.(VISITOR_COOKIE, anonymousId, buildAnalyticsCookie(VISITOR_COOKIE, anonymousId));
  context.setCookie?.(SESSION_COOKIE, externalSessionId, buildAnalyticsCookie(SESSION_COOKIE, externalSessionId));

  try {
    const visitor = await (db as any).analyticsVisitor.upsert({
      where: {
        locationId_anonymousId: { locationId, anonymousId },
      },
      update: {
        lastSeenAt: now,
        userId: userId || undefined,
        contactId: contactId || undefined,
        lastSource: attribution.source,
        lastMedium: attribution.medium,
        lastCampaign: attribution.campaign,
        lastReferrer: referrer,
        lastLandingPath: path,
        ipHash,
        ...geo,
        userAgent,
        ...device,
      },
      create: {
        locationId,
        anonymousId,
        firstSeenAt: now,
        lastSeenAt: now,
        userId: userId || undefined,
        contactId: contactId || undefined,
        firstSource: attribution.source,
        firstMedium: attribution.medium,
        firstCampaign: attribution.campaign,
        firstReferrer: referrer,
        firstLandingPath: path,
        lastSource: attribution.source,
        lastMedium: attribution.medium,
        lastCampaign: attribution.campaign,
        lastReferrer: referrer,
        lastLandingPath: path,
        ipHash,
        ...geo,
        userAgent,
        ...device,
      },
      select: { id: true },
    });

    const session = await (db as any).analyticsSession.upsert({
      where: {
        locationId_externalSessionId: { locationId, externalSessionId },
      },
      update: {
        lastSeenAt: now,
        currentPath: path,
        eventCount: { increment: 1 },
        pageViewCount: eventName === "page_view" || eventName === "admin_page_view" ? { increment: 1 } : undefined,
        convertedAt: isConversionEvent(eventName) ? now : undefined,
      },
      create: {
        locationId,
        visitorId: visitor.id,
        externalSessionId,
        startedAt: now,
        lastSeenAt: now,
        landingPath: path || "/",
        currentPath: path,
        referrer,
        ...attribution,
        ipHash,
        ...geo,
        userAgent,
        ...device,
        eventCount: 1,
        pageViewCount: eventName === "page_view" || eventName === "admin_page_view" ? 1 : 0,
        convertedAt: isConversionEvent(eventName) ? now : undefined,
      },
      select: { id: true },
    });

    await (db as any).analyticsEvent.create({
      data: {
        locationId,
        visitorId: visitor.id,
        sessionId: session.id,
        userId: userId || undefined,
        contactId: contactId || undefined,
        propertyId: propertyId || undefined,
        eventName,
        path,
        title: truncate(input.title, 255),
        referrer,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        entityType: truncate(input.entityType, 64),
        entityId: truncate(input.entityId, 128),
        metadata: input.metadata || undefined,
        occurredAt: now,
      },
    });

    return { recorded: true, visitorAnonymousId: anonymousId, externalSessionId };
  } catch (error) {
    console.warn("[analytics] failed to record event", {
      eventName,
      locationId,
      error,
    });
    return { recorded: false, visitorAnonymousId: anonymousId, externalSessionId };
  }
}
