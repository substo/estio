import { getSiteConfig } from "@/lib/public-data";
import { getUserSubmissions } from "@/app/actions/public-user";
import { PropertyCard } from "../_components/property-card";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SetHeaderStyle } from "../_components/header-context";

interface Props {
    params: Promise<{ domain: string }>;
}

export async function generateMetadata(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    // @ts-ignore
    const submissionsConfig = (config?.submissionsConfig as any) || {};
    const title = submissionsConfig.title || "My Submissions";
    const metaTitle = submissionsConfig.metaTitle || title;
    const metaDescription = submissionsConfig.metaDescription || "View and manage your submitted properties";

    return {
        title: `${metaTitle} | ${config?.location?.name || "Properties"}`,
        description: metaDescription,
    };
}

export default async function SubmissionsPage(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const { userId } = await auth();
    if (!userId) {
        redirect(`/sign-in?redirect_url=/submissions`);
    }

    const submissions = await getUserSubmissions();
    const primaryColor = config.primaryColor || undefined;

    // @ts-ignore
    const submissionsConfig = (config.submissionsConfig || {}) as any;
    const title = submissionsConfig.title || "My Submissions";
    const emptyTitle = submissionsConfig.emptyTitle || "No submissions yet";
    const emptyBody = submissionsConfig.emptyBody || "You haven't submitted any properties yet.";
    const headerStyle = submissionsConfig.headerStyle || "solid";
    const heroImage = submissionsConfig.heroImage;

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* 1. Dynamic Header Style Injection */}
            <SetHeaderStyle style={headerStyle} />

            {/* 2. Optional Hero Section (if Transparent Header) */}
            {headerStyle === 'transparent' && heroImage ? (
                <div className="relative h-[40vh] min-h-[300px] w-full flex items-center justify-center text-white mb-8">
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${heroImage})` }}
                    >
                        <div className="absolute inset-0 bg-black/40" />
                    </div>
                    <div className="relative z-10 text-center px-4 w-full container mx-auto flex flex-col items-center">
                        <h1 className="text-4xl md:text-5xl font-bold font-heading mb-4 drop-shadow-md">
                            {title}
                        </h1>
                        <p className="text-white/90 font-medium">
                            {submissions.length} submitted {submissions.length === 1 ? "property" : "properties"}
                        </p>
                        {submissions.length > 0 && config.publicListingEnabled !== false && (
                            <Button asChild className="mt-6" style={{ backgroundColor: primaryColor }}>
                                <Link href="/properties/add">
                                    Submit New Property
                                </Link>
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                // Standard Title Block
                <div className="container mx-auto px-4 pt-12 mb-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold text-foreground flex items-center gap-3">
                                <Building2 className="h-8 w-8" style={{ color: primaryColor, fill: primaryColor }} />
                                {title}
                            </h1>
                            <p className="text-muted-foreground mt-2">
                                {submissions.length} submitted {submissions.length === 1 ? "property" : "properties"}
                            </p>
                        </div>
                        {submissions.length > 0 && config.publicListingEnabled !== false && (
                            <Button asChild style={{ backgroundColor: primaryColor }}>
                                <Link href="/properties/add">
                                    Submit New Property
                                </Link>
                            </Button>
                        )}
                    </div>
                </div>
            )}


            <main className="container mx-auto px-4">
                {/* Empty State / Grid */}
                {submissions.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                        {submissions.map((property: any) => (
                            <PropertyCard
                                key={property.id}
                                property={property}
                                domain={params.domain}
                                primaryColor={primaryColor}
                                isFavorited={false}
                                customHref={`/submissions/${property.id}`}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 px-4">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-secondary mb-6">
                            <Building2 className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <h2 className="text-xl font-semibold text-foreground mb-2">
                            {emptyTitle}
                        </h2>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto whitespace-pre-wrap">
                            {emptyBody}
                        </p>
                        {config.publicListingEnabled !== false && (
                            <Button asChild style={{ backgroundColor: primaryColor }}>
                                <Link href="/properties/add">
                                    List Your Property
                                </Link>
                            </Button>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
