import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import { notFound } from "next/navigation";
import Image from "next/image";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { Metadata } from "next";

interface Props {
    params: Promise<{ domain: string; slug: string }>;
}

async function getBlogPost(locationId: string, slug: string) {
    const post = await db.blogPost.findFirst({
        where: {
            locationId,
            slug,
            published: true,
        },
    });
    return post;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) return {};

    const post = await getBlogPost(config.locationId, params.slug);
    if (!post) return {};

    return {
        title: `${post.title} | ${config.location.name ?? 'Blog'}`,
        description: post.excerpt,
    };
}

export default async function BlogPostPage(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const post = await getBlogPost(config.locationId, params.slug);
    if (!post) notFound();

    const imageUrl = post.coverImage
        ? getImageDeliveryUrl(post.coverImage, 'public')
        : null;

    return (
        <article className="container mx-auto px-4 py-12 max-w-4xl">
            <div className="mb-8 text-center">
                {imageUrl && (
                    <div className="aspect-[2/1] relative rounded-xl overflow-hidden mb-8 shadow-sm">
                        <Image src={imageUrl} alt={post.title} fill className="object-cover" priority />
                    </div>
                )}
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{post.title}</h1>
                {post.excerpt && <p className="text-xl text-gray-600 max-w-2xl mx-auto">{post.excerpt}</p>}

                <div className="flex items-center justify-center gap-4 mt-6 text-sm text-gray-500">
                    {post.authorName && <span>By {post.authorName}</span>}
                    {post.publishedAt && (
                        <>
                            <span>•</span>
                            <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
                        </>
                    )}
                </div>
            </div>

            <div
                className="prose prose-lg max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-img:rounded-lg"
                dangerouslySetInnerHTML={{ __html: post.content || "" }}
            />
        </article>
    );
}
