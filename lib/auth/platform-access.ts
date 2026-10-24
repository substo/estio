import "server-only";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { isBusinessRealm, realmClerkIdWhere } from "@/lib/auth/auth-realm";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";

export type PlatformAdminContext = { clerkUserId: string; internalUserId: string };

export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  const { userId, actor } = await auth();
  if (!userId || actor) return null;
  const realm = await getRequestAuthRealm();
  if (!isBusinessRealm(realm)) return null;
  if (realm !== "estio") return null;
  const user = await db.user.findUnique({ where: realmClerkIdWhere(realm, userId), select: { id: true, authRealm: true, clerkId: true, platformRole: true } });
  if (!user || user.clerkId !== userId || user.authRealm !== realm || user.platformRole !== "PLATFORM_ADMIN") return null;
  return { clerkUserId: userId, internalUserId: user.id };
}
