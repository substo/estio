export const PROFILE_VERIFICATION_IDENTITY_FIELDS = new Set([
  "contactType",
  "leadGoal",
  "name",
  "firstName",
  "lastName",
  "qualificationStage",
]);

export function profileVerificationFields(args: {
  status: string;
  source: string;
  confidence?: number | null;
  summary?: string | null;
  verifiedAt?: Date;
}) {
  return {
    profileVerifiedAt: args.verifiedAt || new Date(),
    profileVerificationStatus: args.status,
    profileVerificationSource: args.source,
    profileVerificationConfidence: args.confidence ?? null,
    profileVerificationSummary: args.summary || null,
    profileVerificationDueAt: null,
    profileVerificationLastError: null,
  };
}

export function clearProfileVerificationFields() {
  return {
    profileVerifiedAt: null,
    profileVerificationStatus: null,
    profileVerificationSource: null,
    profileVerificationConfidence: null,
    profileVerificationSummary: null,
    profileVerificationDueAt: new Date(),
    profileVerificationLastError: null,
  };
}

export function withProfileVerificationInvalidation<T extends Record<string, any>>(data: T): T {
  const hasIdentityChange = Object.keys(data || {}).some((field) => (
    PROFILE_VERIFICATION_IDENTITY_FIELDS.has(field)
  ));
  if (!hasIdentityChange) return data;
  return {
    ...data,
    ...clearProfileVerificationFields(),
  };
}

function comparable(value: unknown) {
  if (value == null) return null;
  return String(value).trim();
}

export function withChangedProfileVerificationInvalidation<T extends Record<string, any>>(
  data: T,
  current: Record<string, any> | null | undefined,
): T {
  if (!current) return withProfileVerificationInvalidation(data);
  const hasChangedIdentity = Object.keys(data || {}).some((field) => (
    PROFILE_VERIFICATION_IDENTITY_FIELDS.has(field)
    && comparable(data[field]) !== comparable(current[field])
  ));
  if (!hasChangedIdentity) return data;
  return {
    ...data,
    ...clearProfileVerificationFields(),
  };
}
