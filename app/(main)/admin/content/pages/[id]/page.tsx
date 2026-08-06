import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { PageForm } from "../_components/page-form";

export default async function PageEditor(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const orgId = (await getLocationContext())?.id;

    if (!orgId) return null;

    let page = null;
    if (params.id !== "new") {
        page = await db.contentPage.findUnique({
            where: { id: params.id, locationId: orgId! }
        });
    }

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: orgId }
    });

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">{page ? "Edit Page" : "New Page"}</h1>
            <PageForm initialData={page} siteConfig={siteConfig} locationId={orgId} />
        </div>
    );
}
