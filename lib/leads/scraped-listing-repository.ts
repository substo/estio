import db from '@/lib/db';
import { Prisma } from '@prisma/client';

export type ScrapedListingScope = 'new' | 'all' | 'accepted' | 'rejected';

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
  locationId: string;
  platform: string;
  externalId: string;
  url: string;
  title: string | null;
  price: number | null;
  sellerRegisteredAt: string | null;
  otherListingsUrl: string | null;
  otherListingsCount: number | null;
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
  whatsappPhone: string | null;
  description: string | null;
  contactChannels: string[];
  sellerExternalId: string | null;
  status: string;
  prospectLeadId: string | null;
  prospectName: string | null;
  prospectPhone: string | null;
  prospectAgency: boolean;
  prospectAgencyManual: boolean | null;
  prospectAiScoreBreakdown: Record<string, any> | null;
  linkedCompanyId: string | null;
  linkedCompanyName: string | null;
  stagedCompanyMatchName: string | null;
  isExpired: boolean;
  createdAt: string;
  rawAttributes: Record<string, any> | null;
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
  } else if (scope === 'accepted') {
    and.push({ status: { in: ['imported', 'IMPORTED'] } });
  } else if (scope === 'rejected') {
    and.push({ status: { in: ['rejected', 'REJECTED'] } });
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
          select: { name: true, phone: true, isAgency: true, isAgencyManual: true, aiScoreBreakdown: true }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
    db.scrapedListing.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      // Strategic scrape payload is optional and JSON-backed.
      // We keep extraction defensive so older rows still render safely.
      ...(() => {
        const breakdown = (r.prospectLead?.aiScoreBreakdown ?? null) as Record<string, any> | null;
        const strategicScrape = (breakdown?.strategicScrape ?? null) as Record<string, any> | null;
        const linkedCompany = (strategicScrape?.companyLink ?? null) as Record<string, any> | null;
        const stagedCompanyMatch = (strategicScrape?.companyMatch ?? null) as Record<string, any> | null;
        return {
          prospectAiScoreBreakdown: breakdown,
          linkedCompanyId: typeof linkedCompany?.companyId === 'string' ? linkedCompany.companyId : null,
          linkedCompanyName: typeof linkedCompany?.name === 'string' ? linkedCompany.name : null,
          stagedCompanyMatchName: typeof stagedCompanyMatch?.name === 'string' ? stagedCompanyMatch.name : null,
        };
      })(),
      id: r.id,
      locationId: r.locationId,
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
      thumbnails: r.thumbnails,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      propertyArea: r.propertyArea,
      plotArea: r.plotArea,
      constructionYear: r.constructionYear,
      whatsappPhone: r.whatsappPhone,
      description: r.description,
      contactChannels: r.contactChannels,
      sellerExternalId: r.sellerExternalId,
      status: r.status,
      prospectLeadId: r.prospectLeadId,
      prospectName: r.prospectLead?.name || null,
      prospectPhone: r.prospectLead?.phone || null,
      prospectAgency: r.prospectLead?.isAgency ?? false,
      prospectAgencyManual: r.prospectLead?.isAgencyManual ?? null,
      sellerRegisteredAt: r.sellerRegisteredAt,
      otherListingsUrl: r.otherListingsUrl,
      otherListingsCount: r.otherListingsCount,
      isExpired: r.isExpired,
      createdAt: r.createdAt.toISOString(),
      rawAttributes: r.rawAttributes as Record<string, any> | null,
    })),
    total,
  };
}
