import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { notFound } from "next/navigation";
import { SubstoPageForm } from "../_components/substo-page-form";
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

    if (await getRequestAuthRealm() === "substo") {
        if (params.id !== "new" && !page) notFound();
        return <div className="space-y-6 p-6"><h1 className="text-2xl font-semibold">{page ? "Edit page" : "New page"}</h1><SubstoPageForm page={page} locationId={orgId} /></div>;
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
