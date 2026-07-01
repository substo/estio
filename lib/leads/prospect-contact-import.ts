import { buildCanonicalContactName, normalizeWhitespace } from "@/lib/contacts/name-builder";

type ProspectContactListing = {
  title?: string | null;
  price?: number | null;
  currency?: string | null;
  propertyType?: string | null;
  listingType?: string | null;
  locationText?: string | null;
  bedrooms?: number | null;
  externalId?: string | null;
  url?: string | null;
};

type ProspectContactData = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
};

function formatListingPrice(listing?: ProspectContactListing | null): string | null {
  if (!listing?.price || listing.price <= 0) return null;
  const currency = normalizeWhitespace(listing.currency) || "EUR";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(listing.price);
  return `${currency} ${formatted}`;
}

function inferRequirementStatus(listing?: ProspectContactListing | null): "For Rent" | "For Sale" {
  return String(listing?.listingType || "").trim().toLowerCase() === "rent" ? "For Rent" : "For Sale";
}

function pickPrimaryListing(listings?: ProspectContactListing[] | null): ProspectContactListing | null {
  const usable = (listings || []).filter(Boolean);
  return usable.find((listing) => normalizeWhitespace(listing.title) || normalizeWhitespace(listing.locationText)) || usable[0] || null;
}

export function buildProspectImportContactName(args: {
  prospect: ProspectContactData;
  listings?: ProspectContactListing[] | null;
}): string {
  const listing = pickPrimaryListing(args.listings);
  const rawLeadText = [
    args.prospect.message,
    args.prospect.sourceUrl,
    listing?.title,
    listing?.url,
    listing?.externalId,
    listing?.locationText,
    listing?.listingType,
  ].filter(Boolean).join("\n");

  return buildCanonicalContactName({
    contact: {
      name: args.prospect.name,
      firstName: args.prospect.firstName,
      lastName: args.prospect.lastName,
      email: args.prospect.email,
      phone: args.prospect.phone,
      role: "Lead",
    },
    contactType: "Lead",
    rawLeadText,
    inferredStatus: inferRequirementStatus(listing),
    requirements: listing
      ? {
          type: listing.propertyType,
          bedrooms: listing.bedrooms ? String(listing.bedrooms) : null,
          location: listing.locationText,
          budget: formatListingPrice(listing),
        }
      : null,
  });
}

