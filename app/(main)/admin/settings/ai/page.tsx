import db from "@/lib/db";
import { AiSettingsForm } from "./ai-settings-form";
import { cookies } from "next/headers";
import { getLocationContext } from "@/lib/auth/location-context";

export default async function AiSettingsPage(props: { searchParams: Promise<{ locationId?: string }> }) {
    const searchParams = await props.searchParams;
    const cookieStore = await cookies();

    // Try to get location from Context Helper first (User Metadata/DB)
    const contextLocation = await getLocationContext();
    const locationId = searchParams.locationId ||
        contextLocation?.id ||
        cookieStore.get("crm_location_id")?.value;

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    // Fetch existing config
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
    });

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">AI Configuration</h1>
                <p className="text-muted-foreground">
                    Manage AI models, API keys, and brand voice settings.
                </p>
            </div>

            <div className="border rounded-lg p-6 bg-card">
                <AiSettingsForm initialData={siteConfig} locationId={locationId} />
            </div>
        </div>
    );
}
