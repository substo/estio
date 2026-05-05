import { Database, Layers, Zap, Sparkles, Wand2, PenTool, Smartphone } from "lucide-react";
import Link from "next/link";

export function FeaturesSection() {
    const features = [
        {
            title: "Native GHL Integration",
            description: "Seamlessly sync contacts, trigger automations, and manage leads directly within your GoHighLevel CRM.",
            icon: Layers,
        },
        {
            title: "Magic Vision Import",
            description: "Paste any property URL or upload a screenshot. Our Vision AI extracts prices, specs, and details in seconds.",
            icon: Sparkles,
        },
        {
            title: "AI Auto-Mapping",
            description: "Forget manual field mapping. Our AI analyzes XML feeds and instantly maps them to your schema.",
            icon: Database,
        },
        {
            title: "AI Site Builder",
            description: "Generate tailored, SEO-optimized real estate landing pages with a single click using our generative design engine.",
            icon: Wand2,
        },
        {
            title: "Brand Voice Cloning",
            description: "The AI learns your writing style and generates listing descriptions that sound just like you.",
            icon: PenTool,
        },
        {
            title: "SIM Relay",
            description: "Send and receive CRM SMS through your own Android phone and SIM card to reduce gateway fees.",
            icon: Smartphone,
            href: "/sim-relay",
        },
        {
            title: "High Performance",
            description: "Built on Next.js 14 with Cloudflare Image optimization for lightning-fast page loads and superior Core Web Vitals.",
            icon: Zap,
        },
    ];

    return (
        <section className="py-24 bg-slate-50 dark:bg-slate-900/50 w-full">
            <div className="container px-4 md:px-6 mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {features.map((feature, idx) => {
                        const content = (
                            <>
                                <div className="p-2 w-fit rounded-lg bg-primary/10 text-primary mb-2">
                                    <feature.icon className="h-6 w-6" />
                                </div>
                                <h3 className="text-xl font-bold">{feature.title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {feature.description}
                                </p>
                            </>
                        );

                        if (feature.href) {
                            return (
                                <Link
                                    key={idx}
                                    href={feature.href}
                                    className="flex flex-col space-y-2 p-6 bg-background rounded-lg border shadow-sm hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                >
                                    {content}
                                </Link>
                            );
                        }

                        return (
                            <div key={idx} className="flex flex-col space-y-2 p-6 bg-background rounded-lg border shadow-sm hover:shadow-md transition-shadow">
                                {content}
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
