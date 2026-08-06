export type LocalBootstrapIdentity = { id: string; clerkId: string | null; email: string; platformRole: "STANDARD" | "PLATFORM_ADMIN" };
export type ClerkBootstrapIdentity = { id: string; emails: string[] };

export function normalizePlatformAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolvePlatformAdminBootstrap(args: {
  email: string;
  localMatches: LocalBootstrapIdentity[];
  clerkMatches: ClerkBootstrapIdentity[];
}): { email: string; local: LocalBootstrapIdentity; clerk: ClerkBootstrapIdentity; alreadyGranted: boolean } {
  const email = normalizePlatformAdminEmail(args.email);
  if (!email) throw new Error("A non-empty email is required");
  const localMatches = args.localMatches.filter((entry) => normalizePlatformAdminEmail(entry.email) === email);
  const clerkMatches = args.clerkMatches.filter((entry) => entry.emails.some((candidate) => normalizePlatformAdminEmail(candidate) === email));
  if (localMatches.length !== 1) throw new Error("Email must resolve to exactly one local User");
  if (clerkMatches.length !== 1) throw new Error("Email must resolve to exactly one Clerk identity");
  const local = localMatches[0];
  const clerk = clerkMatches[0];
  if (!local.clerkId || local.clerkId !== clerk.id) throw new Error("Local clerkId does not match the Clerk identity");
  return { email, local, clerk, alreadyGranted: local.platformRole === "PLATFORM_ADMIN" };
}
