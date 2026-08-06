import { config } from "dotenv";
import path from "node:path";
import { normalizePlatformAdminEmail, resolvePlatformAdminBootstrap } from "../lib/auth/platform-bootstrap-policy";

config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

let disconnectDatabase: (() => Promise<void>) | null = null;

async function main() {
  const [{ clerkClient }, { default: db }] = await Promise.all([
    import("@clerk/nextjs/server"),
    import("../lib/db"),
  ]);
  disconnectDatabase = () => db.$disconnect();
  const emailArg = process.argv.find((value) => value.startsWith("--email="))?.slice("--email=".length) || "";
  const apply = process.argv.includes("--apply");
  const email = normalizePlatformAdminEmail(emailArg);
  if (!email) throw new Error("Usage: npx tsx scripts/grant-platform-admin.ts --email=user@example.com [--apply]");

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
    action: apply ? "apply" : "dry-run",
  }, null, 2));

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
