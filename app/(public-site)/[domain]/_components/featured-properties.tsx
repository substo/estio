"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bed, Bath, Maximize, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface FeaturedPropertiesProps {
    properties: any[];
    primaryColor?: string;
    domain: string;
}

export function FeaturedProperties({ properties, primaryColor, domain }: FeaturedPropertiesProps) {
    if (!properties || properties.length === 0) return null;

    return (
        <motion.section
            layout
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            className="py-24 bg-secondary/30"
        >
            <div className="container mx-auto px-4 md:px-6">
                <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <div
                                className="h-1 w-10 rounded-full"
                                style={{ backgroundColor: primaryColor || 'var(--primary)' }}
                            ></div>
                            <span
                                className="font-bold uppercase tracking-widest text-sm"
                                style={{ color: primaryColor || 'var(--primary)' }}
                            >
                                Exclusive Listings
                            </span>
                        </div>
                        <h2 className="font-heading text-3xl md:text-4xl font-extrabold text-foreground">
                            Featured Properties
                        </h2>
                    </div>
                    <Link
                        href="/properties/search"
                        className="group flex items-center font-bold transition-colors hover:opacity-80"
                        style={{ color: primaryColor || 'var(--primary)' }}
                    >
                        View All Inventory
                        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {properties.map((property, index) => (
                        <motion.div
                            key={property.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: index * 0.1 }}
                            viewport={{ once: true }}
                        >
                            <Link href={`/properties/${property.slug}`}>
                                <Card className="group overflow-hidden border-0 bg-white shadow-lg hover:shadow-2xl transition-all duration-300 h-full rounded-sm">
                                    <div className="relative aspect-[4/3] overflow-hidden">
                                        {/* Image */}
                                        <div className="w-full h-full relative">
                                            {property.images && property.images[0] ? (
                                                <Image
                                                    src={property.images[0]}
                                                    alt={property.title}
                                                    fill
                                                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                                                    <span className="text-gray-400">No Image</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Top Left Badge */}
                                        <div className="absolute top-4 left-4">
                                            <Badge
                                                className="text-white hover:bg-opacity-90 rounded-sm border-0 uppercase tracking-wider text-[0.65rem] font-bold px-3 py-1.5 shadow-md"
                                                style={{ backgroundColor: primaryColor || 'var(--primary)' }}
                                            >
                                                {property.status || property.goal || 'FOR SALE'}
                                            </Badge>
                                        </div>

                                        {/* Gradient Overlay */}
                                        <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/60 to-transparent opacity-60" />

                                        {/* Price Overlay */}
                                        <div className="absolute bottom-4 left-4 text-white font-bold text-lg">
                                            {property.price ? `€${property.price.toLocaleString()}` : "Price upon request"}
                                        </div>
                                    </div>

                                    <CardContent className="p-6">
                                        <div
                                            className="text-xs font-bold uppercase tracking-wider mb-2"
                                            style={{ color: primaryColor ? `${primaryColor}CC` : 'var(--primary)' }} // 80% opacity equivalent
                                        >
                                            {property.type || "PROPERTY"}
                                        </div>
                                        <h3 className="font-heading text-lg font-bold text-foreground mb-2 line-clamp-1 group-hover:text-primary transition-colors">
                                            {property.title}
                                        </h3>
                                        <p className="text-muted-foreground text-sm font-medium mb-5">
                                            {[property.city, property.addressLine1].filter(Boolean).join(", ")}
                                        </p>

                                        <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
                                            <div className="flex flex-col items-center justify-center p-2 bg-secondary/50 rounded-sm">
                                                <Bed className="h-4 w-4 mb-1" style={{ color: primaryColor || 'var(--primary)' }} />
                                                <span className="text-xs font-bold text-foreground">{property.bedrooms || 0} Beds</span>
                                            </div>
                                            <div className="flex flex-col items-center justify-center p-2 bg-secondary/50 rounded-sm">
                                                <Bath className="h-4 w-4 mb-1" style={{ color: primaryColor || 'var(--primary)' }} />
                                                <span className="text-xs font-bold text-foreground">{property.bathrooms || 0} Baths</span>
                                            </div>
                                            <div className="flex flex-col items-center justify-center p-2 bg-secondary/50 rounded-sm">
                                                <Maximize className="h-4 w-4 mb-1" style={{ color: primaryColor || 'var(--primary)' }} />
                                                <span className="text-xs font-bold text-foreground">{property.areaSqm || 0}m²</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        </motion.div>
                    ))}
                </div>
            </div>
        </motion.section>
    );
}
