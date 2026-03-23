import db from '@/lib/db';
import type { Prisma } from '@prisma/client';
import {
  isNonPrivateSellerType,
  resolveEffectiveSellerType,
  sellerTypeToCompanyType,
} from '@/lib/leads/seller-type';

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

export type CompanyMatchType = 'website' | 'name' | 'phone' | 'email' | 'similar_name';

export interface CompanyMatchCandidate {
  companyId: string;
  name: string;
  matchType: CompanyMatchType;
  confidence: number; // 0..1
  evidence: string[];
  website?: string | null;
  phone?: string | null;
  email?: string | null;
}

export type ProspectCompanyLinkSelection =
  | { mode: 'existing'; companyId: string }
  | {
      mode: 'create';
      profileOverrides?: {
        name?: string | null;
        website?: string | null;
        phone?: string | null;
        email?: string | null;
      };
    };

export type ApplyProspectCompanyLinkResult =
  | { success: true; companyId: string; companyName: string; created: boolean }
  | {
      success: false;
      code: 'invalid_selection' | 'company_not_found' | 'profile_missing' | 'not_agency';
      message: string;
    };

export const COMPANY_LINK_HIGH_CONFIDENCE_THRESHOLD = 0.9;
export const COMPANY_LINK_PLAUSIBLE_CONFIDENCE_THRESHOLD = 0.6;
export const COMPANY_LINK_MAX_CANDIDATES = 8;

interface CompanyRecordForMatch {
  id: string;
  name: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
}

const MATCH_PRECEDENCE: Record<CompanyMatchType, number> = {
  website: 5,
  email: 4,
  phone: 3,
  name: 2,
  similar_name: 1,
};

const AGENCY_NAME_KEYWORDS = /real estate|properties|ltd|agency|developers|management/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const clampConfidence = (score: number): number => {
  if (score <= 0) return 0;
  if (score >= 1) return 1;
  return Number(score.toFixed(3));
};

export const normalizeWebsiteHost = (input?: string | null): string | null => {
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

export const normalizePhoneForMatch = (phone?: string | null): string | null => {
  if (!phone) return null;
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized.length >= 6 ? normalized : null;
};

const normalizeEmailForMatch = (email?: string | null): string | null => {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized || null;
};

export const normalizeCompanyNameForMatch = (name?: string | null): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(co|company|limited|ltd|agency|realty|properties|property|developers|developer|management|group|holdings)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const tokenizeCompanyName = (name?: string | null): string[] => {
  const normalized = normalizeCompanyNameForMatch(name);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
};

const computeJaccard = (left: Set<string>, right: Set<string>): number => {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  const unionSize = new Set([...left, ...right]).size;
  return unionSize > 0 ? overlap / unionSize : 0;
};

const buildBigrams = (value: string): Set<string> => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length < 2) return new Set();
  const grams = new Set<string>();
  for (let idx = 0; idx < compact.length - 1; idx += 1) {
    grams.add(compact.slice(idx, idx + 2));
  }
  return grams;
};

const computeDice = (left: Set<string>, right: Set<string>): number => {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const gram of left) {
    if (right.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (left.size + right.size);
};

export const computeNameSimilarityScore = (leftName?: string | null, rightName?: string | null): number => {
  const leftNormalized = normalizeCompanyNameForMatch(leftName);
  const rightNormalized = normalizeCompanyNameForMatch(rightName);

  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;

  const leftTokens = tokenizeCompanyName(leftNormalized);
  const rightTokens = tokenizeCompanyName(rightNormalized);
  const tokenScore = computeJaccard(new Set(leftTokens), new Set(rightTokens));

  const leftCompact = leftNormalized.replace(/\s+/g, '');
  const rightCompact = rightNormalized.replace(/\s+/g, '');
  const containsScore = leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact) ? 0.78 : 0;

  const diceScore = computeDice(buildBigrams(leftNormalized), buildBigrams(rightNormalized));

  const weighted = (tokenScore * 0.55) + (diceScore * 0.35) + (containsScore * 0.1);
  return clampConfidence(Math.max(tokenScore, containsScore, weighted));
};

const computePhoneOverlapScore = (leftPhone: string, rightPhone: string): number => {
  if (!leftPhone || !rightPhone) return 0;
  const leftDigits = leftPhone.replace(/\D/g, '');
  const rightDigits = rightPhone.replace(/\D/g, '');
  if (leftDigits.length < 6 || rightDigits.length < 6) return 0;

  if (leftDigits === rightDigits) return 1;
  if (leftDigits.includes(rightDigits) || rightDigits.includes(leftDigits)) {
    const ratio = Math.min(leftDigits.length, rightDigits.length) / Math.max(leftDigits.length, rightDigits.length);
    return clampConfidence(0.75 + (ratio * 0.2));
  }
  return 0;
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

const readBusinessAttribute = (rawAttributes: unknown, keyPattern: RegExp): string | null => {
  if (!isRecord(rawAttributes)) return null;
  for (const [key, value] of Object.entries(rawAttributes)) {
    if (!keyPattern.test(key)) continue;
    const parsed = readString(value);
    if (parsed) return parsed;
  }
  return null;
};

const resolveProfileFromProspectState = async (prospectId: string, prospect: {
  name: string | null;
  phone: string | null;
  email: string | null;
  aiScoreBreakdown: unknown;
}): Promise<ScrapedAgencyProfile | null> => {
  const staged = isRecord(prospect.aiScoreBreakdown) && isRecord(prospect.aiScoreBreakdown.strategicScrape)
    ? prospect.aiScoreBreakdown.strategicScrape
    : {};
  const stagedProfile = isRecord(staged.agencyProfile) ? staged.agencyProfile : {};

  const fallbackProfile = await deriveAgencyProfileForProspect(prospectId);

  const profile: ScrapedAgencyProfile = {
    name: readString(stagedProfile.name) || fallbackProfile?.name || prospect.name || '',
    verified: readString(stagedProfile.verified)
      ? /^(yes|true|verified)$/i.test(readString(stagedProfile.verified) || '')
      : (fallbackProfile?.verified ?? null),
    postingSince: readString(stagedProfile.postingSince) || fallbackProfile?.postingSince || null,
    address: readString(stagedProfile.address) || fallbackProfile?.address || null,
    website: readString(stagedProfile.website) || fallbackProfile?.website || null,
    description: readString(stagedProfile.description) || fallbackProfile?.description || null,
    phone: readString(stagedProfile.phone) || fallbackProfile?.phone || prospect.phone || null,
    email: readString(stagedProfile.email) || fallbackProfile?.email || prospect.email || null,
  };

  if (!profile.name) return null;
  return profile;
};

const applyProfileOverrides = (
  profile: ScrapedAgencyProfile,
  overrides?: { name?: string | null; website?: string | null; phone?: string | null; email?: string | null },
): ScrapedAgencyProfile => {
  if (!overrides) return profile;
  return {
    ...profile,
    name: readString(overrides.name) || profile.name,
    website: readString(overrides.website) || profile.website || null,
    phone: readString(overrides.phone) || profile.phone || null,
    email: readString(overrides.email) || profile.email || null,
  };
};

export function buildCompanyLinkCandidates(
  profile: ScrapedAgencyProfile,
  companies: CompanyRecordForMatch[],
  options?: {
    plausibleThreshold?: number;
    maxCandidates?: number;
  },
): CompanyMatchCandidate[] {
  const plausibleThreshold = options?.plausibleThreshold ?? COMPANY_LINK_PLAUSIBLE_CONFIDENCE_THRESHOLD;
  const maxCandidates = options?.maxCandidates ?? COMPANY_LINK_MAX_CANDIDATES;

  const profileWebsite = normalizeWebsiteHost(profile.website);
  const profilePhone = normalizePhoneForMatch(profile.phone);
  const profileEmail = normalizeEmailForMatch(profile.email);
  const profileNameExact = (profile.name || '').trim().toLowerCase();

  const candidates: CompanyMatchCandidate[] = [];

  for (const company of companies) {
    const evidence: string[] = [];
    let strongestType: CompanyMatchType | null = null;
    let confidence = 0;

    const companyWebsite = normalizeWebsiteHost(company.website);
    const companyPhone = normalizePhoneForMatch(company.phone);
    const companyEmail = normalizeEmailForMatch(company.email);
    const companyNameExact = (company.name || '').trim().toLowerCase();

    if (profileWebsite && companyWebsite && profileWebsite === companyWebsite) {
      strongestType = 'website';
      confidence = 0.97;
      evidence.push(`Website host match (${companyWebsite})`);
    }

    if (profileEmail && companyEmail && profileEmail === companyEmail) {
      if (0.9 > confidence || strongestType === null) {
        strongestType = 'email';
        confidence = 0.9;
      }
      evidence.push(`Email match (${companyEmail})`);
    }

    if (profileNameExact && companyNameExact && profileNameExact === companyNameExact) {
      if (0.87 > confidence || strongestType === null) {
        strongestType = 'name';
        confidence = 0.87;
      }
      evidence.push('Exact normalized name match');
    }

    if (profilePhone && companyPhone) {
      const phoneOverlap = computePhoneOverlapScore(profilePhone, companyPhone);
      if (phoneOverlap > 0) {
        const phoneConfidence = clampConfidence(0.72 + (phoneOverlap * 0.16));
        if (phoneConfidence > confidence || strongestType === null) {
          strongestType = 'phone';
          confidence = phoneConfidence;
        }
        evidence.push(`Phone overlap (${companyPhone})`);
      }
    }

    if (!strongestType) {
      const similarity = computeNameSimilarityScore(profile.name, company.name);
      if (similarity >= 0.55) {
        strongestType = 'similar_name';
        confidence = clampConfidence(Math.min(0.89, 0.35 + (similarity * 0.55)));
        evidence.push(`Similar name (${Math.round(similarity * 100)}% similarity)`);
      }
    }

    if (!strongestType || confidence < plausibleThreshold) continue;

    candidates.push({
      companyId: company.id,
      name: company.name,
      matchType: strongestType,
      confidence,
      evidence: uniqueStrings(evidence),
      website: company.website || null,
      phone: company.phone || null,
      email: company.email || null,
    });
  }

  candidates.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    if (MATCH_PRECEDENCE[right.matchType] !== MATCH_PRECEDENCE[left.matchType]) {
      return MATCH_PRECEDENCE[right.matchType] - MATCH_PRECEDENCE[left.matchType];
    }
    return left.name.localeCompare(right.name);
  });

  return candidates.slice(0, maxCandidates);
}

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
    .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business name$/i))
    .find((value): value is string => Boolean(value));
  const businessVerifiedRaw = prospect.scrapedListings
    .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business verified$/i))
    .find((value): value is string => Boolean(value));
  const businessPostingSince = prospect.scrapedListings
    .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business posting since$/i))
    .find((value): value is string => Boolean(value));
  const businessAddress = prospect.scrapedListings
    .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business address$/i))
    .find((value): value is string => Boolean(value));
  const businessWebsite = prospect.scrapedListings
    .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business website$/i))
    .find((value): value is string => Boolean(value));
  const businessDescription = prospect.scrapedListings
    .map((listing) => readBusinessAttribute(listing.rawAttributes, /^seller business description$/i))
    .find((value): value is string => Boolean(value));

  const name = businessName || prospect.name || null;
  if (!name) return null;

  const hasBusinessEvidence = Boolean(
    businessWebsite ||
    businessAddress ||
    businessDescription ||
    businessVerifiedRaw ||
    businessPostingSince,
  );

  if (!hasBusinessEvidence && !AGENCY_NAME_KEYWORDS.test(name)) {
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

export async function getCompanyLinkCandidatesForAgencyProfile(
  locationId: string,
  profile: ScrapedAgencyProfile,
): Promise<CompanyMatchCandidate[]> {
  const companies = await db.company.findMany({
    where: { locationId },
    select: { id: true, name: true, website: true, phone: true, email: true },
  });

  return buildCompanyLinkCandidates(profile, companies);
}

export async function findCompanyMatchForAgencyProfile(
  locationId: string,
  profile: ScrapedAgencyProfile,
): Promise<CompanyMatchCandidate | null> {
  const candidates = await getCompanyLinkCandidatesForAgencyProfile(locationId, profile);
  const deterministic = candidates.find((candidate) => candidate.matchType !== 'similar_name');
  return deterministic || null;
}

export async function getCompanyLinkOptionsForProspect(
  prospectId: string,
  locationId: string,
): Promise<{
  agencyProfile: ScrapedAgencyProfile | null;
  candidates: CompanyMatchCandidate[];
  suggestedMode: 'existing' | 'create';
  suggestedCompanyId: string | null;
}> {
  const prospect = await db.prospectLead.findUnique({
    where: { id: prospectId },
    select: {
      name: true,
      phone: true,
      email: true,
      aiScoreBreakdown: true,
    },
  });

  if (!prospect) {
    return {
      agencyProfile: null,
      candidates: [],
      suggestedMode: 'create',
      suggestedCompanyId: null,
    };
  }

  const profile = await resolveProfileFromProspectState(prospectId, prospect);
  if (!profile) {
    return {
      agencyProfile: null,
      candidates: [],
      suggestedMode: 'create',
      suggestedCompanyId: null,
    };
  }

  const candidates = await getCompanyLinkCandidatesForAgencyProfile(locationId, profile);
  const topCandidate = candidates[0] || null;

  if (topCandidate) {
    return {
      agencyProfile: profile,
      candidates,
      suggestedMode: 'existing',
      suggestedCompanyId: topCandidate.companyId,
    };
  }

  return {
    agencyProfile: profile,
    candidates,
    suggestedMode: 'create',
    suggestedCompanyId: null,
  };
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

const findDeterministicConflict = (
  profile: ScrapedAgencyProfile,
  companies: CompanyRecordForMatch[],
): CompanyMatchCandidate | null => {
  const candidates = buildCompanyLinkCandidates(profile, companies, {
    plausibleThreshold: 0,
    maxCandidates: Math.max(companies.length, COMPANY_LINK_MAX_CANDIDATES),
  });
  return candidates.find((candidate) => candidate.matchType !== 'similar_name') || null;
};

const ensureContactCompanyRole = async (
  tx: Prisma.TransactionClient,
  contactId: string,
  companyId: string,
): Promise<void> => {
  await tx.contactCompanyRole.upsert({
    where: {
      contactId_companyId_role: {
        contactId,
        companyId,
        role: 'associate',
      },
    },
    update: {},
    create: {
      contactId,
      companyId,
      role: 'associate',
    },
  });
};

export async function applyProspectCompanyLinkSelection(
  prospectId: string,
  locationId: string,
  selection: ProspectCompanyLinkSelection,
  contactId?: string | null,
): Promise<ApplyProspectCompanyLinkResult> {
  const prospect = await db.prospectLead.findUnique({
    where: { id: prospectId },
    select: {
      name: true,
      phone: true,
      email: true,
      isAgency: true,
      isAgencyManual: true,
      sellerType: true,
      sellerTypeManual: true,
      aiScoreBreakdown: true,
    },
  });

  if (!prospect) {
    return { success: false, code: 'profile_missing', message: 'Prospect not found.' };
  }

  const effectiveSellerType = resolveEffectiveSellerType({
    sellerType: prospect.sellerType || null,
    sellerTypeManual: prospect.sellerTypeManual || null,
    isAgency: prospect.isAgency,
    isAgencyManual: prospect.isAgencyManual,
  });

  if (!isNonPrivateSellerType(effectiveSellerType)) {
    return { success: false, code: 'not_agency', message: 'This prospect is marked as private.' };
  }

  const baseProfile = await resolveProfileFromProspectState(prospectId, prospect);
  if (!baseProfile?.name) {
    return { success: false, code: 'profile_missing', message: 'Could not derive a valid agency profile to link.' };
  }

  const profile = selection.mode === 'create'
    ? applyProfileOverrides(baseProfile, selection.profileOverrides)
    : baseProfile;

  if (!profile.name) {
    return { success: false, code: 'profile_missing', message: 'Company name is required to create a new company.' };
  }

  return db.$transaction(async (tx) => {
    let company: { id: string; name: string; email: string | null; phone: string | null; website: string | null } | null = null;
    let created = false;

    if (selection.mode === 'existing') {
      company = await tx.company.findFirst({
        where: { id: selection.companyId, locationId },
        select: { id: true, name: true, email: true, phone: true, website: true },
      });
      if (!company) {
        return {
          success: false,
          code: 'company_not_found',
          message: 'Selected company was not found for this location.',
        } satisfies ApplyProspectCompanyLinkResult;
      }
    } else if (selection.mode === 'create') {
      const companies = await tx.company.findMany({
        where: { locationId },
        select: { id: true, name: true, website: true, phone: true, email: true },
      });

      const conflict = findDeterministicConflict(profile, companies);
      if (conflict) {
        company = await tx.company.findUnique({
          where: { id: conflict.companyId },
          select: { id: true, name: true, email: true, phone: true, website: true },
        });
      }

      if (!company) {
        company = await tx.company.create({
          data: {
            locationId,
            name: profile.name,
            email: profile.email || null,
            phone: profile.phone || null,
            website: profile.website || null,
            type: sellerTypeToCompanyType(effectiveSellerType) || 'Agency',
          },
          select: { id: true, name: true, email: true, phone: true, website: true },
        });
        created = true;
      }
    } else {
      return {
        success: false,
        code: 'invalid_selection',
        message: 'Invalid company link selection mode.',
      } satisfies ApplyProspectCompanyLinkResult;
    }

    if (!company) {
      return {
        success: false,
        code: 'company_not_found',
        message: 'Unable to resolve company link target.',
      } satisfies ApplyProspectCompanyLinkResult;
    }

    const updateData: Record<string, unknown> = {};
    if (!company.website && profile.website) updateData.website = profile.website;
    if (!company.phone && profile.phone) updateData.phone = profile.phone;
    if (!company.email && profile.email) updateData.email = profile.email;
    if (Object.keys(updateData).length > 0) {
      company = await tx.company.update({
        where: { id: company.id },
        data: updateData,
        select: { id: true, name: true, email: true, phone: true, website: true },
      });
    }

    if (contactId) {
      await ensureContactCompanyRole(tx, contactId, company.id);
    }

    const latestProspect = await tx.prospectLead.findUnique({
      where: { id: prospectId },
      select: { aiScoreBreakdown: true },
    });

    const nextBreakdown = mergeStrategicScrapePayload(latestProspect?.aiScoreBreakdown, {
      agencyProfile: profile,
      companyLink: {
        companyId: company.id,
        name: company.name,
        linkedAt: new Date().toISOString(),
        created,
        linkedToContactId: contactId || null,
      },
      companyMatch: {
        companyId: company.id,
        name: company.name,
      },
    });

    await tx.prospectLead.update({
      where: { id: prospectId },
      data: { aiScoreBreakdown: nextBreakdown as any },
    });

    return {
      success: true,
      companyId: company.id,
      companyName: company.name,
      created,
    } satisfies ApplyProspectCompanyLinkResult;
  });
}

export async function ensureAgencyCompanyForProspect(
  prospectId: string,
  locationId: string,
  contactId?: string | null,
): Promise<{ companyId: string | null; companyName: string | null; created: boolean }> {
  const options = await getCompanyLinkOptionsForProspect(prospectId, locationId);

  const autoSelection: ProspectCompanyLinkSelection = options.candidates.length > 0
    ? { mode: 'existing', companyId: options.candidates[0]!.companyId }
    : { mode: 'create' };

  const applied = await applyProspectCompanyLinkSelection(prospectId, locationId, autoSelection, contactId);

  if (!applied.success) {
    return { companyId: null, companyName: null, created: false };
  }

  return {
    companyId: applied.companyId,
    companyName: applied.companyName,
    created: applied.created,
  };
}

// Backward-compatible alias for older call-sites.
export async function ensureAgencyCompanyForAcceptedProspect(
  prospectId: string,
  locationId: string,
  contactId: string,
): Promise<{ companyId: string | null; companyName: string | null; created: boolean }> {
  return ensureAgencyCompanyForProspect(prospectId, locationId, contactId);
}
