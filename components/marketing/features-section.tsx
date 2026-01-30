import { Database, Globe, Layers, Zap, Sparkles, Wand2, PenTool } from "lucide-react";

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
            title: "High Performance",
            description: "Built on Next.js 14 with Cloudflare Image optimization for lightning-fast page loads and superior Core Web Vitals.",
            icon: Zap,
        },
    ];

    return (
        <section className="py-24 bg-slate-50 dark:bg-slate-900/50 w-full">
            <div className="container px-4 md:px-6 mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {features.map((feature, idx) => (
                        <div key={idx} className="flex flex-col space-y-2 p-6 bg-background rounded-lg border shadow-sm hover:shadow-md transition-shadow">
                            <div className="p-2 w-fit rounded-lg bg-primary/10 text-primary mb-2">
                                <feature.icon className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold">{feature.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
