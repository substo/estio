import { headers } from "next/headers";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { BrandExperience } from "@/components/wrapper/brand-experience";
import { SignInContent } from "./sign-in-content";

/** The auth page carries its verified brand even during cached client layout transitions. */
export default async function SignInPage() {
    const brand = resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
    return <BrandExperience brand={brand}><SignInContent /></BrandExperience>;
}
