/**
 * Pure rules for brands (Prisma `Location`) and their teams. A brand belongs
 * to one app (auth realm); its team is the source of truth for both the CRM
 * and Studio. See documentation/substo-crm-design.md.
 */

export type BrandRole = "ADMIN" | "MEMBER";
export type StudioMemberRole = "owner" | "admin" | "member";

export const BRAND_NAME_MAX_LENGTH = 100;

/** Name for the brand created automatically at a user's first sign-in. */
export function defaultBrandName(person: { firstName?: string | null; email?: string | null }): string {
  const first = person.firstName?.trim();
  const local = person.email?.split("@")[0]?.trim();
  const owner = first || local;
  const name = owner ? `${owner}'s brand` : "My brand";
  return name.slice(0, BRAND_NAME_MAX_LENGTH);
}

/** Returns a trimmed brand name, or null when it is empty or too long. */
export function normalizeBrandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= BRAND_NAME_MAX_LENGTH ? name : null;
}

/** Invitation emails are compared trimmed and case-insensitively. */
export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function parseBrandRole(value: unknown): BrandRole | null {
  return value === "ADMIN" || value === "MEMBER" ? value : null;
}

type ClerkEmail = { emailAddress: string; verification?: { status?: string | null } | null };

/** Only verified addresses may claim an invitation. */
export function verifiedEmails(user: { emailAddresses: ClerkEmail[] }): string[] {
  return [...new Set(user.emailAddresses
    .filter((entry) => entry.verification?.status === "verified")
    .map((entry) => entry.emailAddress.trim().toLowerCase())
    .filter(Boolean))];
}

/** The primary verified address, used as the user's Business email. */
export function primaryVerifiedEmail(user: { primaryEmailAddressId: string | null; emailAddresses: Array<ClerkEmail & { id: string }> }): string | null {
  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);
  if (primary?.verification?.status === "verified") return primary.emailAddress.trim().toLowerCase();
  return verifiedEmails(user)[0] ?? null;
}

/**
 * Studio role mirrored from the brand role. An existing Studio owner stays
 * owner while they remain a brand admin; Studio has no separate team.
 */
export function studioRoleForBrandRole(role: BrandRole, current: StudioMemberRole | null): StudioMemberRole {
  if (role === "ADMIN") return current === "owner" ? "owner" : "admin";
  return "member";
}

/** Brand role for a member of a pre-brand Substo Studio workspace being adopted. */
export function brandRoleForLegacyStudioRole(role: StudioMemberRole): BrandRole {
  return role === "member" ? "MEMBER" : "ADMIN";
}

export type TeamChangeCheck = { ok: true } | { ok: false; error: string };

/** A brand always keeps at least one admin. */
export function checkTeamChange(input: {
  actorRole: BrandRole;
  targetCurrentRole: BrandRole;
  change: { kind: "remove" } | { kind: "role"; role: BrandRole };
  adminCount: number;
}): TeamChangeCheck {
  if (input.actorRole !== "ADMIN") return { ok: false, error: "Only brand admins can manage the team." };
  const losesAdmin = input.targetCurrentRole === "ADMIN" && (input.change.kind === "remove" || input.change.role !== "ADMIN");
  if (losesAdmin && input.adminCount <= 1) return { ok: false, error: "A brand needs at least one admin." };
  return { ok: true };
}
