import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
    try {
        // 1. Get Location (assuming single location or picking first for demo, or hardcoded ID if known)
        // Ideally we should run this in context of a specific location.
        // For now, I'll fetch the first location to get an ID.
        const location = await db.location.findFirst({
            include: { siteConfig: true }
        });

        if (!location) {
            return NextResponse.json({ error: "No location found" }, { status: 400 });
        }

        const domain = location.siteConfig?.domain || "unknown-domain";

        const blocks = [
            // Block 1: Hero
            {
                type: "hero",
                alignment: "center",
                badge: "Seller Services",
                headline: "Sell With Confidence. <br/> <span class=\"text-primary\">Sell With Downtown.</span>",
                subheadline: "Maximize your property's value with Cyprus's most dynamic real estate agency.",
                image: "/images/professional_real_estate_consultation.png", // Verify path after copy
                ctaText: "Request Valuation",
                ctaLink: "#contact",
                styles: {
                    backgroundColor: "#ffffff",
                    textColor: "#0f172a"
                }
            },
            // Block 2: Introduction (Split)
            {
                type: "hero",
                layout: "split-right", // Text Left, Image Right
                badge: "",
                headline: "More Than Just A Listing.",
                subheadline: "Selling a property in Cyprus can be complex. At Downtown, we simplify the process. We believe that every home has a story, and our job is to tell it to the right audience.<br/><br/>Our approach combines traditional personalized service with cutting-edge digital marketing. We don't just wait for the phone to ring; we proactively find the buyer for your home.",
                image: "/images/modern_office_meeting.png", // Verify path after copy
                overlayCard: "TRUSTED\nBY 1000+\nOWNERS",
                stats: [
                    { value: "50M+", label: "Sales Volume" },
                    { value: "30 Days", label: "Avg. Time to Sell" }
                ],
                styles: {
                    backgroundColor: "#ffffff",
                    textColor: "#0f172a"
                }
            },
            // Block 3: Benefits
            {
                type: "features",
                layout: "cards",
                badge: "", // No badge on prototype for this section? Actually prototype had "Why Owners Choose Us" as H2, which fits 'title'.
                title: "Why Owners Choose Us",
                subtext: "We bring a level of professionalism and marketing firepower that is unmatched in the local market.",
                items: [
                    { icon: "Globe", title: "Global Exposure", description: "We don't just list locally. Your property is showcased on leading international portals, reaching investors in the UK, Europe, Russia, and the Middle East." },
                    { icon: "Camera", title: "Premium Presentation", description: "First impressions matter. We invest in professional photography, 4K drone videography, and virtual tours to make your property stand out from the competition." },
                    { icon: "Users", title: "Qualified Database", description: "Skip the time-wasters. We have an active database of pre-vetted cash buyers and investors ready to make a move on the right property." },
                    { icon: "ChartLine", title: "Data-Driven Valuation", description: "No guesswork. We use real-time market data and comparable sales to price your property competitively, ensuring the best possible return." }, // 'BarChart' -> ChartLine or BarChart
                    { icon: "Shield", title: "Legal & Admin Support", description: "From the initial agreement to the final transfer at the Land Registry, our team handles the bureaucracy so you can have peace of mind." },
                    { icon: "Check", title: "No Sale, No Fee", description: "We are confident in our ability to deliver. You only pay our commission when we successfully sell your property. No hidden upfront costs." }
                ],
                styles: {
                    backgroundColor: "#f1f5f9" // bg-secondary/30 ~ slate-100 ? Check theme. Prototype: bg-secondary/30.
                }
            },
            // Block 4: CTA
            {
                type: "cta",
                title: "Ready to Sell?",
                subtext: "Book a free, no-obligation valuation today. Let's discuss how we can get the best price for your property.",
                buttonText: "Request Valuation",
                link: "#contact",
                secondaryCtaText: "Contact Our Team",
                secondaryCtaLink: "#contact-team",
                theme: "brand-solid",
                styles: {}
            }
        ];

        const page = await db.contentPage.upsert({
            where: {
                locationId_slug: {
                    locationId: location.id,
                    slug: "why-sell-with-us"
                }
            },
            update: {
                title: "Why Sell With Us",
                blocks: blocks as any,
                published: true
            },
            create: {
                locationId: location.id,
                slug: "why-sell-with-us",
                title: "Why Sell With Us",
                blocks: blocks as any,
                published: true
            }
        });

        return NextResponse.json({ success: true, domain, page });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to seed" }, { status: 500 });
    }
}
