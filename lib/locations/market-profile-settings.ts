import type { MarketServiceArea, MarketServiceAreaKind } from "@/lib/locations/market-context";

export type LocationMarketProfileSettings = {
  countryCode: string | null;
  countryName: string | null;
  locale: string | null;
  currencyCode: string | null;
  supportedLanguages: string[];
  serviceAreas: MarketServiceArea[];
};

export type MarketProfileField =
  | "marketCountryCode"
  | "marketCountryName"
  | "marketLocale"
  | "marketCurrencyCode"
  | "marketSupportedLanguages"
  | "marketServiceAreas";

const SERVICE_AREA_KINDS = new Set<MarketServiceAreaKind>([
  "country",
  "region",
  "city",
  "district",
  "locality",
  "neighborhood",
]);

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function canonicalLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] || null;
  } catch {
    return null;
  }
}

function parseServiceAreas(value: unknown): {
  serviceAreas: MarketServiceArea[];
  error?: string;
} {
  const source = optionalText(value);
  if (!source) return { serviceAreas: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { serviceAreas: [], error: "Service areas must be valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { serviceAreas: [], error: "Service areas must be a JSON array." };
  }

  const ids = new Set<string>();
  const serviceAreas: MarketServiceArea[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const raw = parsed[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { serviceAreas: [], error: `Service area ${index + 1} must be an object.` };
    }
    const item = raw as Record<string, unknown>;
    const id = optionalText(item.id);
    const label = optionalText(item.label);
    const kind = optionalText(item.kind) as MarketServiceAreaKind | null;
    const parentId = optionalText(item.parentId);
    if (!id || !label) {
      return { serviceAreas: [], error: `Service area ${index + 1} requires id and label.` };
    }
    if (ids.has(id)) {
      return { serviceAreas: [], error: `Service area id "${id}" is duplicated.` };
    }
    if (!kind || !SERVICE_AREA_KINDS.has(kind)) {
      return { serviceAreas: [], error: `Service area "${id}" has an invalid kind.` };
    }
    if (!Array.isArray(item.aliases) || item.aliases.some((alias) => !optionalText(alias))) {
      return { serviceAreas: [], error: `Service area "${id}" aliases must be an array of non-empty strings.` };
    }
    ids.add(id);
    serviceAreas.push({
      id,
      label,
      kind,
      parentId,
      aliases: Array.from(new Set(item.aliases.map((alias) => String(alias).trim()))),
    });
  }

  for (const area of serviceAreas) {
    if (area.parentId && !ids.has(area.parentId)) {
      return { serviceAreas: [], error: `Service area "${area.id}" references unknown parent "${area.parentId}".` };
    }
    const visited = new Set([area.id]);
    let parentId = area.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        return { serviceAreas: [], error: `Service area hierarchy contains a cycle at "${area.id}".` };
      }
      visited.add(parentId);
      parentId = serviceAreas.find((candidate) => candidate.id === parentId)?.parentId || null;
    }
  }

  return { serviceAreas };
}

export function parseLocationMarketProfileSettings(input: {
  countryCode?: unknown;
  countryName?: unknown;
  locale?: unknown;
  currencyCode?: unknown;
  supportedLanguages?: unknown;
  serviceAreasJson?: unknown;
}): {
  profile?: LocationMarketProfileSettings;
  errors?: Partial<Record<MarketProfileField, string[]>>;
} {
  const errors: Partial<Record<MarketProfileField, string[]>> = {};
  const rawCountryCode = optionalText(input.countryCode);
  const countryCode = rawCountryCode?.toUpperCase() || null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    errors.marketCountryCode = ["Use a two-letter ISO country code, for example ES or AE."];
  }
  const rawCurrencyCode = optionalText(input.currencyCode);
  const currencyCode = rawCurrencyCode?.toUpperCase() || null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    errors.marketCurrencyCode = ["Use a three-letter ISO currency code, for example EUR or AED."];
  }
  const rawLocale = optionalText(input.locale);
  const locale = rawLocale ? canonicalLocale(rawLocale) : null;
  if (rawLocale && !locale) {
    errors.marketLocale = ["Use a valid locale, for example es-ES or ar-AE."];
  }
  const languageValues = String(input.supportedLanguages ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const supportedLanguages: string[] = [];
  for (const language of languageValues) {
    const canonical = canonicalLocale(language);
    if (!canonical) {
      errors.marketSupportedLanguages = [`"${language}" is not a valid language or locale code.`];
      break;
    }
    if (!supportedLanguages.includes(canonical)) supportedLanguages.push(canonical);
  }
  const parsedAreas = parseServiceAreas(input.serviceAreasJson);
  if (parsedAreas.error) errors.marketServiceAreas = [parsedAreas.error];

  if (Object.keys(errors).length > 0) return { errors };
  return {
    profile: {
      countryCode,
      countryName: optionalText(input.countryName),
      locale,
      currencyCode,
      supportedLanguages,
      serviceAreas: parsedAreas.serviceAreas,
    },
  };
}
