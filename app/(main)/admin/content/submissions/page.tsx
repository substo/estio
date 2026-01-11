import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { SubmissionsPageForm } from "./submissions-form";

export default async function AdminSubmissionsPage() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) return <div>Organization not found</div>;

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: orgId }
    });

    if (!siteConfig) return <div>Site Config not found</div>;

    // @ts-ignore
    const submissionsConfig = siteConfig.submissionsConfig || {};

    return (
        <div className="p-6">
            <SubmissionsPageForm config={submissionsConfig} siteConfig={siteConfig} />
        </div>
    );
}
