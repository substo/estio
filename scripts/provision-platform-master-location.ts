import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { normalizePlatformAdminEmail, resolvePlatformAdminBootstrap } from "../lib/auth/platform-bootstrap-policy";

const envFileArg = process.argv.find((value) => value.startsWith("--env-file="))?.slice("--env-file=".length);
const apply = process.argv.includes("--apply");
const expectedClerkId = process.argv.find((value) => value.startsWith("--expected-clerk-id="))?.slice("--expected-clerk-id=".length);

if (apply && !envFileArg) {
  throw new Error("--apply requires an explicit --env-file to prevent cross-instance identity changes");
}

for (const candidate of envFileArg ? [envFileArg] : [".env.local", ".env"]) {
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
  if (!email) {
    throw new Error("Usage: npx tsx scripts/provision-platform-master-location.ts --email=user@example.com [--env-file=.env] [--expected-clerk-id=user_...] [--apply]");
  }

  const [localMatches, clerkResponse, masterLocations] = await Promise.all([
    db.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, clerkId: true, email: true, platformRole: true },
      take: 2,
    }),
    (await clerkClient()).users.getUserList({ emailAddress: [email], limit: 2 }),
    db.location.findMany({ where: { isPlatformMaster: true }, select: { id: true, name: true }, take: 2 }),
  ]);
  const resolved = resolvePlatformAdminBootstrap({
    email,
    localMatches,
    clerkMatches: clerkResponse.data.map((user) => ({ id: user.id, emails: user.emailAddresses.map((entry) => entry.emailAddress) })),
  });
  if (!resolved.alreadyGranted) throw new Error("The reviewed identity must already have PLATFORM_ADMIN access.");
  if (masterLocations.length > 1) throw new Error("More than one platform master location exists.");

  console.log(JSON.stringify({
    normalizedEmail: resolved.email,
    internalUserId: resolved.local.id,
    resolvedClerkId: resolved.clerk.id,
    existingMasterLocation: masterLocations[0] || null,
    environmentFile: envFileArg || "development defaults",
    clerkKeyFingerprint: createHash("sha256").update(process.env.CLERK_SECRET_KEY || "missing").digest("hex").slice(0, 12),
    action: apply ? "apply" : "dry-run",
  }, null, 2));

  if (!apply) {
    console.log("Dry run only. Re-run with --apply after reviewing the IDs above.");
    return;
  }
  if (!expectedClerkId || expectedClerkId !== resolved.clerk.id) {
    throw new Error("--apply requires --expected-clerk-id to exactly match the reviewed Clerk identity");
  }

  const masterLocation = masterLocations[0] || await db.location.create({
    data: { name: "Estio", isPlatformMaster: true, timeZone: "Asia/Nicosia" },
    select: { id: true, name: true },
  });
  await db.$transaction([
    db.user.update({
      where: { id: resolved.local.id },
      data: { locations: { connect: { id: masterLocation.id } } },
    }),
    db.userLocationRole.upsert({
      where: { userId_locationId: { userId: resolved.local.id, locationId: masterLocation.id } },
      create: {
        userId: resolved.local.id,
        locationId: masterLocation.id,
        role: "ADMIN",
        contactAccessScope: "LOCATION_WIDE",
      },
      update: { role: "ADMIN", contactAccessScope: "LOCATION_WIDE" },
    }),
    db.siteConfig.upsert({
      where: { locationId: masterLocation.id },
      create: { locationId: masterLocation.id },
      update: {},
    }),
  ]);
  console.log(JSON.stringify({ provisioned: true, masterLocationId: masterLocation.id, masterLocationName: masterLocation.name }));
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : "Provisioning failed"); process.exitCode = 1; })
  .finally(async () => { await disconnectDatabase?.(); });
