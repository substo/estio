import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";

export default async function BlogIndex(props: { params: Promise<{ domain: string }> }) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const posts = await db.blogPost.findMany({
        where: {
            locationId: config.locationId,
            published: true,
        },
        orderBy: { publishedAt: 'desc' },
    });

    return (
        <div className="container mx-auto px-4 py-12">
            <h1 className="text-3xl font-bold mb-8">Latest News</h1>

            {posts.length === 0 ? (
                <p className="text-gray-500">No posts found.</p>
            ) : (
                <div className="grid md:grid-cols-3 gap-8">
                    {posts.map(post => {
                        const imageUrl = post.coverImage
                            ? getImageDeliveryUrl(post.coverImage, 'public')
                            : null;

                        return (
                            <Link key={post.id} href={`/blog/${post.slug}`} className="group block h-full">
                                <div className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow h-full flex flex-col">
                                    <div className="aspect-video relative bg-gray-100">
                                        {imageUrl ? (
                                            <Image src={imageUrl} alt={post.title} fill className="object-cover" />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-gray-400 bg-gray-50">No Image</div>
                                        )}
                                    </div>
                                    <div className="p-4 flex flex-col flex-grow">
                                        <h2 className="text-xl font-bold group-hover:text-blue-600 transition-colors mb-2">
                                            {post.title}
                                        </h2>
                                        {post.excerpt && <p className="text-gray-600 text-sm mb-4 line-clamp-3">{post.excerpt}</p>}
                                        <div className="mt-auto pt-2 text-xs text-gray-400 border-t">
                                            {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : 'Draft'}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
