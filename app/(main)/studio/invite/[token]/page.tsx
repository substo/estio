import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveHostBrand, getHostBrandConfig } from "@/lib/auth/host-brand";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };

/**
 * Studio invite links are retired: people are invited to a brand from its
 * Team page and receive an email from Substo. Old links only explain that.
 */
export default async function RetiredStudioInvitationPage() {
  if (resolveHostBrand((await headers()).get("host"), getHostBrandConfig()) !== "substo") notFound();
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-4 p-6">
      <p className="text-sm font-medium text-muted-foreground">Substo</p>
      <h1 className="text-3xl font-semibold tracking-tight">This invitation link is no longer used</h1>
      <p className="text-muted-foreground">
        Invitations are now sent by email from a brand&apos;s Team page. Ask the brand admin to invite you with your email address, then sign in with that address.
      </p>
      <Link href="/studio" className="text-sm font-medium text-primary hover:underline">Go to Substo</Link>
    </main>
  );
}
