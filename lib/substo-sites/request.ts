import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import db from "@/lib/db";
import { resolveHostBrand, getHostBrandConfig } from "@/lib/auth/host-brand";
import { getPublishedWebsite } from "./service";

/** Per-render deduplication only; publishing/unpublishing is visible on the next request. */
export const loadPublicWebsite = cache(async (slug: string) => {
  if (resolveHostBrand((await headers()).get("host"), getHostBrandConfig()) !== "substo") return null;
  return getPublishedWebsite(db, slug);
});
