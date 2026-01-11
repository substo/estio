"use client";

import { useState } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { Property } from "@prisma/client";
import { submitSwipe } from "../../actions";
import { X, Heart, Meh } from "lucide-react";

interface SwipeDeckProps {
    properties: Property[];
    contactId?: string;
    locationId: string;
    primaryColor?: string;
}

export default function SwipeDeck({ properties: initialProperties, contactId, locationId, primaryColor = "#000000" }: SwipeDeckProps) {
    const [properties, setProperties] = useState(initialProperties);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [exitX, setExitX] = useState<number | null>(null);

    const x = useMotionValue(0);
    const rotate = useTransform(x, [-200, 200], [-30, 30]);
    const opacity = useTransform(x, [-200, -100, 0, 100, 200], [0.5, 1, 1, 1, 0.5]);

    // Color indicators based on swipe direction
    const heartOpacity = useTransform(x, [0, 100], [0, 1]);
    const crossOpacity = useTransform(x, [-100, 0], [1, 0]);

    const currentProperty = properties[currentIndex];

    const handleDragEnd = async (event: any, info: PanInfo) => {
        if (info.offset.x > 100) {
            setExitX(200);
            await handleSwipe("INTERESTED");
        } else if (info.offset.x < -100) {
            setExitX(-200);
            await handleSwipe("NOT");
        } else if (info.offset.y < -100) {
            // Swipe up for MAYBE? Or just keep left/right for now.
            // Let's stick to Left/Right for simplicity first, or add buttons.
            // User asked for "Swipe feature", usually left/right.
            // But model has "MAYBE". Let's handle MAYBE via button or Up swipe.
            // Let's add a button for MAYBE.
        }
    };

    const handleSwipe = async (choice: "INTERESTED" | "MAYBE" | "NOT") => {
        if (!currentProperty) return;

        // Optimistic update
        const propertyId = currentProperty.id;

        // Remove current card
        setTimeout(() => {
            setCurrentIndex((prev) => prev + 1);
            setExitX(null);
            x.set(0);
        }, 200);

        try {
            await submitSwipe({
                propertyId,
                choice,
                contactId,
            });
        } catch (error) {
            console.error("Failed to submit swipe:", error);
            // Ideally revert state, but for swiping it's usually fine to ignore errors or show toast
        }
    };

    if (!currentProperty) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <h2 className="text-2xl font-bold mb-4">No more properties!</h2>
                <p className="text-gray-500">Check back later for new listings.</p>
            </div>
        );
    }

    return (
        <div className="relative w-full max-w-md mx-auto h-[600px] flex flex-col items-center justify-center">
            <div className="relative w-full h-full">
                {/* Next Card (Background) */}
                {properties[currentIndex + 1] && (
                    <Card property={properties[currentIndex + 1]} index={currentIndex + 1} />
                )}

                {/* Current Card (Foreground) */}
                <motion.div
                    style={{ x, rotate, opacity, zIndex: 10 }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    onDragEnd={handleDragEnd}
                    animate={exitX !== null ? { x: exitX, opacity: 0 } : { x: 0, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-0 left-0 w-full h-full"
                >
                    <Card property={currentProperty} index={currentIndex} />

                    {/* Overlay Indicators */}
                    <motion.div style={{ opacity: heartOpacity }} className="absolute top-8 left-8 z-20 transform -rotate-12 border-4 border-green-500 rounded-lg p-2">
                        <span className="text-4xl font-bold text-green-500 uppercase">LIKE</span>
                    </motion.div>
                    <motion.div style={{ opacity: crossOpacity }} className="absolute top-8 right-8 z-20 transform rotate-12 border-4 border-red-500 rounded-lg p-2">
                        <span className="text-4xl font-bold text-red-500 uppercase">NOPE</span>
                    </motion.div>
                </motion.div>
            </div>

            {/* Controls */}
            <div className="flex gap-6 mt-8">
                <button
                    onClick={() => { setExitX(-200); handleSwipe("NOT"); }}
                    className="p-4 bg-white rounded-full shadow-lg text-red-500 hover:bg-red-50 transition-colors"
                >
                    <X size={32} />
                </button>
                <button
                    onClick={() => { handleSwipe("MAYBE"); setCurrentIndex(prev => prev + 1); }}
                    className="p-4 bg-white rounded-full shadow-lg text-yellow-500 hover:bg-yellow-50 transition-colors"
                >
                    <Meh size={32} />
                </button>
                <button
                    onClick={() => { setExitX(200); handleSwipe("INTERESTED"); }}
                    className="p-4 bg-white rounded-full shadow-lg text-green-500 hover:bg-green-50 transition-colors"
                >
                    <Heart size={32} fill="currentColor" />
                </button>
            </div>
        </div>
    );
}

function Card({ property, index }: { property: Property; index: number }) {
    const imageUrl = (property as any).media?.[0]?.url || "/placeholder.jpg";

    return (
        <div className="w-full h-full bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 flex flex-col absolute top-0 left-0">
            <div className="relative h-3/4 bg-gray-200">
                <img
                    src={imageUrl}
                    alt={property.title}
                    className="w-full h-full object-cover pointer-events-none"
                />
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/60 to-transparent p-6 pt-20">
                    <h2 className="text-white text-2xl font-bold truncate">{property.title}</h2>
                    <p className="text-white/90">{property.city}</p>
                </div>
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between">
                <div className="flex justify-between items-end">
                    <div>
                        <p className="text-gray-500 text-sm">Price</p>
                        <p className="text-2xl font-bold text-gray-900">
                            {property.currency} {property.price?.toLocaleString()}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="flex gap-3 text-sm text-gray-600">
                            <span>{property.bedrooms} Beds</span>
                            <span>{property.bathrooms} Baths</span>
                            <span>{property.areaSqm} m²</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
