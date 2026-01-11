"use client";

import { motion } from "framer-motion";
import * as LucideIcons from "lucide-react";
import { ArrowRight, Check, Star } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FeatureSection } from "../[domain]/_components/feature-section";

// --- ANIMATION VARIANTS ---
const animations = {
    none: {},
    "fade-up": {
        hidden: { opacity: 0, y: 30 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.6, staggerChildren: 0.1 }
        }
    },
    "fade-in": {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { duration: 0.8, staggerChildren: 0.2, delayChildren: 0.1 }
        }
    },
    "zoom-in": { hidden: { opacity: 0, scale: 0.95 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.5 } } },
    "slide-right": { hidden: { opacity: 0, x: -50 }, visible: { opacity: 1, x: 0, transition: { duration: 0.6 } } },
};

const childVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
};

// --- THEMES ---
const themes: Record<string, string> = {
    light: "bg-white text-slate-900",
    dark: "bg-slate-900 text-white",
    "blue-gradient": "bg-gradient-to-br from-blue-600 to-indigo-700 text-white", // Keeping strict blue for now
    "brand-solid": "bg-primary text-primary-foreground",
};

interface BlockProps {
    block: any;
    index: number;
    siteConfig?: any;
}

// --- HELPER: MERGE TAG REPLACEMENT ---
function replaceMergeTags(text: string, siteConfig: any): string {
    if (!text || typeof text !== "string") return text;
    const contact = siteConfig?.contactInfo || {};
    let result = text;
    result = result.replace(/{{company_name}}/g, siteConfig?.name || "Our Company");
    result = result.replace(/{{company_email}}/g, contact.email || "info@example.com");
    result = result.replace(/{{company_phone}}/g, contact.mobile || contact.phone || "N/A");
    result = result.replace(/{{company_address}}/g, contact.address || "Main Office");
    result = result.replace(/{{company_domain}}/g, siteConfig?.domain || "");
    return result;
}

// --- HELPER: DYNAMIC ICON ---
function IconRenderer({ iconName, className }: { iconName: string; className?: string }) {
    if (!iconName) return <Star className={className} />;

    // Normalize: "handshake" -> "Handshake"
    // Handle kebab-case: "chart-line" -> "ChartLine"
    const pascalCase = iconName.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');

    // @ts-ignore - Dynamic access to Lucide icons
    const IconComponent = LucideIcons[pascalCase] || LucideIcons[iconName] || LucideIcons.Star;

    return <IconComponent className={className} />;
}

// --- HELPER: HTML CONTENT RENDERER ---
const RenderContent = ({ text, siteConfig, className }: { text: string; siteConfig?: any; className?: string }) => {
    if (!text) return null;
    let html = replaceMergeTags(text, siteConfig);

    // Tiptap (WYSIWYG) often wraps inline content in <p>.
    // If we're rendering inside an H1/H2/Span, we should strip the outer <p> to avoid invalid HTML and layout issues.
    if (html.startsWith("<p>") && html.endsWith("</p>")) {
        html = html.substring(3, html.length - 4);
    }

    return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};

// --- BLOCKS ---

function HeroBlock({ block, index, siteConfig }: BlockProps) {
    const isDark = block.theme === "dark" || block.theme?.includes("gradient") || block.theme === "brand-solid";

    // Determine Semantic Heading Level - H1 only for the first block!
    const HeadingTag = index === 0 ? motion.h1 : motion.h2;

    // Layout Logic
    const layout = block.layout || "full-width";
    const isSplit = layout === "split-left" || layout === "split-right";
    const imageOrder = layout === "split-right" ? "order-first lg:order-last" : "order-first";

    if (isSplit) {
        return (
            <div className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
                <div className="mx-auto max-w-7xl px-6 lg:px-8">
                    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-12 gap-y-16 lg:mx-0 lg:max-w-none lg:grid-cols-2 lg:items-center">

                        {/* Text Column */}
                        <div className={cn("lg:pr-8 lg:pt-4", layout === "split-right" ? "lg:order-first" : "lg:order-last")}>
                            <div className="lg:max-w-lg">
                                {/* Badge / Kicker */}
                                {block.badge && (
                                    <motion.div variants={childVariants} className="mb-6 inline-flex items-center gap-2">
                                        <div className="h-1 w-12 bg-primary rounded-full"></div>
                                        <span className="text-primary font-bold uppercase tracking-widest text-xs">{block.badge}</span>
                                    </motion.div>
                                )}

                                <HeadingTag variants={childVariants} className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl leading-tight text-slate-900">
                                    <RenderContent text={block.headline} siteConfig={siteConfig} />
                                </HeadingTag>
                                <motion.div variants={childVariants} className={cn("mt-6 text-lg leading-8", isDark ? "text-gray-300" : "text-slate-600")}>
                                    <RenderContent text={block.subheadline} siteConfig={siteConfig} />
                                </motion.div>
                                {block.ctaText && (
                                    <motion.div variants={childVariants} className="mt-8 flex items-center gap-x-6">
                                        <Button
                                            asChild
                                            size="lg"
                                            className={cn("rounded-sm font-bold tracking-wide uppercase px-8 h-12", isDark
                                                ? "bg-white text-slate-900 hover:bg-gray-100"
                                                : "bg-primary text-primary-foreground hover:bg-primary/90")}
                                        >
                                            <Link href={block.ctaLink || "#"}>{replaceMergeTags(block.ctaText, siteConfig)}</Link>
                                        </Button>
                                    </motion.div>
                                )}

                                {/* Hero Stats (New) */}
                                {block.stats && block.stats.length > 0 && (
                                    <motion.div variants={childVariants} className="mt-10 pt-10 border-t border-slate-200 flex gap-8">
                                        {block.stats.map((stat: any, i: number) => (
                                            <div key={i} className="flex flex-col">
                                                <span className="text-3xl font-extrabold text-primary">{stat.value}</span>
                                                <span className="text-sm font-bold text-muted-foreground uppercase">{stat.label}</span>
                                            </div>
                                        ))}
                                    </motion.div>
                                )}
                            </div>
                        </div>

                        {/* Image Column */}
                        <motion.div variants={childVariants} className={cn("relative", layout === "split-right" ? "lg:order-last" : "lg:order-first")}>
                            {block.image && (
                                <div className="relative rounded-sm overflow-hidden shadow-2xl bg-gray-100 aspect-[4/3] lg:aspect-auto lg:h-[500px] group">
                                    <img
                                        src={block.image}
                                        alt={block.badge || "Hero Image"}
                                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 ring-1 ring-inset ring-black/10 rounded-sm" />

                                    {/* Overlay Card (New) */}
                                    {block.overlayCard && (
                                        <div className="absolute bottom-6 left-6 bg-primary text-primary-foreground p-6 rounded-sm shadow-lg max-w-[200px]">
                                            <div className="font-bold text-center leading-tight whitespace-pre-line">
                                                <RenderContent text={block.overlayCard} siteConfig={siteConfig} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </div>
                </div>
            </div>
        );
    }

    // Default Full Width Hero
    return (
        <div className="relative isolate overflow-hidden pt-32 pb-16 sm:pb-32 min-h-[60vh] flex items-center">
            {(block.backgroundImage || block.image) && (
                <div className="absolute inset-0 -z-10 h-full w-full object-cover">
                    <img src={block.backgroundImage || block.image} alt="Hero Background" className="h-full w-full object-cover opacity-50" />
                    <div className={cn("absolute inset-0", isDark ? "bg-black/60" : "bg-white/40")} />
                </div>
            )}

            <div className="mx-auto max-w-7xl px-6 lg:px-8 relative z-10">
                <div className={cn("max-w-3xl", block.alignment === "center" ? "mx-auto text-center" : "")}>
                    {/* Badge / Kicker (Centered version) */}
                    {block.badge ? (
                        <motion.div variants={childVariants} className="flex justify-center items-center gap-3 mb-8">
                            <div className="h-0.5 w-12 bg-primary/80"></div>
                            <span className="text-primary font-bold uppercase tracking-[0.2em] text-sm">{block.badge}</span>
                            <div className="h-0.5 w-12 bg-primary/80"></div>
                        </motion.div>
                    ) : (index === 0 && (
                        <motion.div variants={childVariants} className="flex justify-center gap-2 mb-6 opacity-80">
                            <span className="h-px w-12 bg-current self-center"></span>
                            <span className="font-bold uppercase tracking-widest text-sm">Welcome</span>
                            <span className="h-px w-12 bg-current self-center"></span>
                        </motion.div>
                    ))}

                    <HeadingTag variants={childVariants} className="text-4xl font-extrabold tracking-tight sm:text-6xl mb-6 drop-shadow-sm leading-tight">
                        <RenderContent text={block.headline} siteConfig={siteConfig} />
                    </HeadingTag>

                    <motion.div variants={childVariants} className={cn("text-xl leading-relaxed mb-10 font-medium max-w-2xl mx-auto", isDark ? "text-slate-200" : "text-slate-700")}>
                        <RenderContent text={block.subheadline} siteConfig={siteConfig} />
                    </motion.div>

                    {block.ctaText && (
                        <motion.div variants={childVariants} className={cn("mt-10 flex items-center gap-x-6", block.alignment === "center" ? "justify-center" : "")}>
                            <Button
                                asChild
                                size="lg"
                                className={cn("rounded-sm px-10 h-14 text-base font-bold uppercase tracking-wider", isDark ? "bg-white text-slate-900 hover:bg-gray-100" : "bg-primary text-primary-foreground hover:bg-primary/90")}
                            >
                                <Link href={block.ctaLink || "#"}>{replaceMergeTags(block.ctaText, siteConfig)}</Link>
                            </Button>
                        </motion.div>
                    )}
                </div>
            </div>
        </div>
    );
}

function FeaturesBlock({ block, siteConfig }: BlockProps) {
    // If cards layout, use a distinct style
    const isCards = block.layout === "cards";

    return (
        <div className={cn("py-24 sm:py-32", isCards ? "bg-slate-50/50" : "")}>
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-3xl text-center mb-16">
                    {block.badge && (
                        <motion.span variants={childVariants} className="block text-primary font-bold uppercase tracking-widest text-xs mb-3">{block.badge}</motion.span>
                    )}
                    {block.title && (
                        <motion.h2 variants={childVariants} className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                            <RenderContent text={block.title} siteConfig={siteConfig} />
                        </motion.h2>
                    )}
                    {block.subtext && (
                        <motion.p variants={childVariants} className="mt-4 text-lg text-slate-600">
                            <RenderContent text={block.subtext} siteConfig={siteConfig} />
                        </motion.p>
                    )}
                </div>

                <div className={cn(
                    "grid gap-8",
                    block.columns === 3 ? "lg:grid-cols-3" : block.columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-2",
                    "md:grid-cols-2 grid-cols-1"
                )}>
                    {block.items?.map((feature: any, i: number) => (
                        <motion.div
                            key={i}
                            variants={childVariants}
                            className={cn(
                                "flex flex-col relative transition-all duration-300 group",
                                isCards ? "bg-white p-8 rounded-sm shadow-lg hover:shadow-xl hover:-translate-y-1 border-t-2 border-transparent hover:border-primary" : "pl-16"
                            )}
                        >
                            <div className={cn(
                                "flex items-center justify-center rounded-sm transition-colors duration-300",
                                isCards ? "h-14 w-14 bg-secondary text-primary mb-6 group-hover:bg-primary group-hover:text-primary-foreground" : "absolute left-0 top-1 flex h-10 w-10 items-center justify-center bg-primary rounded-lg text-primary-foreground"
                            )}>
                                <IconRenderer iconName={feature.icon} className="h-7 w-7" />
                            </div>
                            <dt className="text-xl font-bold leading-7 text-slate-900 mb-3">
                                <RenderContent text={feature.title} siteConfig={siteConfig} />
                            </dt>
                            <dd className="flex flex-auto flex-col text-base leading-relaxed text-slate-600">
                                <div className="flex-auto"><RenderContent text={feature.description} siteConfig={siteConfig} /></div>
                            </dd>
                        </motion.div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatsBlock({ block, siteConfig }: BlockProps) {
    return (
        <div className="bg-white py-24 sm:py-32 border-y border-slate-100">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <dl className="grid grid-cols-1 gap-x-8 gap-y-16 text-center lg:grid-cols-3">
                    {block.items?.map((stat: any, i: number) => (
                        <div key={i} className="mx-auto flex max-w-xs flex-col gap-y-2">
                            {/* Value first, huge and colored */}
                            <dd className="order-first text-5xl font-extrabold tracking-tight text-primary sm:text-6xl">
                                <RenderContent text={stat.value} siteConfig={siteConfig} />
                            </dd>
                            <dt className="text-sm leading-7 text-slate-500 uppercase tracking-[0.2em] font-bold mt-2">
                                <RenderContent text={stat.label} siteConfig={siteConfig} />
                            </dt>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}

function TextBlock({ block, siteConfig }: BlockProps) {
    const content = replaceMergeTags(block.htmlContent || "", siteConfig);
    return (
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12">
            <div className="prose prose-lg mx-auto dark:prose-invert" dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}

function CTABlock({ block, siteConfig }: BlockProps) {
    const hasImage = block.backgroundImage || block.image;

    return (
        <div className="relative isolate overflow-hidden bg-primary px-6 py-24 shadow-2xl sm:px-16 md:pt-24 lg:flex lg:gap-x-20 lg:px-24 lg:pt-0">
            {hasImage && (
                <div className="absolute inset-0 -z-10 h-full w-full object-cover">
                    <img src={block.backgroundImage || block.image} alt="CTA Background" className="h-full w-full object-cover opacity-20 mix-blend-multiply" />
                    <div className="absolute inset-0 bg-primary/90" />
                </div>
            )}
            <div className="mx-auto max-w-md text-center lg:mx-0 lg:flex-auto lg:py-32 lg:text-left">
                {block.badge && (
                    <span className="inline-block text-primary-foreground/80 font-bold uppercase tracking-widest text-xs mb-4">{block.badge}</span>
                )}
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    <RenderContent text={block.title} siteConfig={siteConfig} />
                </h2>
                <div className="mt-6 text-lg leading-8 text-primary-foreground/90">
                    <RenderContent text={block.subtext} siteConfig={siteConfig} />
                </div>
                {block.buttonText && (
                    <div className="mt-10 flex items-center justify-center gap-x-6 lg:justify-start">
                        <Button
                            asChild
                            variant="secondary"
                            size="lg"
                            className="bg-background text-primary hover:bg-background/90 font-bold uppercase tracking-wide h-14 px-8 rounded-sm"
                        >
                            <Link href={block.link || "#"}>{replaceMergeTags(block.buttonText, siteConfig)} <ArrowRight className="ml-2 w-4 h-4" /></Link>
                        </Button>

                        {/* Secondary CTA (New) */}
                        {block.secondaryCtaText && (
                            <Button
                                asChild
                                variant="outline"
                                size="lg"
                                className="bg-transparent border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary font-bold uppercase tracking-wide h-14 px-8 rounded-sm"
                            >
                                <Link href={block.secondaryCtaLink || "#"}>{replaceMergeTags(block.secondaryCtaText, siteConfig)}</Link>
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function FormBlock({ block, siteConfig }: BlockProps) {
    const cardBgColor = block.styles?.cardBackgroundColor || "white"; // Default to white if not set

    return (
        <div
            className="mx-auto max-w-xl px-4 py-16 sm:px-6 lg:px-8 shadow-2xl rounded-sm my-12 text-slate-900 ring-1 ring-slate-200"
            style={{ backgroundColor: cardBgColor }}
        >
            <div className="mx-auto max-w-xl text-center mb-8">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                    <RenderContent text={block.title || "Contact Us"} siteConfig={siteConfig} />
                </h2>
                <p className="mt-2 text-lg leading-8 text-gray-600">{replaceMergeTags(block.subtext, siteConfig)}</p>
            </div>

            <form className="mx-auto mt-4 max-w-xl sm:mt-8 space-y-6">
                <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
                    <div>
                        <label className="block text-sm font-semibold leading-6 text-gray-900">First name</label>
                        <input type="text" className="mt-2.5 block w-full rounded-sm border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6" />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold leading-6 text-gray-900">Last name</label>
                        <input type="text" className="mt-2.5 block w-full rounded-sm border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6" />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-sm font-semibold leading-6 text-gray-900">Email</label>
                        <input type="email" className="mt-2.5 block w-full rounded-sm border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6" />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-sm font-semibold leading-6 text-gray-900">Message</label>
                        <textarea rows={4} className="mt-2.5 block w-full rounded-sm border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6" />
                    </div>
                </div>
                <div className="mt-10">
                    <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-12 rounded-sm">
                        Submit
                    </Button>
                </div>
            </form>
        </div>
    )
}


function TestimonialsBlock({ block, siteConfig }: BlockProps) {
    return (
        <div className="py-24 sm:py-32 bg-slate-50">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-xl text-center">
                    <h2 className="text-lg font-semibold leading-8 tracking-tight text-primary">Testimonials</h2>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                        <RenderContent text={block.title || "What our clients say"} siteConfig={siteConfig} />
                    </p>
                </div>
                <div className="mx-auto mt-16 flow-root max-w-2xl sm:mt-20 lg:mx-0 lg:max-w-none">
                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                        {block.items?.map((item: any, i: number) => (
                            <div key={i} className="rounded-2xl bg-white p-6 shadow-xl ring-1 ring-gray-900/10 text-sm leading-6">
                                <blockquote className="text-gray-900">
                                    <p>{`“${replaceMergeTags(item.quote, siteConfig)}”`}</p>
                                </blockquote>
                                <div className="mt-6 flex items-center gap-x-4">
                                    <img className="h-10 w-10 rounded-full bg-gray-50" src={item.avatarUrl || "https://ui-avatars.com/api/?name=" + (item.author || "User")} alt="" />
                                    <div>
                                        <div className="font-semibold text-gray-900"><RenderContent text={item.author} siteConfig={siteConfig} /></div>
                                        <div className="text-gray-600">{replaceMergeTags(item.role, siteConfig)}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function PricingBlock({ block, siteConfig }: BlockProps) {
    return (
        <div className="py-24 sm:py-32">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-4xl text-center">
                    <h2 className="text-base font-semibold leading-7 text-primary">Pricing</h2>
                    <p className="mt-2 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                        <RenderContent text={block.title || "Choose your plan"} siteConfig={siteConfig} />
                    </p>
                </div>
                <div className="isolate mx-auto mt-16 grid max-w-md grid-cols-1 gap-y-8 sm:mt-20 lg:mx-0 lg:max-w-none lg:grid-cols-3 lg:gap-x-8">
                    {block.plans?.map((plan: any, i: number) => (
                        <div key={i} className={cn(
                            "rounded-3xl p-8 ring-1 ring-gray-200 xl:p-10 transition-all duration-300",
                            plan.isPopular ? "bg-gray-900 ring-gray-900 scale-105 shadow-2xl z-10" : "bg-white shadow-sm hover:shadow-lg"
                        )}>
                            <div className="flex items-center justify-between gap-x-4">
                                <h3 className={cn("text-lg font-semibold leading-8", plan.isPopular ? "text-white" : "text-gray-900")}>
                                    <RenderContent text={plan.name} siteConfig={siteConfig} />
                                </h3>
                                {plan.isPopular && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold leading-5 text-primary bg-white/20">Most popular</span>}
                            </div>
                            <p className="mt-4 flex items-baseline gap-x-2">
                                <span className={cn("text-4xl font-bold tracking-tight", plan.isPopular ? "text-white" : "text-gray-900")}>
                                    {plan.price}
                                </span>
                                <span className={cn("text-sm font-semibold leading-6", plan.isPopular ? "text-gray-400" : "text-gray-600")}>
                                    {plan.frequency}
                                </span>
                            </p>
                            <ul role="list" className={cn("mt-8 space-y-3 text-sm leading-6", plan.isPopular ? "text-gray-300" : "text-gray-600")}>
                                {plan.features?.map((feature: string, j: number) => (
                                    <li key={j} className="flex gap-x-3">
                                        <Check className={cn("h-6 w-5 flex-none", plan.isPopular ? "text-white" : "text-primary")} aria-hidden="true" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                            <a href="#" className={cn("mt-8 block rounded-md px-3 py-2 text-center text-sm font-semibold leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", plan.isPopular ? "bg-white text-gray-900 hover:bg-gray-100 focus-visible:outline-white" : "bg-primary text-white hover:bg-primary/90 focus-visible:outline-primary")}>
                                {plan.buttonText || "Get started"}
                            </a>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

function AccordionBlock({ block, siteConfig }: BlockProps) {
    return (
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-24 sm:py-32">
            <div className="mx-auto max-w-4xl divide-y divide-gray-900/10">
                <h2 className="text-2xl font-bold leading-10 tracking-tight text-gray-900">
                    <RenderContent text={block.title || "Frequently asked questions"} siteConfig={siteConfig} />
                </h2>
                <dl className="mt-10 space-y-6 divide-y divide-gray-900/10">
                    {block.items?.map((faq: any, i: number) => (
                        <div key={i} className="pt-6">
                            <details className="group">
                                <summary className="flex w-full items-start justify-between text-left text-gray-900 cursor-pointer list-none">
                                    <span className="text-base font-semibold leading-7">
                                        <RenderContent text={faq.trigger} siteConfig={siteConfig} />
                                    </span>
                                    <span className="ml-6 flex h-7 items-center">
                                        <LucideIcons.Plus className="h-6 w-6 group-open:hidden" />
                                        <LucideIcons.Minus className="h-6 w-6 hidden group-open:block" />
                                    </span>
                                </summary>
                                <div className="mt-2 pr-12">
                                    <p className="text-base leading-7 text-gray-600">
                                        <RenderContent text={faq.content} siteConfig={siteConfig} />
                                    </p>
                                </div>
                            </details>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    )
}

function GalleryBlock({ block, siteConfig }: BlockProps) {
    return (
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16">
            <div className="mx-auto max-w-2xl text-center mb-10">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                    <RenderContent text={block.title || "Gallery"} siteConfig={siteConfig} />
                </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                {block.images?.map((src: string, i: number) => (
                    <div key={i} className="relative h-64 overflow-hidden rounded-lg group">
                        <img
                            src={src}
                            alt={`Gallery image ${i + 1}`}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                        />
                    </div>
                ))}
            </div>
        </div>
    )
}



// --- MAIN RENDERING COMPONENT ---

const defaultAnimations: Record<string, string> = {
    hero: "fade-in",
    features: "fade-up",
    "feature-section": "fade-up",
    stats: "zoom-in",
    text: "fade-up",
    cta: "zoom-in",
    form: "slide-right",
    testimonials: "fade-up",
    pricing: "fade-up",
    accordion: "fade-up",
    gallery: "fade-up",
    default: "fade-up"
};

export function PublicBlockRenderer({ blocks, siteConfig }: { blocks: any[]; siteConfig?: any }) {
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return null;

    return (
        <div className="flex flex-col bg-slate-50">
            {blocks.map((block, index) => {
                // Resolve animation: preference > block specific default > generic default
                const animationKey = block.animation || defaultAnimations[block.type] || defaultAnimations.default;
                const AnimationVariant = animations[animationKey as keyof typeof animations] || animations["fade-up"];
                const ThemeClass = themes[block.theme as keyof typeof themes] || themes["light"];

                const customStyle: any = block.styles ? {
                    backgroundColor: block.styles.backgroundColor,
                    color: block.styles.textColor
                } : {};

                if (block.theme === "brand-solid" && siteConfig?.theme?.primaryColor && !customStyle.backgroundColor) {
                    customStyle.backgroundColor = siteConfig.theme.primaryColor;
                }

                return (
                    <motion.section
                        key={index}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true, margin: "-100px" }}
                        variants={AnimationVariant}
                        className={cn("w-full transition-colors duration-500", !block.styles?.backgroundColor && ThemeClass)}
                        style={customStyle}
                    >
                        {block.type === "hero" && <HeroBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "features" && <FeaturesBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "stats" && <StatsBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "text" && <TextBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "cta" && <CTABlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "form" && <FormBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "feature-section" && <FeatureSection block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "testimonials" && <TestimonialsBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "pricing" && <PricingBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "accordion" && <AccordionBlock block={block} index={index} siteConfig={siteConfig} />}
                        {block.type === "gallery" && <GalleryBlock block={block} index={index} siteConfig={siteConfig} />}

                        {/* Fallback */}
                        {!["hero", "features", "stats", "text", "cta", "form", "feature-section", "testimonials", "pricing", "accordion", "gallery"].includes(block.type) && (
                            <div className="py-20 text-center">
                                {/* If it has content/htmlContent, render it as text, otherwise hide */}
                                {(block.content || block.htmlContent) ? (
                                    <TextBlock block={{ ...block, htmlContent: block.content || block.htmlContent }} index={index} siteConfig={siteConfig} />
                                ) : (
                                    <p className="text-sm opacity-50 hidden">Unsupported Block: {block.type}</p>
                                )}
                            </div>
                        )}
                    </motion.section>
                );
            })}
        </div>
    );
}
