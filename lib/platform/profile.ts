import "server-only";
import { isPlatformProfileDeleted } from "./profile-lifecycle";
import { studioDb } from "../studio/studio-db";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from "@/lib/auth/host-brand";
export interface PlatformProfile { brand: "estio" | "substo"; userId: string; sessionId: string; origin: string; }
/** Profile authority has no workspace/location dependency and never merges by email. */
export async function getPlatformProfile(): Promise<PlatformProfile | null> {
  const host = (await headers()).get("host");
  const brand = resolveHostBrand(host, getHostBrandConfig()); const origin = getHostOrigin(host);
  const state = await auth();
  if ((brand !== "estio" && brand !== "substo") || !origin || !state.userId || !state.sessionId || state.actor) return null;
  if (await isPlatformProfileDeleted(studioDb, brand, state.userId)) return null;
  return { brand, userId: state.userId, sessionId: state.sessionId, origin };
}
