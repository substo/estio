import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { businessClerkIdWhere } from "@/lib/auth/auth-realm";

export async function resolveAuthenticatedDbUserId(): Promise<string | null> {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) return null;

        const user = await db.user.findUnique({
            where: businessClerkIdWhere(clerkUserId),
            select: { id: true },
        });
        return user?.id || null;
    } catch {
        return null;
    }
}
