import db from '@/lib/db';

/**
 * Property Import Service
 *
 * Converts scraped listings into proper Property records when a prospect contact
 * is accepted. Links the imported property back to the contact via ContactPropertyRole
 * and creates PropertyMedia from scraped images.
 */

interface ImportResult {
  propertyId: string;
  slug: string;
  scrapedListingId: string;
}

/**
 * Generate a URL-safe slug from a title string.
 * Appends a timestamp suffix to guarantee uniqueness.
 */
function generateSlug(title: string | null, externalId: string): string {
  const base = (title || 'imported-property')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80);
  return `${base}-${externalId}-${Date.now()}`;
}

/**
 * Map a scraped listing type ("rent" | "sale") to the Property goal enum.
 */
function mapListingGoal(listingType: string | null | undefined): 'SALE' | 'RENT' {
  if (listingType?.toLowerCase() === 'rent') return 'RENT';
  return 'SALE';
}

/**
 * Import a single ScrapedListing as a Property record, create PropertyMedia for
 * its images, and establish a ContactPropertyRole linking the new Contact as Owner.
 *
 * Returns null if the listing has already been imported.
 */
export async function importScrapedListingAsProperty(
  listing: {
    id: string;
    title: string | null;
    description: string | null;
    price: number | null;
    currency: string | null;
    propertyType: string | null;
    listingType: string | null;
    locationText: string | null;
    images: string[];
    thumbnails: string[];
    bedrooms: number | null;
    bathrooms: number | null;
    propertyArea: number | null;
    plotArea: number | null;
    constructionYear: number | null;
    latitude: number | null;
    longitude: number | null;
    externalId: string;
    platform: string;
    url: string;
    rawAttributes: any;
    status: string;
  },
  contactId: string,
  locationId: string,
  userId: string,
  companyId?: string | null
): Promise<ImportResult | null> {
  // Skip already-imported listings
  if (listing.status === 'IMPORTED') return null;

  const slug = generateSlug(listing.title, listing.externalId);

  // Format rawAttributes into CRM features array
  const features: string[] = [];
  if (listing.rawAttributes && typeof listing.rawAttributes === 'object') {
    const EXCLUDED_RAW_KEYS = ['Bedrooms', 'Bathrooms', 'Property area', 'Plot area', 'Construction year', 'Location', 'Type'];
    for (const [key, value] of Object.entries(listing.rawAttributes)) {
      if (!EXCLUDED_RAW_KEYS.includes(key)) {
        features.push(`${key}: ${value}`);
      }
    }
  }

  // Create Property + PropertyMedia + ContactPropertyRole + update ScrapedListing in a transaction
  const result = await db.$transaction(async (tx) => {
    // 1. Create the Property
    const property = await tx.property.create({
      data: {
        locationId,
        title: listing.title || 'Imported Property',
        slug,
        description: listing.description,
        status: 'ACTIVE',
        type: listing.propertyType,
        price: listing.price,
        currency: listing.currency || 'EUR',
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        areaSqm: listing.propertyArea,
        plotAreaSqm: listing.plotArea,
        buildYear: listing.constructionYear,
        latitude: listing.latitude,
        longitude: listing.longitude,
        propertyLocation: listing.locationText,
        goal: mapListingGoal(listing.listingType),
        publicationStatus: 'DRAFT', // Never auto-publish scraped properties
        source: 'SCRAPED',
        scrapedListingId: listing.id,
        metadata: listing.rawAttributes || undefined,
        features,
      },
    });

    // 2. Create PropertyMedia from images
    if (listing.images.length > 0) {
      await tx.propertyMedia.createMany({
        data: listing.images.map((url, index) => ({
          propertyId: property.id,
          url,
          kind: 'IMAGE' as const,
          sortOrder: index,
        })),
      });
    }

    // 3. Link Contact as Owner via ContactPropertyRole
    await tx.contactPropertyRole.create({
      data: {
        contactId,
        propertyId: property.id,
        role: 'Owner',
        source: `scraped:${listing.platform}`,
      },
    });

    // 3b. If this prospect is an agency linked to a Company, attach CompanyPropertyRole
    if (companyId) {
      await tx.companyPropertyRole.upsert({
        where: {
          companyId_propertyId_role: {
            companyId,
            propertyId: property.id,
            role: 'Agency',
          },
        },
        update: {},
        create: {
          companyId,
          propertyId: property.id,
          role: 'Agency',
        },
      });
    }

    // 4. Mark the ScrapedListing as imported
    await tx.scrapedListing.update({
      where: { id: listing.id },
      data: {
        status: 'IMPORTED',
        importedPropertyId: property.id,
      },
    });

    return property;
  });

  return {
    propertyId: result.id,
    slug: result.slug,
    scrapedListingId: listing.id,
  };
}

/**
 * Import all eligible ScrapedListings for a given ProspectLead.
 * Skips listings that have already been imported or explicitly rejected/skipped.
 *
 * Returns the list of created Properties and any skipped listing IDs.
 */
export async function importAllListingsForProspect(
  prospectLeadId: string,
  contactId: string,
  locationId: string,
  userId: string,
  companyId?: string | null
): Promise<{ imported: ImportResult[]; skipped: string[] }> {
  const listings = await db.scrapedListing.findMany({
    where: {
      prospectLeadId,
      status: { in: ['NEW', 'REVIEWING'] }, // Only import un-triaged listings
    },
  });

  const imported: ImportResult[] = [];
  const skipped: string[] = [];

  for (const listing of listings) {
    try {
      const result = await importScrapedListingAsProperty(
        listing,
        contactId,
        locationId,
        userId,
        companyId
      );
      if (result) {
        imported.push(result);
      } else {
        skipped.push(listing.id);
      }
    } catch (error) {
      // Log but don't fail the entire batch for one listing
      console.error(`[property-import] Failed to import listing ${listing.id}:`, error);
      skipped.push(listing.id);
    }
  }

  return { imported, skipped };
}
