"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight, ShieldCheck, Building2, TrendingUp, Award } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

// --- HELPER: MERGE TAG REPLACEMENT ---
// Providing a local version or importing from renderer if possible. 
// For simplicity in a standalone component, I'll repeat a simple version or accept processed text.
function replaceMergeTags(text: string, siteConfig: any): string {
    if (!text || typeof text !== "string") return text;
    const contact = siteConfig?.contactInfo || {};
    let result = text;
    result = result.replace(/{{company_name}}/g, siteConfig?.name || "Our Company");
    result = result.replace(/{{company_email}}/g, contact.email || "info@example.com");
    result = result.replace(/{{company_phone}}/g, contact.mobile || contact.phone || "N/A");
    result = result.replace(/{{company_address}}/g, contact.address || "Main Office");
    return result;
}

interface FeatureSectionProps {
    block: any;
    index: number;
    siteConfig?: any;
}

export function FeatureSection({ block, index, siteConfig }: FeatureSectionProps) {
    // --- PROPS & CONFIG ---
    const layout = block.layout || "split-left"; // split-left (text left, image right) or split-right (text right, image left)
    const isImageRight = layout === "split-left"; // Standard: Text Left, Image Right

    // Theme Colors (fallbacks)
    const primaryColor = siteConfig?.theme?.primaryColor || "var(--primary)";
    const primaryStyle = { backgroundColor: block.styles?.backgroundColor || primaryColor };
    const textPrimaryStyle = { color: block.styles?.textColor || primaryColor };

    // --- CONTENT PARSING ---
    const supertitle = replaceMergeTags(block.supertitle || block.badge, siteConfig);
    const title = replaceMergeTags(block.title, siteConfig);
    const description = replaceMergeTags(block.description || block.subtext, siteConfig);

    return (
        <section className={cn("py-24 bg-white overflow-hidden", block.styles?.backgroundColor ? "" : "bg-white")} style={block.styles?.backgroundColor ? { backgroundColor: block.styles.backgroundColor } : {}}>
            <div className="container mx-auto px-4 md:px-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

                    {/* --- TEXT CONTENT --- */}
                    <motion.div
                        initial={{ opacity: 0, x: isImageRight ? -20 : 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                        className={cn(isImageRight ? "order-1" : "order-2 lg:order-2")}
                    >
                        {/* Supertitle / Badge */}
                        {supertitle && (
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    {/* Try to infer icon from logic or hardcode for now */}
                                    <ShieldCheck className="h-5 w-5 text-primary" />
                                </div>
                                <span className="text-primary font-bold uppercase tracking-widest text-sm">
                                    {supertitle}
                                </span>
                            </div>
                        )}

                        {/* Heading */}
                        <h2 className="font-heading text-3xl md:text-4xl font-extrabold text-foreground mb-6 leading-tight">
                            <span dangerouslySetInnerHTML={{ __html: title }} />
                        </h2>

                        {/* Description (Prose) */}
                        <div className="prose prose-lg text-muted-foreground mb-6">
                            <div dangerouslySetInnerHTML={{ __html: description }} />
                        </div>

                        {/* Extra Content: Badges (Reg/Lic) */}
                        {block.badges && block.badges.length > 0 && (
                            <div className="mt-8 flex gap-4">
                                {block.badges.map((badge: any, i: number) => (
                                    <div key={i} className="flex flex-col p-4 bg-secondary/30 border border-border rounded-sm">
                                        <span className="font-bold text-foreground">{badge.title}</span>
                                        <span className="text-xs text-muted-foreground uppercase">{badge.subtitle}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Extra Content: Features List (Checkmarks) */}
                        {block.features && block.features.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 mb-10 mt-6">
                                {block.features.map((item: string, i: number) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <Check className="text-primary h-3.5 w-3.5 stroke-[3]" />
                                        </div>
                                        <span className="text-foreground font-bold">{item}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* CTA Button */}
                        {block.ctaText && (
                            <Button className="mt-8 bg-primary text-white font-bold uppercase tracking-wider rounded-sm px-8" asChild>
                                <Link href={block.ctaLink || "#"}>
                                    {block.ctaText}
                                </Link>
                            </Button>
                        )}
                    </motion.div>

                    {/* --- IMAGE / MEDIA --- */}
                    <motion.div
                        initial={{ opacity: 0, x: isImageRight ? 20 : -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className={cn("relative", isImageRight ? "order-2" : "order-1 lg:order-1")}
                    >
                        {/* Main Image */}
                        <div className="relative z-10 aspect-[4/5] w-[90%] overflow-hidden rounded-sm shadow-2xl">
                            {block.image ? (
                                <img
                                    src={block.image}
                                    alt={title.replace(/<[^>]*>?/gm, "")}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full bg-slate-200 flex items-center justify-center">Image Placeholder</div>
                            )}
                        </div>

                        {/* Decorative Background (Bottom Right or Top Left depending on style) */}
                        {/* We can make this conditional or standard. Prototype uses it on bottom-right for Section 1, top-left overlay for Section 2. */}
                        <div className="absolute -bottom-6 -right-6 w-2/3 h-2/3 bg-primary/5 z-0 rounded-sm" />

                        {/* Overlay Card (e.g. Stats, Quote, Prime Locations) */}
                        {block.overlay && (
                            <div
                                className={cn(
                                    "absolute z-20 rounded-sm shadow-lg flex items-center justify-center p-4",
                                    block.overlay.position === "top-left" ? "-top-6 -left-6" :
                                        block.overlay.position === "center-right" ? "top-1/2 -right-8 md:-right-12 transform -translate-y-1/2 text-left items-start p-8 md:p-10 max-w-sm" :
                                            "-top-6 -left-6" // default
                                )}
                                style={{
                                    backgroundColor: block.overlay.style === 'primary' ? 'hsl(var(--primary))' : 'white',
                                    color: block.overlay.style === 'primary' ? 'hsl(var(--primary-foreground))' : 'inherit',
                                    width: block.overlay.width || 'auto',
                                    height: block.overlay.height || 'auto',
                                }}
                            >
                                <div className="text-left">
                                    {block.overlay.icon && <Award className="h-10 w-10 mb-4 text-current" />}
                                    {block.overlay.title && (
                                        <span className="block text-xs font-bold uppercase tracking-wider mb-1">
                                            <span dangerouslySetInnerHTML={{ __html: block.overlay.title }} />
                                        </span>
                                    )}
                                    {block.overlay.text && (
                                        <p className="font-bold text-lg leading-relaxed p-2">
                                            {block.overlay.text}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
