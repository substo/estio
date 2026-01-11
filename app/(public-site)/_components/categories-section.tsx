"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface CategoryData {
    count: number;
    image: string | null;
}

interface CategoriesProps {
    data: {
        type: 'static';
        data: {
            newVillas: CategoryData;
            resaleVillas: CategoryData;
            resaleApartments: CategoryData;
            newApartments: CategoryData;
            commercial: CategoryData;
            land: CategoryData;
            rentals: CategoryData;
        };
    } | {
        type: 'dynamic';
        items: {
            title: string;
            count: number;
            image: string | null;
            filter?: any;
        }[];
    };
    title?: string;
    primaryColor?: string;
}

const CategoryTile = ({
    title,
    count,
    label,
    image,
    href,
    className,
    primaryColor
}: {
    title: string;
    count: number;
    label: string;
    image: string | null;
    href: string;
    className?: string;
    primaryColor?: string;
}) => {
    return (
        <Link href={href} className={cn("group block relative overflow-hidden rounded-sm shadow-lg hover:shadow-xl transition-all duration-300 h-[250px]", className)}>
            {/* Background Image */}
            <div className="absolute inset-0 bg-slate-200">
                {image ? (
                    <img
                        src={image}
                        alt={title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                        {/* Fallback pattern or color */}
                        <div className="w-full h-full bg-slate-300" />
                    </div>
                )}
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/50 transition-colors duration-300" />
            </div>

            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white z-10 p-4">
                <h3 className="text-2xl font-bold uppercase tracking-wide mb-2 drop-shadow-md">
                    {title}
                </h3>
                <div className="text-sm font-medium tracking-widest opacity-90 uppercase">
                    {count} {label}
                </div>
            </div>
        </Link>
    );
};

export function CategoriesSection({ data, title, primaryColor }: CategoriesProps) {

    const sectionTitle = title || "What are you looking for?";

    // Render Dynamic Content
    if (data.type === 'dynamic') {
        return (
            <motion.section
                layout
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="py-20 bg-white"
            >
                <div className="container mx-auto px-4 max-w-7xl">
                    {/* Header */}
                    <div className="mx-auto max-w-3xl text-center mb-12">
                        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                            {sectionTitle}
                        </h2>
                    </div>

                    {/* Dynamic Flex Grid for centered/balanced items */}
                    <div className="flex flex-wrap justify-center gap-6">
                        {data.items.map((item, idx) => {
                            // Construct Href from filter
                            const params = new URLSearchParams();
                            if (item.filter?.type && item.filter.type !== 'any') params.set('type', item.filter.type);
                            if (item.filter?.condition && item.filter.condition !== 'any') params.set('condition', item.filter.condition);
                            if (item.filter?.status) params.set('status', item.filter.status);

                            const href = `/properties/search?${params.toString()}`;

                            // Label logic (simplified)
                            let label = "Properties";
                            if (item.title.toLowerCase().includes('villa')) label = "Villas";
                            else if (item.title.toLowerCase().includes('apartment')) label = "Apartments";
                            else if (item.title.toLowerCase().includes('land')) label = "Plots/Fields";

                            // Determine Width Class based on total count
                            const count = data.items.length;
                            let widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)]"; // Default: 3 per row

                            if (count === 1) {
                                widthClass = "w-full max-w-2xl text-center";
                            }
                            else if (count === 2) {
                                widthClass = "w-full md:w-[calc(50%-12px)]";
                            }
                            else if (count === 7) {
                                // Creative Layout for 7 items (Max 3 per row)
                                // Row 1 (Items 0-1): 2 Items [40% - 60%]
                                // Row 2 (Items 2-4): 3 Items [25% - 50% - 25%]
                                // Row 3 (Items 5-6): 2 Items [60% - 40%]

                                if (idx < 2) {
                                    // Row 1
                                    if (idx === 0) widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(40%-12px)]";
                                    else widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(60%-12px)]";
                                }
                                else if (idx < 5) {
                                    // Row 2 (Indicies 2, 3, 4)
                                    if (idx === 3) widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(50%-16px)]"; // Middle (Large)
                                    else widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(25%-16px)]"; // Sides (Small)
                                }
                                else {
                                    // Row 3 (Indicies 5, 6)
                                    if (idx === 5) widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(60%-12px)]";
                                    else widthClass = "w-full md:w-[calc(50%-12px)] lg:w-[calc(40%-12px)]";
                                }
                            }
                            else if (count % 4 === 0) {
                                // 4, 8, 12 items: 2 per row (50%) to strictly follow "2 or 3" rule (avoiding 4)
                                widthClass = "w-full md:w-[calc(50%-12px)]";
                            }

                            return (
                                <CategoryTile
                                    key={idx}
                                    title={item.title}
                                    count={item.count}
                                    label={label}
                                    image={item.image}
                                    href={href}
                                    primaryColor={primaryColor}
                                    className={widthClass}
                                />
                            );
                        })}
                    </div>
                </div>
            </motion.section>
        );
    }

    // Render Legacy/Static Content (The original hardcoded layout)
    const staticData = data.data;

    return (
        <motion.section
            layout
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            className="py-20 bg-white"
        >
            <div className="container mx-auto px-4 max-w-7xl">

                {/* Header */}
                <div className="mx-auto max-w-3xl text-center mb-16">
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                        {sectionTitle}
                    </h2>
                </div>

                {/* Grid Layout - Matching the provided screenshot layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 mb-6">
                    {/* Row 1: New Villas & Resale Villas */}
                    <CategoryTile
                        title="New Build Villas"
                        count={staticData.newVillas.count}
                        label="Villas"
                        image={staticData.newVillas.image}
                        href="/properties/search?type=villa&condition=new"
                        primaryColor={primaryColor}
                    />
                    <CategoryTile
                        title="Resale Villas"
                        count={staticData.resaleVillas.count}
                        label="Villas"
                        image={staticData.resaleVillas.image}
                        href="/properties/search?type=villa&condition=resale"
                        primaryColor={primaryColor}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 mb-6">
                    {/* Row 2: Resale Apartments & New Build Apartments */}
                    <CategoryTile
                        title="Resale Apartments"
                        count={staticData.resaleApartments.count}
                        label="Apartments"
                        image={staticData.resaleApartments.image}
                        href="/properties/search?type=apartment&condition=resale"
                        primaryColor={primaryColor}
                    />
                    <CategoryTile
                        title="New Build Apartments"
                        count={staticData.newApartments.count}
                        label="Apartments"
                        image={staticData.newApartments.image}
                        href="/properties/search?type=apartment&condition=new"
                        primaryColor={primaryColor}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Row 3: Commercial, Land, Rentals */}
                    <CategoryTile
                        title="Commercial"
                        count={staticData.commercial.count}
                        label="Properties"
                        image={staticData.commercial.image}
                        href="/properties/search?type=commercial"
                        primaryColor={primaryColor}
                    />
                    <CategoryTile
                        title="Land"
                        count={staticData.land.count}
                        label="Plots/Fields"
                        image={staticData.land.image}
                        href="/properties/search?type=land"
                        primaryColor={primaryColor}
                    />
                    <CategoryTile
                        title="Rentals"
                        count={staticData.rentals.count}
                        label="Properties"
                        image={staticData.rentals.image}
                        href="/properties/search?status=rent"
                        primaryColor={primaryColor}
                    />
                </div>

            </div>
        </motion.section>
    );
}
