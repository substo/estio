import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { PageForm } from "../_components/page-form";

export default async function PageEditor(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

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
            <PageForm initialData={page} siteConfig={siteConfig} />
        </div>
    );
}
