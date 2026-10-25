import { WebsiteBlogIndex } from "@/components/website/blog-index";
import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import { notFound } from "next/navigation";

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

    return <WebsiteBlogIndex posts={posts} />;
}
