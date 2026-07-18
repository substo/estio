import db from "@/lib/db";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

export type MarketServiceAreaKind =
  | "country"
  | "region"
  | "city"
  | "district"
  | "locality"
  | "neighborhood";

export type MarketServiceArea = {
  id: string;
  label: string;
  aliases: string[];
  parentId: string | null;
  kind: MarketServiceAreaKind;
};

export type LocationMarketContext = {
  locationId: string;
  locationName: string | null;
  countryCode: string | null;
  countryName: string | null;
  locale: string | null;
  currencyCode: string | null;
  supportedLanguages: string[];
  serviceAreas: MarketServiceArea[];
  source: {
    configured: boolean;
    inventoryFallback: boolean;
  };
};

type MarketProfileInput = Partial<Omit<LocationMarketContext, "locationId" | "locationName" | "source">>;

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function token(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function mostCommon(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, { value: string; count: number }>();
  for (const raw of values) {
    const value = text(raw);
    if (!value) continue;
    const key = token(value);
    const current = counts.get(key);
    counts.set(key, { value: current?.value || value, count: (current?.count || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))[0]?.value || null;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = text(raw);
    const key = token(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function countryCode(value: unknown): string | null {
  const normalized = text(value);
  return normalized && /^[a-z]{2}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

function configuredAreas(value: unknown): MarketServiceArea[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const label = text(item.label);
    const id = text(item.id) || token(label);
    if (!label || !id || ids.has(id)) return [];
    ids.add(id);
    const kind = ["country", "region", "city", "district", "locality", "neighborhood"].includes(String(item.kind))
      ? item.kind as MarketServiceAreaKind
      : "locality";
    return [{
      id,
      label,
      aliases: uniqueStrings(Array.isArray(item.aliases) ? item.aliases : []),
      parentId: text(item.parentId),
      kind,
    }];
  });
}

export function buildLocationMarketContext(args: {
  locationId: string;
  locationName?: string | null;
  marketProfile?: MarketProfileInput | null;
  defaultCity?: string | null;
  defaultRegion?: string | null;
  defaultReplyLanguage?: string | null;
  inventory?: Array<{
    country?: string | null;
    currency?: string | null;
    city?: string | null;
    propertyLocation?: string | null;
    propertyArea?: string | null;
  }>;
}): LocationMarketContext {
  const profile = args.marketProfile || {};
  const inventory = args.inventory || [];
  const explicitAreas = configuredAreas(profile.serviceAreas);
  const inferredAreaValues = uniqueStrings([
    args.defaultRegion,
    args.defaultCity,
    ...inventory.flatMap((item) => [item.city, item.propertyLocation, item.propertyArea]),
  ]);
  const explicitTokens = new Set(explicitAreas.flatMap((area) => [area.label, ...area.aliases].map(token)));
  const defaultRegionToken = token(args.defaultRegion);
  const defaultCityToken = token(args.defaultCity);
  const inferredAreas: MarketServiceArea[] = inferredAreaValues.flatMap((label) => {
    const areaToken = token(label);
    if (!areaToken || explicitTokens.has(areaToken)) return [];
    const kind: MarketServiceAreaKind = areaToken === defaultRegionToken
      ? "region"
      : areaToken === defaultCityToken || inventory.some((item) => token(item.city) === areaToken)
        ? "city"
        : inventory.some((item) => token(item.propertyArea) === areaToken)
          ? "neighborhood"
          : "locality";
    return [{ id: `inventory:${areaToken}`, label, aliases: [], parentId: null, kind }];
  });
  const configuredLanguages = Array.isArray(profile.supportedLanguages) ? profile.supportedLanguages : [];
  const inventoryCountry = mostCommon(inventory.map((item) => item.country));

  return {
    locationId: args.locationId,
    locationName: text(args.locationName),
    countryCode: countryCode(profile.countryCode) || countryCode(inventoryCountry),
    countryName: text(profile.countryName) || inventoryCountry,
    locale: text(profile.locale),
    currencyCode: text(profile.currencyCode) || mostCommon(inventory.map((item) => item.currency)),
    supportedLanguages: uniqueStrings([...configuredLanguages, args.defaultReplyLanguage]),
    serviceAreas: [...explicitAreas, ...inferredAreas],
    source: {
      configured: Boolean(text(profile.countryCode) || text(profile.countryName) || text(profile.locale) || text(profile.currencyCode) || explicitAreas.length || configuredLanguages.length),
      inventoryFallback: inferredAreas.length > 0 || Boolean(inventory.length),
    },
  };
}

export async function getLocationMarketContext(locationId: string): Promise<LocationMarketContext> {
  const cached = marketContextCache.get(locationId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await loadLocationMarketContext(locationId);
  marketContextCache.set(locationId, { value, expiresAt: Date.now() + MARKET_CONTEXT_CACHE_MS });
  return value;
}

const MARKET_CONTEXT_CACHE_MS = 60_000;
const marketContextCache = new Map<string, { value: LocationMarketContext; expiresAt: number }>();

export function clearLocationMarketContextCache(locationId?: string) {
  if (locationId) marketContextCache.delete(locationId);
  else marketContextCache.clear();
}

async function loadLocationMarketContext(locationId: string): Promise<LocationMarketContext> {
  const [location, publicSite, aiSettings, inventory] = await Promise.all([
    db.location.findUnique({ where: { id: locationId }, select: { name: true, siteConfig: { select: { defaultCity: true, defaultRegion: true } } } }),
    settingsService.getDocument<any>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE }),
    settingsService.getDocument<any>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI }),
    db.property.findMany({
      where: { locationId },
      select: { country: true, currency: true, city: true, propertyLocation: true, propertyArea: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);
  return buildLocationMarketContext({
    locationId,
    locationName: location?.name,
    marketProfile: publicSite?.payload?.marketProfile,
    defaultCity: location?.siteConfig?.defaultCity,
    defaultRegion: location?.siteConfig?.defaultRegion,
    defaultReplyLanguage: aiSettings?.payload?.defaultReplyLanguage,
    inventory,
  });
}
