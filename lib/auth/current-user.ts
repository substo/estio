import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";

export async function resolveAuthenticatedDbUserId(): Promise<string | null> {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) return null;

        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: { id: true },
        });
        return user?.id || null;
    } catch {
        return null;
    }
}
