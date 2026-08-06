import "server-only";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";

export type PlatformAdminContext = { clerkUserId: string; internalUserId: string };

export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true, clerkId: true, platformRole: true } });
  if (!user || user.clerkId !== userId || user.platformRole !== "PLATFORM_ADMIN") return null;
  return { clerkUserId: userId, internalUserId: user.id };
}
