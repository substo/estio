import { getLocationContext } from "@/lib/auth/location-context";
import { getLocationConfig } from "@/lib/location-config/service";
import db from "@/lib/db";
import { SubmissionsPageForm } from "./submissions-form";

export default async function AdminSubmissionsPage() {
    const orgId = (await getLocationContext())?.id;

    if (!orgId) return <div>Organization not found</div>;

    const siteConfig = await getLocationConfig(orgId);

    if (!siteConfig) return <div>Site Config not found</div>;

    // @ts-ignore
    const submissionsConfig = siteConfig.submissionsConfig || {};

    return (
        <div className="p-6">
            <SubmissionsPageForm config={submissionsConfig} siteConfig={siteConfig} />
        </div>
    );
}
