import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { withBusinessDetails } from "@/lib/business-profile/service";
import { FavoritesPageForm } from "./favorites-form";

export default async function AdminFavoritesPage() {
    const orgId = (await getLocationContext())?.id;

    if (!orgId) return <div>Organization not found</div>;

    const siteConfig = await withBusinessDetails(await db.siteConfig.findUnique({ where: { locationId: orgId } }), orgId);

    if (!siteConfig) return <div>Site Config not found</div>;

    // @ts-ignore
    const favoritesConfig = siteConfig.favoritesConfig || {};

    return (
        <div className="p-6">
            <FavoritesPageForm config={favoritesConfig} siteConfig={siteConfig} />
        </div>
    );
}
