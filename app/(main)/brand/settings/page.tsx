import { redirect } from "next/navigation";
import { getSubstoBrandActor } from "@/lib/brands/substo-brands";
import { RenameBrandForm } from "../_components/brand-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brand settings" };

export default async function BrandSettingsPage() {
  const actor = await getSubstoBrandActor();
  if (!actor) redirect("/studio?choose=1");
  const isAdmin = actor.role === "ADMIN";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Brand settings</h1>
        <p className="text-muted-foreground">A brand is what your team works on: its Studio research and content, and later its CRM and website.</p>
      </header>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-lg font-medium">Name</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">{isAdmin ? "Shown to your team and in Studio." : "Only brand admins can rename the brand."}</p>
        <RenameBrandForm name={actor.brandName} disabled={!isAdmin} />
      </section>
    </main>
  );
}
