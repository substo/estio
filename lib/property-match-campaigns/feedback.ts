import { extractLegacyCrmRefCandidates } from "@/lib/crm/old-crm-import";
import { extractHttpUrls } from "@/lib/ai/property-evidence-resolver/domain-policy";

export type ExplicitPropertyFeedback = {
  eventType: "liked" | "rejected" | "replied" | "viewing_requested";
  sentiment: "positive" | "negative";
  reason:
    | "interested"
    | "liked"
    | "availability_question"
    | "details_question"
    | "viewing_request"
    | "not_interested"
    | "disliked"
    | "price_rejection"
    | "location_rejection"
    | "size_rejection"
    | "not_suitable";
};

export type PropertyTextAnchors = {
  references: string[];
  urls: string[];
};

export type PropertyAnchorTarget = {
  id: string;
  reference?: string | null;
  slug?: string | null;
  externalPublicUrl?: string | null;
  agentUrl?: string | null;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function extractPropertyTextAnchors(text: unknown): PropertyTextAnchors {
  const body = String(text || "");
  return {
    references: unique(
      extractLegacyCrmRefCandidates(body).map((candidate) => candidate.publicReference.toUpperCase()),
    ),
    urls: unique(extractHttpUrls(body)),
  };
}

export function hasPropertyTextAnchors(anchors: PropertyTextAnchors): boolean {
  return anchors.references.length > 0 || anchors.urls.length > 0;
}

function canonicalUrl(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return text.replace(/\/$/, "");
  }
}

function urlContainsSlug(url: string, slug: unknown): boolean {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!normalizedSlug) return false;
  try {
    return new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .some((part) => decodeURIComponent(part).toLowerCase() === normalizedSlug);
  } catch {
    return false;
  }
}

export function resolveSinglePropertyAnchor<T extends PropertyAnchorTarget>(
  anchors: PropertyTextAnchors,
  properties: T[],
): T | null {
  const anchorMatches: T[][] = [
    ...anchors.references.map((reference) => properties.filter(
      (property) => String(property.reference || "").toUpperCase() === reference.toUpperCase(),
    )),
    ...anchors.urls.map((url) => properties.filter((property) => {
      const canonical = canonicalUrl(url);
      return [property.externalPublicUrl, property.agentUrl]
        .map(canonicalUrl)
        .some((candidate) => candidate && candidate === canonical)
        || urlContainsSlug(url, property.slug);
    })),
  ];
  if (anchorMatches.length === 0 || anchorMatches.some((matches) => matches.length !== 1)) return null;
  const matchedIds = new Set(anchorMatches.flat().map((property) => property.id));
  if (matchedIds.size !== 1) return null;
  return anchorMatches[0][0];
}

export function classifyExplicitPropertyFeedback(
  text: unknown,
  options: { allowTrustedThirdPerson?: boolean } = {},
): ExplicitPropertyFeedback | null {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return null;

  if (
    /\b(?:arrange|book|schedule)\s+(?:a\s+)?viewing\b/i.test(body)
    || /\b(?:can|could|may)\s+(?:i|we)\s+(?:see|view|visit)\b/i.test(body)
    || /\b(?:i|we)(?:'d| would)?\s+like\s+to\s+(?:see|view|visit)\b/i.test(body)
    || /\bwhen\s+(?:can|could)\s+(?:i|we)\s+(?:see|view|visit)\b/i.test(body)
    || (options.allowTrustedThirdPerson && /\b(?:client|customer|contact|lead|buyer)\s+(?:wants?|would\s+like)\s+to\s+(?:see|view|visit)\b/i.test(body))
  ) {
    return { eventType: "viewing_requested", sentiment: "positive", reason: "viewing_request" };
  }

  if (
    /\b(?:not interested|no longer interested)\b/i.test(body)
    || /\b(?:i|we)(?:'m| am|'re| are)?\s+not\s+interested\b/i.test(body)
    || /\b(?:no thanks|no thank you|not for (?:me|us)|(?:i|we)(?:'ll| will)?\s+pass)\b/i.test(body)
  ) {
    return { eventType: "rejected", sentiment: "negative", reason: "not_interested" };
  }

  if (
    /\b(?:i|we)\s+(?:do not|don't|dont)\s+like\b/i.test(body)
    || /\b(?:i|we)\s+(?:do not|don't|dont)\s+want\s+(?:this|that|it)\b/i.test(body)
  ) {
    return { eventType: "rejected", sentiment: "negative", reason: "disliked" };
  }

  if (
    /\b(?:it(?:'s| is)|this(?: is)?|that(?: is)?|DT\d{2,6}\s+is)\s+too\s+(?:expensive|pricey|pricy)\b/i.test(body)
    || /^(?:way\s+|much\s+)?too\s+(?:expensive|pricey|pricy)\b/i.test(body)
    || /\b(?:above|over|outside)\s+(?:(?:my|our|the)\s+)?budget\b/i.test(body)
  ) {
    return { eventType: "rejected", sentiment: "negative", reason: "price_rejection" };
  }

  if (
    /\b(?:wrong|not (?:the )?right)\s+(?:area|location|district|village|city)\b/i.test(body)
    || /\btoo\s+far\s+(?:away|from)\b/i.test(body)
  ) {
    return { eventType: "rejected", sentiment: "negative", reason: "location_rejection" };
  }

  if (/\b(?:it(?:'s| is)|this(?: is)?|that(?: is)?)\s+too\s+(?:small|large|big)\b/i.test(body)) {
    return { eventType: "rejected", sentiment: "negative", reason: "size_rejection" };
  }

  if (/\b(?:not suitable|does not suit (?:me|us)|doesn't suit (?:me|us)|won't work for (?:me|us))\b/i.test(body)) {
    return { eventType: "rejected", sentiment: "negative", reason: "not_suitable" };
  }

  if (
    /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:very\s+|really\s+)?interested\b/i.test(body)
    || /\bthis\s+(?:one\s+)?interests\s+(?:me|us)\b/i.test(body)
    || (options.allowTrustedThirdPerson && /\b(?:client|customer|contact|lead|buyer)\s+(?:is|was)\s+(?:very\s+|really\s+)?interested\b/i.test(body))
  ) {
    return { eventType: "liked", sentiment: "positive", reason: "interested" };
  }

  if (
    /\b(?:i|we)\s+(?:really\s+)?like\s+(?:this|that|it)(?:\s+one)?\b/i.test(body)
    || /\b(?:it|this|that)\s+(?:looks|sounds)\s+(?:very\s+|really\s+)?good\b/i.test(body)
    || (options.allowTrustedThirdPerson && /\b(?:client|customer|contact|lead|buyer)\s+(?:likes?|liked)\b/i.test(body))
  ) {
    return { eventType: "liked", sentiment: "positive", reason: "liked" };
  }

  if (/\bis\s+(?:this|it)\s+(?:still\s+)?available\b/i.test(body) || /\bit(?:'s| is)\s+still\s+available\b/i.test(body)) {
    return { eventType: "replied", sentiment: "positive", reason: "availability_question" };
  }

  if (
    /\b(?:can|could)\s+(?:you\s+)?(?:send|share)\s+(?:me\s+|us\s+)?(?:more\s+)?(?:details|information|photos|pictures|the floor plan)\b/i.test(body)
    || /\b(?:what(?:'s| is)\s+the\s+price|which\s+(?:area|location)\s+is\s+it)\b/i.test(body)
  ) {
    return { eventType: "replied", sentiment: "positive", reason: "details_question" };
  }

  return null;
}
