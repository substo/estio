import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { SearchPageForm } from "./search-form";

export default async function AdminSearchPage() {
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
    const searchConfig = siteConfig.searchConfig || {};

    return (
        <div className="p-6">
            <SearchPageForm config={searchConfig} siteConfig={siteConfig} />
        </div>
    );
}
