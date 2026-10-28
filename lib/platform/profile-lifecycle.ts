import { cache } from "react";
import { Prisma } from "@prisma/client";
import type { StudioDb } from "../studio/db";
export type ProfileRealm = "estio" | "substo";
/** Cached per request: a deletion is terminal, and pages ask several times. */
const readProfileDeleted = cache(async (db: StudioDb, app: ProfileRealm, clerkUserId: string) =>
  Boolean(await db.one(Prisma.sql`select clerk_user_id from studio.platform_profile_deletions where app = ${app} and clerk_user_id = ${clerkUserId}`)));
/** A deletion is terminal for an app/Clerk ID, including stale sessions. */
export async function isPlatformProfileDeleted(db: StudioDb, app: ProfileRealm, clerkUserId: string): Promise<boolean> {
  return readProfileDeleted(db, app, clerkUserId);
}
