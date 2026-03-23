export const PROSPECT_SELLER_TYPES = [
  'private',
  'agency',
  'management',
  'developer',
  'other',
] as const;

export type ProspectSellerType = (typeof PROSPECT_SELLER_TYPES)[number];
export type ProspectSellerTypeFilter = ProspectSellerType | 'all';

const SELLER_TYPE_SET = new Set<string>(PROSPECT_SELLER_TYPES);

export function normalizeProspectSellerType(value: string | null | undefined): ProspectSellerType | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || !SELLER_TYPE_SET.has(normalized)) return null;
  return normalized as ProspectSellerType;
}

export function isNonPrivateSellerType(value: ProspectSellerType | null | undefined): boolean {
  const normalized = normalizeProspectSellerType(value || null);
  return normalized !== null && normalized !== 'private';
}

export function sellerTypeToLegacyAgencyFlag(value: ProspectSellerType | null | undefined): boolean {
  return isNonPrivateSellerType(value);
}

export function sellerTypeToCompanyType(value: ProspectSellerType | null | undefined): string | null {
  switch (normalizeProspectSellerType(value || null)) {
    case 'agency':
      return 'Agency';
    case 'management':
      return 'Management';
    case 'developer':
      return 'Developer';
    case 'other':
      return 'Other';
    default:
      return null;
  }
}

export function resolveEffectiveSellerType(input: {
  sellerType?: string | null;
  sellerTypeManual?: string | null;
  isAgency?: boolean | null;
  isAgencyManual?: boolean | null;
}): ProspectSellerType {
  const manualTyped = normalizeProspectSellerType(input.sellerTypeManual || null);
  if (manualTyped) return manualTyped;

  if (input.isAgencyManual === true) return 'agency';
  if (input.isAgencyManual === false) return 'private';

  const storedTyped = normalizeProspectSellerType(input.sellerType || null);
  if (storedTyped) return storedTyped;

  if (input.isAgency === true) return 'agency';
  return 'private';
}

export function buildSellerTypeWhereClause(value: ProspectSellerType): Record<string, unknown> {
  return {
    OR: [
      { sellerTypeManual: value },
      {
        AND: [
          { sellerTypeManual: null },
          { sellerType: value },
        ],
      },
      ...(value === 'agency'
        ? [
            {
              AND: [
                { sellerTypeManual: null },
                { isAgency: true },
              ],
            },
            {
              AND: [
                { sellerTypeManual: null },
                { isAgencyManual: true },
              ],
            },
          ]
        : []),
      ...(value === 'private'
        ? [
            {
              AND: [
                { sellerTypeManual: null },
                { isAgency: false },
              ],
            },
            {
              AND: [
                { sellerTypeManual: null },
                { isAgencyManual: false },
              ],
            },
          ]
        : []),
    ],
  };
}
