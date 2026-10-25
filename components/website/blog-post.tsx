import Image from "next/image";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
export function WebsiteBlogPost({ post }: { post: any }) {
    const imageUrl = post.coverImage
        ? (post.coverImage.startsWith('https://') ? post.coverImage : getImageDeliveryUrl(post.coverImage, 'public'))
        : null;

    return (
        <article className="container mx-auto px-4 py-12 max-w-4xl">
            <div className="mb-8 text-center">
                {imageUrl && (
                    <div className="aspect-[2/1] relative rounded-xl overflow-hidden mb-8 shadow-sm">
                        <Image unoptimized={post.coverImage?.startsWith("https://")} src={imageUrl} alt={post.title} fill className="object-cover" priority />
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
