import { getLocationContext } from "@/lib/auth/location-context";
import { getLocationConfig } from "@/lib/location-config/service";
import db from "@/lib/db";
import { SearchPageForm } from "./search-form";

export default async function AdminSearchPage() {
    const orgId = (await getLocationContext())?.id;

    if (!orgId) return <div>Organization not found</div>;

    const siteConfig = await getLocationConfig(orgId);

    if (!siteConfig) return <div>Site Config not found</div>;

    // @ts-ignore
    const searchConfig = siteConfig.searchConfig || {};

    return (
        <div className="p-6">
            <SearchPageForm config={searchConfig} siteConfig={siteConfig} />
        </div>
    );
}
