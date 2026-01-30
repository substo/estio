// ... imports
import { getSiteConfig } from "@/lib/public-data";
import { getFavorites } from "@/app/actions/public-user";
import { PropertyCard } from "../_components/property-card";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Heart } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SetHeaderStyle } from "../_components/header-context";
import { PublicHero } from "../_components/hero-section"; // Assuming this exists or we build a simple one

interface Props {
    params: Promise<{ domain: string }>;
}

export async function generateMetadata(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    // @ts-ignore
    const favoritesConfig = (config?.favoritesConfig as any) || {};
    const title = favoritesConfig.title || "My Favorites";
    const metaTitle = favoritesConfig.metaTitle || title;
    const metaDescription = favoritesConfig.metaDescription || "View your saved properties";

    return {
        title: `${metaTitle} | ${config?.location?.name || "Properties"}`,
        description: metaDescription,
    };
}

export default async function FavoritesPage(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const { userId } = await auth();
    if (!userId) {
        redirect(`/sign-in?redirect_url=/favorites`);
    }

    const favorites = await getFavorites();
    const primaryColor = config.primaryColor || undefined;

    // @ts-ignore
    const favConfig = (config.favoritesConfig || {}) as any;
    const title = favConfig.title || "My Favorites";
    const emptyTitle = favConfig.emptyTitle || "No favorites yet";
    const emptyBody = favConfig.emptyBody || "Start exploring properties and tap the heart icon to save them here for easy access.";
    const headerStyle = favConfig.headerStyle || "solid";
    const heroImage = favConfig.heroImage;

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
                    <div className="relative z-10 text-center px-4">
                        <h1 className="text-4xl md:text-5xl font-bold font-heading mb-4 drop-shadow-md">
                            {title}
                        </h1>
                    </div>
                </div>
            ) : (
                // Standard Title Block
                <div className="container mx-auto px-4 pt-12 mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground flex items-center gap-3">
                        <Heart className="h-8 w-8" style={{ color: primaryColor, fill: primaryColor }} />
                        {title}
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        {favorites.length} saved {favorites.length === 1 ? "property" : "properties"}
                    </p>
                </div>
            )}


            <main className="container mx-auto px-4">
                {/* Empty State / Grid */}
                {favorites.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {favorites.map((property: any) => (
                            <PropertyCard
                                key={property.id}
                                property={property}
                                domain={params.domain}
                                primaryColor={primaryColor}
                                isFavorited={true}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 px-4">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-secondary mb-6">
                            <Heart className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <h2 className="text-xl font-semibold text-foreground mb-2">
                            {emptyTitle}
                        </h2>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto whitespace-pre-wrap">
                            {emptyBody}
                        </p>
                        <Button asChild style={{ backgroundColor: primaryColor }}>
                            <Link href="/properties/search">
                                Browse Properties
                            </Link>
                        </Button>
                    </div>
                )}
            </main>
        </div>
    );
}
