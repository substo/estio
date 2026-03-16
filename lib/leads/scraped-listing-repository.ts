import db from '@/lib/db';
import { Prisma } from '@prisma/client';

export type ScrapedListingScope = 'new' | 'all';

export interface ScrapedListingParams {
  limit?: number;
  skip?: number;
  q?: string;
  source?: string;
  status?: string;
  scope?: ScrapedListingScope;
  prospectLeadId?: string;
}

export interface ScrapedListingRow {
  id: string;
  platform: string;
  externalId: string;
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  propertyType: string | null;
  listingType: string | null;
  locationText: string | null;
  images: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  propertyArea: number | null;
  plotArea: number | null;
  constructionYear: number | null;
  whatsappPhone: string | null;
  status: string;
  prospectLeadId: string | null;
  prospectName: string | null;
  prospectPhone: string | null;
  prospectAgency: boolean;
  createdAt: string;
}

export interface ScrapedListingResult {
  items: ScrapedListingRow[];
  total: number;
}

export async function listScrapedListings(
  locationId: string,
  params: ScrapedListingParams = {}
): Promise<ScrapedListingResult> {
  const and: Prisma.ScrapedListingWhereInput[] = [{ locationId }];

  const scope = params.scope || 'new';
  if (scope === 'new') {
    and.push({ status: { in: ['new', 'NEW', 'REVIEWING'] } }); 
  } else if (params.status) {
    and.push({ status: params.status });
  }

  if (params.source) and.push({ platform: params.source });
  if (params.prospectLeadId) and.push({ prospectLeadId: params.prospectLeadId });

  if (params.q) {
    and.push({
      OR: [
        { title: { contains: params.q, mode: 'insensitive' } },
        { locationText: { contains: params.q, mode: 'insensitive' } },
        { externalId: { equals: params.q } },
      ],
    });
  }

  const where: Prisma.ScrapedListingWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    db.scrapedListing.findMany({
      where,
      take: params.limit || 25,
      skip: params.skip || 0,
      include: {
        prospectLead: {
          select: { name: true, phone: true, isAgency: true }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
    db.scrapedListing.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      externalId: r.externalId,
      url: r.url,
      title: r.title,
      price: r.price,
      currency: r.currency,
      propertyType: r.propertyType,
      listingType: r.listingType,
      locationText: r.locationText,
      images: r.images,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      propertyArea: r.propertyArea,
      plotArea: r.plotArea,
      constructionYear: r.constructionYear,
      whatsappPhone: r.whatsappPhone,
      status: r.status,
      prospectLeadId: r.prospectLeadId,
      prospectName: r.prospectLead?.name || null,
      prospectPhone: r.prospectLead?.phone || null,
      prospectAgency: r.prospectLead?.isAgency || false,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}
