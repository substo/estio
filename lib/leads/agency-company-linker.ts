import db from '@/lib/db';

export interface ScrapedAgencyProfile {
  name: string;
  verified?: boolean | null;
  postingSince?: string | null;
  address?: string | null;
  website?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CompanyMatchCandidate {
  companyId: string;
  name: string;
  matchType: 'website' | 'name' | 'phone' | 'email';
  confidence: number; // 0..1
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const normalizeWebsite = (input?: string | null): string | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return trimmed.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null;
  }
};

const normalizePhone = (phone?: string | null): string | null => {
  if (!phone) return null;
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized.length >= 6 ? normalized : null;
};

const readBusinessAttribute = (rawAttributes: unknown, keyPattern: RegExp): string | null => {
  if (!isRecord(rawAttributes)) return null;
  for (const [key, value] of Object.entries(rawAttributes)) {
    if (!keyPattern.test(key)) continue;
    const parsed = readString(value);
    if (parsed) return parsed;
  }
  return null;
};

const mergeStrategicScrapePayload = (existingBreakdown: unknown, patch: Record<string, unknown>) => {
  const safeExisting = isRecord(existingBreakdown) ? existingBreakdown : {};
  const currentStrategic = isRecord(safeExisting.strategicScrape) ? safeExisting.strategicScrape : {};
  return {
    ...safeExisting,
    strategicScrape: {
      ...currentStrategic,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
};

export async function deriveAgencyProfileForProspect(prospectId: string): Promise<ScrapedAgencyProfile | null> {
  const prospect = await db.prospectLead.findUnique({
    where: { id: prospectId },
    select: {
      name: true,
      phone: true,
      email: true,
      platformRegistered: true,
      scrapedListings: {
        where: {
          status: { not: 'SKIPPED' },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { rawAttributes: true },
      },
    },
  });

  if (!prospect) return null;

  const businessName = prospect.scrapedListings
    .map((l) => readBusinessAttribute(l.rawAttributes, /^seller business name$/i))
    .find((v): v is string => Boolean(v));
  const businessVerifiedRaw = prospect.scrapedListings
    .map((l) => readBusinessAttribute(l.rawAttributes, /^seller business verified$/i))
    .find((v): v is string => Boolean(v));
  const businessPostingSince = prospect.scrapedListings
    .map((l) => readBusinessAttribute(l.rawAttributes, /^seller business posting since$/i))
    .find((v): v is string => Boolean(v));
  const businessAddress = prospect.scrapedListings
    .map((l) => readBusinessAttribute(l.rawAttributes, /^seller business address$/i))
    .find((v): v is string => Boolean(v));
  const businessWebsite = prospect.scrapedListings
    .map((l) => readBusinessAttribute(l.rawAttributes, /^seller business website$/i))
    .find((v): v is string => Boolean(v));
  const businessDescription = prospect.scrapedListings
    .map((l) => readBusinessAttribute(l.rawAttributes, /^seller business description$/i))
    .find((v): v is string => Boolean(v));

  const name = businessName || prospect.name || null;
  if (!name) return null;

  const hasBusinessEvidence = Boolean(
    businessWebsite ||
    businessAddress ||
    businessDescription ||
    businessVerifiedRaw ||
    businessPostingSince
  );

  if (!hasBusinessEvidence && !/real estate|properties|ltd|agency|developers|management/i.test(name)) {
    return null;
  }

  return {
    name,
    verified: businessVerifiedRaw ? /^(yes|true|verified)$/i.test(businessVerifiedRaw) : null,
    postingSince: businessPostingSince || prospect.platformRegistered || null,
    address: businessAddress || null,
    website: businessWebsite || null,
    description: businessDescription || null,
    phone: prospect.phone || null,
    email: prospect.email || null,
  };
}

export async function findCompanyMatchForAgencyProfile(
  locationId: string,
  profile: ScrapedAgencyProfile,
): Promise<CompanyMatchCandidate | null> {
  const websiteHost = normalizeWebsite(profile.website);
  const normalizedPhone = normalizePhone(profile.phone);
  const normalizedEmail = profile.email?.toLowerCase() || null;

  const companies = await db.company.findMany({
    where: { locationId },
    select: { id: true, name: true, website: true, phone: true, email: true },
    take: 300,
  });

  if (websiteHost) {
    const byWebsite = companies.find((c) => normalizeWebsite(c.website) === websiteHost);
    if (byWebsite) {
      return { companyId: byWebsite.id, name: byWebsite.name, matchType: 'website', confidence: 0.96 };
    }
  }

  const exactName = companies.find((c) => c.name.trim().toLowerCase() === profile.name.trim().toLowerCase());
  if (exactName) {
    return { companyId: exactName.id, name: exactName.name, matchType: 'name', confidence: 0.87 };
  }

  if (normalizedPhone) {
    const byPhone = companies.find((c) => {
      const companyPhone = normalizePhone(c.phone);
      return Boolean(companyPhone && (companyPhone.includes(normalizedPhone) || normalizedPhone.includes(companyPhone)));
    });
    if (byPhone) {
      return { companyId: byPhone.id, name: byPhone.name, matchType: 'phone', confidence: 0.82 };
    }
  }

  if (normalizedEmail) {
    const byEmail = companies.find((c) => c.email?.toLowerCase() === normalizedEmail);
    if (byEmail) {
      return { companyId: byEmail.id, name: byEmail.name, matchType: 'email', confidence: 0.9 };
    }
  }

  return null;
}

export async function stageAgencyProfileCompanyMatch(
  prospectId: string,
  locationId: string,
): Promise<{ profile: ScrapedAgencyProfile | null; match: CompanyMatchCandidate | null }> {
  const profile = await deriveAgencyProfileForProspect(prospectId);
  const match = profile ? await findCompanyMatchForAgencyProfile(locationId, profile) : null;

  const prospect = await db.prospectLead.findUnique({
    where: { id: prospectId },
    select: { aiScoreBreakdown: true },
  });
  if (!prospect) return { profile, match };

  const nextBreakdown = mergeStrategicScrapePayload(prospect.aiScoreBreakdown, {
    agencyProfile: profile,
    companyMatch: match,
  });

  await db.prospectLead.update({
    where: { id: prospectId },
    data: { aiScoreBreakdown: nextBreakdown as any },
  });

  return { profile, match };
}

export async function ensureAgencyCompanyForProspect(
  prospectId: string,
  locationId: string,
  contactId?: string | null,
): Promise<{ companyId: string | null; companyName: string | null; created: boolean }> {
  const prospect = await db.prospectLead.findUnique({
    where: { id: prospectId },
    select: {
      name: true,
      phone: true,
      email: true,
      isAgency: true,
      isAgencyManual: true,
      aiScoreBreakdown: true,
    },
  });

  if (!prospect) return { companyId: null, companyName: null, created: false };

  const effectiveAgency = prospect.isAgencyManual !== null && prospect.isAgencyManual !== undefined
    ? prospect.isAgencyManual
    : prospect.isAgency;

  if (!effectiveAgency) return { companyId: null, companyName: null, created: false };

  const staged = isRecord(prospect.aiScoreBreakdown) && isRecord(prospect.aiScoreBreakdown.strategicScrape)
    ? prospect.aiScoreBreakdown.strategicScrape
    : {};
  const stagedProfile = isRecord(staged.agencyProfile) ? staged.agencyProfile : {};
  const stagedMatch = isRecord(staged.companyMatch) ? staged.companyMatch : {};

  const fallbackProfile = await deriveAgencyProfileForProspect(prospectId);
  const profile: ScrapedAgencyProfile | null = {
    name: readString(stagedProfile.name) || fallbackProfile?.name || prospect.name || '',
    verified: readString(stagedProfile.verified) ? /^(yes|true|verified)$/i.test(readString(stagedProfile.verified) || '') : (fallbackProfile?.verified ?? null),
    postingSince: readString(stagedProfile.postingSince) || fallbackProfile?.postingSince || null,
    address: readString(stagedProfile.address) || fallbackProfile?.address || null,
    website: readString(stagedProfile.website) || fallbackProfile?.website || null,
    description: readString(stagedProfile.description) || fallbackProfile?.description || null,
    phone: readString(stagedProfile.phone) || fallbackProfile?.phone || prospect.phone || null,
    email: readString(stagedProfile.email) || fallbackProfile?.email || prospect.email || null,
  };

  if (!profile?.name) return { companyId: null, companyName: null, created: false };

  let company = null as null | { id: string; name: string; email: string | null; phone: string | null; website: string | null };
  const stagedCompanyId = readString(stagedMatch.companyId);

  if (stagedCompanyId) {
    company = await db.company.findUnique({
      where: { id: stagedCompanyId },
      select: { id: true, name: true, email: true, phone: true, website: true },
    });
  }

  if (!company) {
    const match = await findCompanyMatchForAgencyProfile(locationId, profile);
    if (match?.companyId) {
      company = await db.company.findUnique({
        where: { id: match.companyId },
        select: { id: true, name: true, email: true, phone: true, website: true },
      });
    }
  }

  let created = false;
  if (!company) {
    company = await db.company.create({
      data: {
        locationId,
        name: profile.name,
        email: profile.email || null,
        phone: profile.phone || null,
        website: profile.website || null,
        type: 'Agency',
      },
      select: { id: true, name: true, email: true, phone: true, website: true },
    });
    created = true;
  } else {
    const updateData: Record<string, unknown> = {};
    if (!company.website && profile.website) updateData.website = profile.website;
    if (!company.phone && profile.phone) updateData.phone = profile.phone;
    if (!company.email && profile.email) updateData.email = profile.email;
    if (Object.keys(updateData).length > 0) {
      company = await db.company.update({
        where: { id: company.id },
        data: updateData,
        select: { id: true, name: true, email: true, phone: true, website: true },
      });
    }
  }

  if (contactId) {
    await db.contactCompanyRole.upsert({
      where: {
        contactId_companyId_role: {
          contactId,
          companyId: company.id,
          role: 'associate',
        },
      },
      update: {},
      create: {
        contactId,
        companyId: company.id,
        role: 'associate',
      },
    });
  }

  const nextBreakdown = mergeStrategicScrapePayload(prospect.aiScoreBreakdown, {
    agencyProfile: profile,
    companyLink: {
      companyId: company.id,
      name: company.name,
      linkedAt: new Date().toISOString(),
      created,
      linkedToContactId: contactId || null,
    },
  });

  await db.prospectLead.update({
    where: { id: prospectId },
    data: { aiScoreBreakdown: nextBreakdown as any },
  });

  return { companyId: company.id, companyName: company.name, created };
}

// Backward-compatible alias for older call-sites.
export async function ensureAgencyCompanyForAcceptedProspect(
  prospectId: string,
  locationId: string,
  contactId: string,
): Promise<{ companyId: string | null; companyName: string | null; created: boolean }> {
  return ensureAgencyCompanyForProspect(prospectId, locationId, contactId);
}
