import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { normalizePlatformAdminEmail, resolvePlatformAdminBootstrap } from "../lib/auth/platform-bootstrap-policy";

const envFileArg = process.argv.find((value) => value.startsWith("--env-file="))?.slice("--env-file=".length);
const apply = process.argv.includes("--apply");
const expectedClerkId = process.argv.find((value) => value.startsWith("--expected-clerk-id="))?.slice("--expected-clerk-id=".length);

if (apply && !envFileArg) {
  throw new Error("--apply requires an explicit --env-file to prevent cross-instance Clerk identity changes");
}

const envFiles = envFileArg ? [envFileArg] : [".env.local", ".env"];
for (const candidate of envFiles) {
  const resolvedPath = path.resolve(process.cwd(), candidate);
  if (!existsSync(resolvedPath)) {
    if (envFileArg) throw new Error(`Environment file not found: ${resolvedPath}`);
    continue;
  }
  loadEnvFile(resolvedPath);
}

let disconnectDatabase: (() => Promise<void>) | null = null;

async function main() {
  const [{ clerkClient }, { default: db }] = await Promise.all([
    import("@clerk/nextjs/server"),
    import("../lib/db"),
  ]);
  disconnectDatabase = () => db.$disconnect();
  const emailArg = process.argv.find((value) => value.startsWith("--email="))?.slice("--email=".length) || "";
  const email = normalizePlatformAdminEmail(emailArg);
  if (!email) throw new Error("Usage: npx tsx scripts/grant-platform-admin.ts --email=user@example.com [--env-file=.env] [--expected-clerk-id=user_...] [--apply]");

  const [localMatches, clerkResponse] = await Promise.all([
    db.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, clerkId: true, email: true, platformRole: true },
      take: 2,
    }),
    (await clerkClient()).users.getUserList({ emailAddress: [email], limit: 2 }),
  ]);
  const resolved = resolvePlatformAdminBootstrap({
    email,
    localMatches,
    clerkMatches: clerkResponse.data.map((user) => ({ id: user.id, emails: user.emailAddresses.map((entry) => entry.emailAddress) })),
  });

  console.log(JSON.stringify({
    normalizedEmail: resolved.email,
    internalUserId: resolved.local.id,
    localClerkId: resolved.local.clerkId,
    resolvedClerkId: resolved.clerk.id,
    currentPlatformRole: resolved.local.platformRole,
    environmentFile: envFileArg || "development defaults",
    clerkKeyFingerprint: createHash("sha256").update(process.env.CLERK_SECRET_KEY || "missing").digest("hex").slice(0, 12),
    action: apply ? "apply" : "dry-run",
  }, null, 2));

  if (apply && (!expectedClerkId || expectedClerkId !== resolved.clerk.id)) {
    throw new Error("--apply requires --expected-clerk-id to exactly match the reviewed Clerk identity");
  }

  if (resolved.alreadyGranted) {
    console.log("PLATFORM_ADMIN is already granted; no mutation needed.");
    return;
  }
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after reviewing the IDs above.");
    return;
  }
  await db.user.update({ where: { id: resolved.local.id }, data: { platformRole: "PLATFORM_ADMIN" } });
  console.log("PLATFORM_ADMIN granted.");
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : "Bootstrap failed"); process.exitCode = 1; })
  .finally(async () => { await disconnectDatabase?.(); });
