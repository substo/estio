"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface TrustedPartnerSectionProps {
    primaryColor?: string;
    brandName?: string;
}

export function TrustedPartnerSection({ primaryColor, brandName }: TrustedPartnerSectionProps) {
    const brand = brandName || "Down Town Cyprus";
    const primaryStyle = { backgroundColor: primaryColor || 'var(--primary)' };
    const textPrimaryStyle = { color: primaryColor || 'var(--primary)' };
    const lightPrimaryStyle = { backgroundColor: primaryColor ? `${primaryColor}1A` : 'var(--primary-foreground)' }; // 10% opacity

    const features = [
        "Market Analysis",
        "Legal Assistance",
        "Property Management",
        "Investment Consulting",
    ];

    return (
        <section className="py-24 bg-white">
            <div className="container mx-auto px-4 md:px-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                    {/* Image Grid */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                        className="relative"
                    >
                        {/* Main Image */}
                        <div className="relative z-10 aspect-[4/3] overflow-hidden rounded-sm shadow-2xl border-8 border-white">
                            <Image
                                src="https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80" // Generic detailed generic architecture/hotel image
                                alt="Luxury Property"
                                fill
                                className="object-cover"
                            />
                        </div>

                        {/* Decorative Solid Box (Bottom Right) */}
                        <div
                            className="absolute -bottom-6 -right-6 w-full h-full z-0 rounded-sm opacity-10"
                            style={primaryStyle}
                        />

                        {/* Stats Box (Top Left) */}
                        <div
                            className="absolute -top-6 -left-6 w-32 h-32 z-20 rounded-sm flex items-center justify-center p-4 shadow-lg"
                            style={primaryStyle}
                        >
                            <div className="text-center">
                                <span className="block text-3xl font-extrabold text-white">
                                    15+
                                </span>
                                <span className="block text-xs font-bold text-white/90 uppercase tracking-wider">
                                    Years Exp.
                                </span>
                            </div>
                        </div>
                    </motion.div>

                    {/* Content */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                    >
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-1 w-10 rounded-full" style={primaryStyle}></div>
                            <span className="font-bold uppercase tracking-widest text-sm" style={textPrimaryStyle}>
                                Why Choose Us
                            </span>
                        </div>

                        <h2 className="font-heading text-4xl md:text-5xl font-extrabold text-foreground mb-6 leading-tight">
                            Your Trusted Partner <br />
                            in Cyprus Real Estate.
                        </h2>
                        <p className="text-muted-foreground text-lg mb-8 leading-relaxed font-medium">
                            At {brand}, we combine local market dominance with
                            international standards. Whether you are buying your dream home or
                            investing in high-yield developments, we provide the expertise and
                            transparency you deserve.
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 mb-10">
                            {features.map((item) => (
                                <div key={item} className="flex items-center gap-3">
                                    <div
                                        className="h-6 w-6 rounded-full flex items-center justify-center shrink-0"
                                        style={{ backgroundColor: primaryColor ? `${primaryColor}1A` : '#f3f4f6' }} // Light Bg
                                    >
                                        <Check
                                            className="h-3.5 w-3.5 stroke-[3]"
                                            style={textPrimaryStyle}
                                        />
                                    </div>
                                    <span className="text-foreground font-bold">{item}</span>
                                </div>
                            ))}
                        </div>

                        <Link href="/about">
                            <Button
                                size="lg"
                                className="rounded-sm px-8 h-12 bg-foreground text-white hover:bg-foreground/90 uppercase tracking-wider font-bold"
                            >
                                About Our Company <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
