import { getLocationContext } from "@/lib/auth/location-context";
import { HomePageForm } from "./home-page-form";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { getEditorWebsiteConfig } from "@/lib/website/editor-config";
import { homeSectionBlocks } from "@/lib/website/home-sections";

export default async function AdminHomePage() {
    const orgId = (await getLocationContext())?.id;

    if (!orgId) return <div>Organization not found</div>;

    const realEstateEnabled = await getRequestAuthRealm() !== "substo";
    const siteConfig = await getEditorWebsiteConfig(orgId);
    const blocks = homeSectionBlocks(siteConfig, realEstateEnabled);

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-2xl font-bold">Edit Home Page</h1>
            <HomePageForm initialBlocks={blocks} siteConfig={siteConfig} realEstateEnabled={realEstateEnabled} />
        </div>
    );
}
