"use client";

import { motion } from "framer-motion";
import { PropertyCard } from "@/components/public/property-card";

interface SearchResultsGridProps {
    properties: any[];
    domain: string;
    emptyTitle?: string;
    emptyBody?: string;
}

export function SearchResultsGrid({ properties, domain, emptyTitle, emptyBody }: SearchResultsGridProps) {
    if (properties.length === 0) {
        return (
            <div className="text-center py-20 bg-gray-50 rounded-lg">
                <h2 className="text-xl font-semibold">{emptyTitle || "No properties found"}</h2>
                <p className="text-gray-500">{emptyBody || "Try adjusting your search criteria."}</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {properties.map((prop, index) => (
                <motion.div
                    key={prop.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    viewport={{ once: true }}
                >
                    <PropertyCard
                        property={prop}
                        domain={domain}
                    />
                </motion.div>
            ))}
        </div>
    );
}
