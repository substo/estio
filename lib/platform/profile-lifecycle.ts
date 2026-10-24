import { queryPath } from "../studio/rest-client";
export type ProfileRealm = "estio" | "substo";
export type ProfileLifecycleRead = <T>(path: string) => Promise<T>;
/** A deletion is terminal for a realm/Clerk ID, including stale sessions. */
export async function isPlatformProfileDeleted(read: ProfileLifecycleRead, brand: ProfileRealm, userId: string): Promise<boolean> {
 const rows = await read<Array<{ clerk_user_id: string }>>(queryPath("platform_profile_deletions", {
  select: "clerk_user_id", brand: `eq.${brand}`, clerk_user_id: `eq.${userId}`, limit: "1" }));
 return rows.length > 0;
}
