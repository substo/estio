"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { SurveyFilter } from "./survey-filter";
import { getFilterCountAction } from "@/app/actions/public-actions";

interface HeroSectionProps {
    siteConfig: any;
}

export { HeroSection as PublicHero };
export function HeroSection({ siteConfig }: HeroSectionProps) {
    const hero = siteConfig?.heroContent || {};
    const backgroundImage = hero.backgroundImage || "https://utfs.io/f/8a428f85-ae83-4ca7-9237-6f8b65411293-eun6ii.png";
    const headline = hero.headline || "Find Your Dream Home";
    const subheadline = hero.subheadline || "Discover the finest properties in the area.";
    const primaryColor = siteConfig?.theme?.primaryColor;
    const locationId = siteConfig?.locationId;

    return (
        <motion.div
            layout
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            className="relative min-h-screen w-full flex flex-col items-center justify-start overflow-hidden"
        >
            {/* Background Image */}
            {/* Background Image - Oversized and static to prevent re-cropping jumps */}
            <div className="absolute top-0 left-0 w-full h-[120vh] z-0">
                <Image
                    src={backgroundImage}
                    alt="Hero Background"
                    fill
                    className="object-cover object-top"
                    priority
                />

                {/* Gradient Overlay */}
                <div
                    className="absolute inset-0 mix-blend-multiply"
                    style={{
                        background: primaryColor
                            ? `linear-gradient(to right, ${primaryColor}66, black)`
                            : 'linear-gradient(to right, rgba(0,0,0,0.4), black)'
                    }}
                />
                <div className="absolute inset-0 bg-black/20" />
            </div>

            {/* Content */}
            <div className="relative z-10 container mx-auto px-4 md:px-6 pt-24 md:pt-32 pb-20 flex flex-col items-center">
                <div className="max-w-4xl mx-auto flex flex-col items-center text-center text-white mb-12">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                        className="font-heading font-extrabold text-5xl md:text-7xl lg:text-8xl mb-6 leading-none tracking-tight uppercase drop-shadow-xl"
                    >
                        {headline}
                    </motion.h1>

                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className="w-full max-w-2xl"
                    >
                        <p
                            className="text-lg md:text-xl text-white/90 font-medium tracking-wide border-l-4 pl-6 text-left bg-black/30 py-4 backdrop-blur-sm shadow-lg rounded-r-sm"
                            style={{ borderColor: primaryColor || 'white' }}
                        >
                            {subheadline}
                        </p>
                    </motion.div>
                </div>

                {/* Survey Filter */}
                <div className="w-full max-w-5xl">
                    <SurveyFilter
                        locationId={locationId}
                        primaryColor={primaryColor}
                        getFilterCountAction={getFilterCountAction}
                    />
                </div>
            </div>
        </motion.div>
    );
}
