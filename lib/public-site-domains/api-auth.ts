import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";

export async function requirePublicSiteDomainAdmin(locationId: string) {
    const { userId } = await auth();
    if (!userId || !locationId || !(await verifyUserIsLocationAdmin(userId, locationId))) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return { clerkUserId: userId, userId: user?.id || null };
}
