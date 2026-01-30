
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { PostForm } from "../_components/post-form";

export default async function PostEditor(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

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
