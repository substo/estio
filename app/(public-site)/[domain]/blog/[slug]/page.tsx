import { WebsiteBlogPost } from "@/components/website/blog-post";
import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import { notFound } from "next/navigation";
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

    return <WebsiteBlogPost post={post} />;
}
