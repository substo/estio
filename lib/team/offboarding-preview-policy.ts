export type PreviewMembership = {
  locationId: string;
  locationName: string | null;
  role: "ADMIN" | "MEMBER" | null;
  connected: boolean;
};

export type PreviewIdentity = {
  id: string;
  email: string;
  clerkId: string | null;
  firstName: string | null;
  lastName: string | null;
  memberships: PreviewMembership[];
};

export type ClerkIdentity = { id: string; emails: string[] };

export function normalizeOffboardingEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveStrictAdminLocation(actor: PreviewIdentity | null): PreviewMembership {
  if (!actor) throw new Error("Unauthorized");

  const connectedRoles = actor.memberships.filter((membership) => membership.connected && membership.role);
  const adminRoles = connectedRoles.filter((membership) => membership.role === "ADMIN");
  if (adminRoles.length === 0) throw new Error("A current ADMIN role is required");
  if (adminRoles.length !== 1) {
    throw new Error("Active location is ambiguous; an authoritative server-side selection is required");
  }
  return adminRoles[0];
}

export function requireExactPreviewIdentity(args: {
  label: "Source" | "Successor";
  email: string;
  localMatches: PreviewIdentity[];
  clerkMatches: ClerkIdentity[];
  activeLocationId: string;
}): PreviewIdentity & { clerkId: string } {
  const normalized = normalizeOffboardingEmail(args.email);
  const localMatches = args.localMatches.filter(
    (identity) => normalizeOffboardingEmail(identity.email) === normalized,
  );
  const clerkMatches = args.clerkMatches.filter((identity) =>
    identity.emails.some((email) => normalizeOffboardingEmail(email) === normalized),
  );

  if (localMatches.length !== 1) {
    throw new Error(`${args.label} must match exactly one local User by normalized email`);
  }
  if (clerkMatches.length !== 1) {
    throw new Error(`${args.label} must match exactly one Clerk identity by normalized email`);
  }

  const local = localMatches[0];
  const clerk = clerkMatches[0];
  if (!local.clerkId || local.clerkId !== clerk.id) {
    throw new Error(`${args.label} local User and Clerk identity do not agree`);
  }

  const membership = local.memberships.find(
    (candidate) => candidate.locationId === args.activeLocationId,
  );
  if (!membership?.connected || !membership.role) {
    throw new Error(`${args.label} is not an active member of this location`);
  }

  return { ...local, clerkId: local.clerkId };
}

export function assertOffboardingPair(source: PreviewIdentity, successor: PreviewIdentity): void {
  if (source.id === successor.id || normalizeOffboardingEmail(source.email) === normalizeOffboardingEmail(successor.email)) {
    throw new Error("Source and successor must be different users");
  }
}
