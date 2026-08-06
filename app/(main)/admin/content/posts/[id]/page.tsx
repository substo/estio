
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { PostForm } from "../_components/post-form";

export default async function PostEditor(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const orgId = (await getLocationContext())?.id;

    if (!orgId) return null;
    let post = null;
    if (params.id !== "new") {
        post = await db.blogPost.findUnique({
            where: { id: params.id, locationId: orgId! }
        });
    }

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">{post ? "Edit Post" : "New Post"}</h1>
            <PostForm initialData={post} locationId={orgId!} />
        </div>
    );
}
