import { PublicBlockRenderer } from "@/app/(public-site)/_components/public-block-renderer";
import { SetHeaderStyle } from "@/app/(public-site)/[domain]/_components/header-context";

/** Both editions use the original website page layout and block renderer. */
export function WebsitePageView({ page, config }: { page: any; config: any }) {
    // Check if we have legacy content or new blocks
    const hasBlocks = page.blocks && Array.isArray(page.blocks) && page.blocks.length > 0;
    const heroImage = (page as any).heroImage;
    const headerStyle = page.headerStyle;

    return (
        <div className="min-h-screen bg-slate-50">
            {headerStyle && <SetHeaderStyle style={headerStyle} />}

            {/* Optional Hero Section for Transparent Header */}
            {headerStyle === 'transparent' && heroImage && (
                <div className="relative h-[50vh] min-h-[350px] w-full flex items-center justify-center text-white">
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${heroImage})` }}
                    >
                        <div className="absolute inset-0 bg-black/40" />
                    </div>
                    <div className="relative z-10 text-center px-4">
                        <h1 className="text-4xl md:text-5xl font-bold font-heading mb-4 drop-shadow-md">
                            {page.title}
                        </h1>
                    </div>
                </div>
            )}

            {/* If using new blocks, the renderer handles layout/containers per block. */}
            {hasBlocks ? (
                <PublicBlockRenderer blocks={page.blocks as any[]} siteConfig={config} />
            ) : (
                /* Legacy Layout for simple HTML content */
                <div className="container mx-auto px-4 py-12 max-w-4xl">
                    {/* Only show title here if no hero was shown */}
                    {!(headerStyle === 'transparent' && heroImage) && (
                        <div className="mb-8 text-center">
                            <h1 className="text-4xl font-bold tracking-tight">{page.title}</h1>
                        </div>
                    )}
                    <div
                        className="prose prose-lg max-w-none prose-headings:font-bold prose-a:text-blue-600"
                        dangerouslySetInnerHTML={{ __html: page.content || "" }}
                    />
                </div>
            )}
        </div>
    );
}
