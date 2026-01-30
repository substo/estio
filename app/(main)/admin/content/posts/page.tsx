import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Plus, Pencil, Trash, ExternalLink } from "lucide-react";
import { deletePost } from "@/app/(main)/admin/content/actions";
import Image from "next/image";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";

export default async function PostsListPage() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) return null;

    const posts = await db.blogPost.findMany({
        where: { locationId: orgId },
        orderBy: { updatedAt: 'desc' }
    });

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: orgId },
        select: { domain: true }
    });

    const domain = siteConfig?.domain || "your-domain.com";
    const protocol = domain.includes("localhost") ? "http" : "https";
    const port = domain.includes("localhost") ? ":3000" : "";

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Blog Posts</h1>
                <Link href="/admin/content/posts/new">
                    <Button><Plus className="w-4 h-4 mr-2" /> Create Post</Button>
                </Link>
            </div>

            <div className="border rounded-md bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[80px]">Image</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {posts.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                    No posts found. Start writing!
                                </TableCell>
                            </TableRow>
                        )}
                        {posts.map((post) => (
                            <TableRow key={post.id}>
                                <TableCell>
                                    {post.coverImage ? (
                                        <div className="w-10 h-10 relative rounded overflow-hidden bg-gray-100">
                                            <Image
                                                src={getImageDeliveryUrl(post.coverImage, 'public')}
                                                alt="cover"
                                                fill
                                                className="object-cover"
                                            />
                                        </div>
                                    ) : (
                                        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">No Img</div>
                                    )}
                                </TableCell>
                                <TableCell className="font-medium">{post.title}</TableCell>
                                <TableCell className="text-muted-foreground">/blog/{post.slug}</TableCell>
                                <TableCell className="text-muted-foreground text-xs">
                                    {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '-'}
                                </TableCell>
                                <TableCell>
                                    <span className={`px-2 py-1 rounded-full text-xs ${post.published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                        {post.published ? 'Published' : 'Draft'}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                    <Link href={`/admin/content/posts/${post.id}`}>
                                        <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
                                    </Link>
                                    {post.published && (
                                        <a href={`${protocol}://${domain}${port}/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                                            <Button variant="ghost" size="icon" title="View Live"><ExternalLink className="w-4 h-4" /></Button>
                                        </a>
                                    )}
                                    <form action={async () => {
                                        "use server";
                                        await deletePost(post.id);
                                    }} className="inline">
                                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash className="w-4 h-4" /></Button>
                                    </form>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
