import { getSiteConfig, getPublicPropertyBySlug } from "@/lib/public-data";
import { notFound } from "next/navigation";
import Image from "next/image";
import { Metadata } from "next";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { LeadForm } from "@/components/public/lead-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Bed, Bath, Maximize, Car, MapPin, Check,
    Phone, Share2, ShieldCheck, PlayCircle
} from "lucide-react";
import { FEATURE_CATEGORIES, PUBLIC_FEATURES_LIST } from "@/lib/properties/filter-constants";
import { PropertyGallery } from "./property-gallery";
import { auth } from "@clerk/nextjs/server";
import { Edit } from "lucide-react";
import { FavoriteButton } from "../../_components/favorite-button";
import { isFavorited } from "@/app/actions/public-user";

interface Props {
    params: Promise<{ domain: string; slug: string }>;
}

// Helper to generate Schema
function generateJsonLd(property: any, domain: string) {
    let imageUrl = "/placeholder-house.png";
    if (property.media?.length && property.media[0].cloudflareImageId) {
        imageUrl = getImageDeliveryUrl(property.media[0].cloudflareImageId, "public");
    } else if (property.images?.length) {
        imageUrl = property.images[0];
    }

    const schema = {
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        "name": property.title,
        "description": property.description,
        "image": [imageUrl],
        "datePosted": property.createdAt,
        "url": `https://${domain}/properties/${property.slug}`,
        "address": {
            "@type": "PostalAddress",
            "streetAddress": property.addressLine1,
            "addressLocality": property.city,
            "addressRegion": property.propertyLocation || "",
            "postalCode": property.postalCode,
            "addressCountry": property.country || "Cyprus"
        },
        "offers": {
            "@type": "Offer",
            "price": property.price,
            "priceCurrency": property.currency || "EUR",
            "availability": property.status === "ACTIVE" ? "https://schema.org/InStock" : "https://schema.org/Sold"
        },
        "numberOfRooms": property.bedrooms,
        "numberOfBathroomsTotal": property.bathrooms,
        "floorSize": {
            "@type": "QuantitativeValue",
            "value": property.areaSqm,
            "unitCode": "SQM"
        }
    };

    return schema;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) return {};
    const property = await getPublicPropertyBySlug(config.locationId, params.slug);
    if (!property) return { title: "Property Not Found" };

    let ogImage = "/placeholder-house.png";
    if (property.media?.length && property.media[0].cloudflareImageId) {
        ogImage = getImageDeliveryUrl(property.media[0].cloudflareImageId, "public");
    } else if (property.images?.length) {
        ogImage = property.images[0];
    }

    const title = `${property.title} | ${config.location.name}`;
    const description = property.description?.slice(0, 160) || "View details for this property.";

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            images: [{ url: ogImage, width: 1200, height: 630 }],
            type: "website",
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [ogImage],
        },
    };
}

export default async function PropertyDetailPage(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const property = await getPublicPropertyBySlug(config.locationId, params.slug);
    if (!property) notFound();

    const price = new Intl.NumberFormat("en-US", { style: "currency", currency: property.currency || "EUR", maximumFractionDigits: 0 }).format(property.price || 0);

    // Check if property is favorited by current user
    const propertyIsFavorited = await isFavorited(property.id);

    // Extract all images for gallery
    let allImages: string[] = [];
    if (property.media && property.media.length > 0) {
        // Filter out only images (not videos) if mixed, but usually 'media' here implies visual assets.
        // The previous code filtered videos separately later, so we assume media contains images AND videos potentially.
        // Let's filter for images only if 'kind' exists, or assume all are images if not specified.
        allImages = property.media
            .filter((m: any) => !m.kind || m.kind === 'IMAGE')
            .map((m: any) => {
                if (m.cloudflareImageId) return getImageDeliveryUrl(m.cloudflareImageId, "public");
                return m.url;
            });
    } else if (property.images && property.images.length > 0) {
        allImages = property.images;
    }

    // Fallback if no images
    if (allImages.length === 0) {
        allImages = ["/placeholder-house.png"];
    }

    const mainImageUrl = allImages[0];
    const jsonLd = generateJsonLd(property, params.domain);

    // Extract features list
    const featuresList = (property.features || []).filter((f: string) => PUBLIC_FEATURES_LIST.includes(f));

    // Extract videos
    const videoUrls: string[] = [];
    if (property.media) {
        property.media.filter((m: any) => m.kind === 'VIDEO').forEach((m: any) => videoUrls.push(m.url));
    }
    // Safe access for legacy videoUrls
    const legacyVideoUrls = (property as any).videoUrls;
    if (legacyVideoUrls && typeof legacyVideoUrls === 'string') {
        const legacy = legacyVideoUrls.split('\n').map((s: string) => s.trim()).filter(Boolean);
        legacy.forEach((url: string) => {
            if (!videoUrls.includes(url)) videoUrls.push(url);
        });
    }

    // Helper to get readable feature label
    const getFeatureLabel = (key: string) => {
        for (const category of FEATURE_CATEGORIES) {
            const found = category.items.find(item => item.key === key);
            if (found) return found.label;
        }
        return key; // Fallback to key if not found (e.g., legacy or custom tag)
    };

    return (
        <div className="min-h-screen bg-background font-sans text-foreground">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />

            <main className="pt-8 pb-20">
                {/* Breadcrumb / Top Header */}
                <div className="container mx-auto px-4 md:px-6 mb-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                        <div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                <span>Properties</span>
                                <span>/</span>
                                <span>{property.city || "Cyprus"}</span>
                                <span>/</span>
                                <span style={{ color: 'var(--primary-brand)' }} className="font-semibold">
                                    Ref. {property.reference || property.agentRef || property.slug}
                                </span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-extrabold text-foreground mb-2">
                                {property.title}
                            </h1>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <MapPin className="h-4 w-4" />
                                <span className="font-medium">{property.addressLine1}, {property.city}</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-start md:items-end">
                            <div className="text-3xl md:text-4xl font-bold mb-1" style={{ color: 'var(--primary-brand)' }}>
                                {price}
                                {/* Assuming VAT included/excluded logic if needed, currently omitted as per schema check */}
                            </div>
                            <div className="flex gap-2">
                                <FavoriteButton
                                    propertyId={property.id}
                                    initialFavorited={propertyIsFavorited}
                                    variant="button"
                                    size="sm"
                                />
                                <Button variant="outline" size="sm" className="gap-2">
                                    <Share2 className="h-4 w-4" /> Share
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Image Gallery */}
                <div className="container mx-auto px-4 md:px-6 mb-12">
                    <PropertyGallery
                        images={allImages}
                        title={property.title}
                        status={property.status}
                        condition={property.condition}
                    />
                </div>

                {/* Main Content Grid */}
                <div className="container mx-auto px-4 md:px-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

                        {/* Left Column: Details */}
                        <div className="lg:col-span-2 space-y-10">

                            {/* Key Specs Bar */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-secondary/30 border border-border rounded-sm">
                                <div className="flex flex-col items-center justify-center text-center">
                                    <Bed className="h-6 w-6 mb-2" style={{ color: 'var(--primary-brand)' }} />
                                    <span className="font-bold text-lg">{property.bedrooms || "-"}</span>
                                    <span className="text-xs uppercase text-muted-foreground tracking-wider">Bedrooms</span>
                                </div>
                                <div className="flex flex-col items-center justify-center text-center border-l border-border/50">
                                    <Bath className="h-6 w-6 mb-2" style={{ color: 'var(--primary-brand)' }} />
                                    <span className="font-bold text-lg">{property.bathrooms || "-"}</span>
                                    <span className="text-xs uppercase text-muted-foreground tracking-wider">Bathrooms</span>
                                </div>
                                <div className="flex flex-col items-center justify-center text-center border-l border-border/50">
                                    <Maximize className="h-6 w-6 mb-2" style={{ color: 'var(--primary-brand)' }} />
                                    <span className="font-bold text-lg">{property.areaSqm || "-"} m²</span>
                                    <span className="text-xs uppercase text-muted-foreground tracking-wider">Covered</span>
                                </div>
                                <div className="flex flex-col items-center justify-center text-center border-l border-border/50">
                                    <Car className="h-6 w-6 mb-2" style={{ color: 'var(--primary-brand)' }} />
                                    {/* Assuming features might contain parking info, otherwise generic */}
                                    <span className="font-bold text-lg">
                                        {featuresList.some(f => f.toLowerCase().includes('parking')) ? "Yes" : "-"}
                                    </span>
                                    <span className="text-xs uppercase text-muted-foreground tracking-wider">Parking</span>
                                </div>
                            </div>

                            {/* Description */}
                            {/* Additional Specs Grid (Moved to top) */}
                            <div className="mt-6">
                                <h3 className="text-lg font-bold mb-4">Additional Details</h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8 text-sm">
                                    {property.plotAreaSqm ? (
                                        <div>
                                            <span className="text-muted-foreground block">Plot Area</span>
                                            <span className="font-medium">{property.plotAreaSqm} m²</span>
                                        </div>
                                    ) : null}
                                    {property.coveredVerandaSqm ? (
                                        <div>
                                            <span className="text-muted-foreground block">Covered Veranda</span>
                                            <span className="font-medium">{property.coveredVerandaSqm} m²</span>
                                        </div>
                                    ) : null}
                                    {property.uncoveredVerandaSqm ? (
                                        <div>
                                            <span className="text-muted-foreground block">Uncovered Veranda</span>
                                            <span className="font-medium">{property.uncoveredVerandaSqm} m²</span>
                                        </div>
                                    ) : null}
                                    {property.basementSqm ? (
                                        <div>
                                            <span className="text-muted-foreground block">Basement</span>
                                            <span className="font-medium">{property.basementSqm} m²</span>
                                        </div>
                                    ) : null}
                                    {property.buildYear ? (
                                        <div>
                                            <span className="text-muted-foreground block">Build Year</span>
                                            <span className="font-medium">{property.buildYear}</span>
                                        </div>
                                    ) : null}
                                    {property.floor !== null && property.floor !== undefined ? (
                                        <div>
                                            <span className="text-muted-foreground block">Floor</span>
                                            <span className="font-medium">{property.floor === 0 ? "Ground" : property.floor}</span>
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {/* Financial Details (Conditionally shown, Moved to top) */}
                            {((property.communalFees || 0) > 0 || property.goal === 'RENT') && (
                                <div className="mt-8 pt-8 border-t border-border">
                                    <h3 className="text-lg font-bold mb-4">Financial & Terms</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8 text-sm">
                                        {(property.communalFees || 0) > 0 && (
                                            <div>
                                                <span className="text-muted-foreground block">Communal Fees</span>
                                                <span className="font-medium">€{property.communalFees} / month</span>
                                            </div>
                                        )}
                                        {property.goal === 'RENT' && (
                                            <>
                                                {property.deposit && (
                                                    <div>
                                                        <span className="text-muted-foreground block">Deposit</span>
                                                        <span className="font-medium">{property.deposit}</span>
                                                    </div>
                                                )}
                                                {!property.deposit && (property.depositValue || 0) > 0 && (
                                                    <div>
                                                        <span className="text-muted-foreground block">Deposit Amount</span>
                                                        <span className="font-medium">€{property.depositValue}</span>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {/* Boolean/Status items can take up their own slots or be grouped. 
                                            For grid consistency, let's treat them as items with a label/status structure 
                                            or simple full-height flex items. 
                                        */}
                                        {property.priceIncludesCommunalFees && (
                                            <div className="flex flex-col justify-center h-full">
                                                <div className="flex items-center gap-2">
                                                    <Check className="h-4 w-4 text-green-500 shrink-0" />
                                                    <span className="font-medium">Rent includes fees</span>
                                                </div>
                                            </div>
                                        )}
                                        {property.goal === 'RENT' && property.billsTransferable !== undefined && (
                                            <div className="flex flex-col justify-center h-full">
                                                <div className="flex items-center gap-2">
                                                    {property.billsTransferable ? (
                                                        <Check className="h-4 w-4 text-green-500 shrink-0" />
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs shrink-0">•</span>
                                                    )}
                                                    <span className="font-medium">
                                                        {property.billsTransferable ? "Bills Transferable" : "Bills Owner's Name"}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Description & Features (Moved below Additional Details/Financials) */}
                            <div className="mt-8 pt-8 border-t border-border">
                                <h2 className="text-2xl font-bold text-foreground mb-4">Description</h2>
                                <div
                                    className="text-muted-foreground leading-normal text-lg prose max-w-none"
                                    dangerouslySetInnerHTML={{ __html: property.description || "" }}
                                />

                                {featuresList.length > 0 && (
                                    <div className="mt-8">
                                        <h3 className="text-lg font-bold mb-4">Key Features</h3>
                                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {featuresList.slice(0, 10).map((featureKey: string, idx: number) => (
                                                <li key={idx} className="flex items-start gap-3">
                                                    <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: 'var(--primary-brand-light, rgba(0,0,0,0.05))' }}>
                                                        <Check className="h-3.5 w-3.5 stroke-[3]" style={{ color: 'var(--primary-brand)' }} />
                                                    </div>
                                                    <span className="text-foreground/80">{getFeatureLabel(featureKey)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            {/* Video Section */}
                            {videoUrls.length > 0 && (
                                <div className="mt-8 pt-8 border-t border-border">
                                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                        <PlayCircle className="h-5 w-5" /> Video Tour
                                    </h3>
                                    <div className="grid grid-cols-1 gap-4">
                                        {videoUrls.map((url, idx) => (
                                            <div key={idx} className="aspect-video rounded-sm overflow-hidden bg-black/10 relative">
                                                {/* Simple iframe for YouTube/Vimeo if detected, else link */}
                                                {(url.includes('youtube.com') || url.includes('youtu.be')) ? (
                                                    <iframe
                                                        src={url.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                                                        className="w-full h-full"
                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                        allowFullScreen
                                                    />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full">
                                                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary font-bold underline">
                                                            <PlayCircle className="h-8 w-8" />
                                                            Watch Video
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right Column: Sticky Contact Form */}
                        <div className="lg:col-span-1">
                            <div className="sticky top-24 space-y-6">
                                <Card className="border border-border shadow-lg rounded-sm overflow-hidden">
                                    <div className="p-4 text-white" style={{ backgroundColor: 'var(--primary-brand)' }}>
                                        <h3 className="font-bold text-lg">Interested in this property?</h3>
                                        <p className="text-white/80 text-sm">Ref: {property.reference || property.agentRef || property.slug}</p>
                                    </div>
                                    <CardContent className="p-6 space-y-4">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                                                <Phone className="h-6 w-6" style={{ color: 'var(--primary-brand)' }} />
                                            </div>
                                            <div>
                                                <p className="text-sm text-muted-foreground">Call us directly</p>
                                                {/* Using generic phone or site config phone if available */}
                                                <p className="text-lg font-bold text-foreground">
                                                    {/* We can use site config phone here if passed, but for now hardcode generic or use variable */}
                                                    +357 25 123 456
                                                </p>
                                            </div>
                                        </div>

                                        <LeadForm domain={params.domain} propertyId={property.id} />

                                    </CardContent>
                                </Card>

                                <div className="p-6 bg-secondary/30 rounded-sm border border-border">
                                    <h4 className="font-bold text-foreground mb-2">Why buy with us?</h4>
                                    <ul className="space-y-2 text-sm text-muted-foreground">
                                        <li className="flex items-center gap-2"><Check className="h-4 w-4" style={{ color: 'var(--primary-brand)' }} /> No buyer fees</li>
                                        <li className="flex items-center gap-2"><Check className="h-4 w-4" style={{ color: 'var(--primary-brand)' }} /> Full legal support</li>
                                        <li className="flex items-center gap-2"><Check className="h-4 w-4" style={{ color: 'var(--primary-brand)' }} /> After-sales service</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </main>

            {/* Admin Quick Link */}
            {((await auth()).userId || process.env.NODE_ENV === 'development') && (
                <div className="fixed bottom-4 left-4 z-50">
                    <Button asChild variant="default" size="sm" className="shadow-lg gap-2 bg-slate-900 text-white hover:bg-slate-800">
                        <a
                            href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/admin/properties/${property.id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <Edit className="h-4 w-4" />
                            View in Database
                        </a>
                    </Button>
                </div>
            )}
        </div>
    );
}
