import db from '@/lib/db';
import { Prisma } from '@prisma/client';

export type ProspectInboxScope = 'new' | 'all';

export interface ProspectInboxParams {
  limit?: number;
  skip?: number;
  q?: string;
  source?: string;
  status?: string;
  scope?: ProspectInboxScope;
  dedupStatus?: string;
}

export interface ProspectInboxRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  sourceUrl: string | null;
  aiScore: number | null;
  matchedContactId: string | null;
  matchConfidence: number | null;
  dedupStatus: string;
  status: string;
  createdContactId: string | null;
  createdAt: string;
  isAgency: boolean;
  scrapedListingsCount: number;
  scrapedListings: { id: string; url: string; title: string | null; platform: string; price: number | null }[];
}

export interface ProspectInboxResult {
  items: ProspectInboxRow[];
  total: number;
}

export async function listProspectInbox(
  locationId: string,
  params: ProspectInboxParams = {}
): Promise<ProspectInboxResult> {
  const and: Prisma.ProspectLeadWhereInput[] = [{ locationId }];

  const scope = params.scope || 'new';
  if (scope === 'new') {
    and.push({ status: { in: ['new', 'reviewing'] } }); // include reviewing in 'new' scope
  } else if (params.status) {
    and.push({ status: params.status });
  }

  if (params.source) and.push({ source: params.source });
  if (params.dedupStatus) and.push({ dedupStatus: params.dedupStatus });

  if (params.q) {
    and.push({
      OR: [
        { name: { contains: params.q, mode: 'insensitive' } },
        { email: { contains: params.q, mode: 'insensitive' } },
        { phone: { contains: params.q, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.ProspectLeadWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    db.prospectLead.findMany({
      where,
      take: params.limit || 25,
      skip: params.skip || 0,
      include: {
        scrapedListings: {
          select: { id: true, url: true, title: true, platform: true, price: true },
          take: 5 // Just preview the first 5 in the inbox list
        }
      },
      orderBy: [{ aiScore: 'desc' }, { createdAt: 'desc' }],
    }),
    db.prospectLead.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      source: r.source,
      sourceUrl: r.sourceUrl,
      aiScore: r.aiScore,
      matchedContactId: r.matchedContactId,
      matchConfidence: r.matchConfidence,
      dedupStatus: r.dedupStatus,
      status: r.status,
      createdContactId: r.createdContactId,
      createdAt: r.createdAt.toISOString(),
      isAgency: r.isAgency,
      scrapedListingsCount: (r as any).scrapedListings?.length || 0,
      scrapedListings: (r as any).scrapedListings || [],
    })),
    total,
  };
}
