
import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
    try {
        // 1. Get Location
        const location = await db.location.findFirst({
            include: { siteConfig: true }
        });

        if (!location) {
            return NextResponse.json({ error: "No location found" }, { status: 400 });
        }

        const domain = location.siteConfig?.domain || "unknown-domain";

        const blocks = [
            // 1. Hero Section
            {
                type: "hero",
                alignment: "center",
                badge: "", // No badge in hero
                headline: "Company Profile",
                subheadline: "Building trust, delivering excellence, and creating value in Cyprus real estate.",
                backgroundImage: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80", // Keys/Hero
                theme: "dark", // Text white
                styles: {
                    backgroundColor: "#000000"
                }
            },
            // 2. Who We Are (Text Left, Image Right)
            {
                type: "feature-section",
                layout: "split-left",
                supertitle: "Who We Are",
                title: "Welcome to Down Town, <br /> <span class=\"text-primary\">Your Trusted Real Estate Partner</span>",
                description: "<p class=\"mb-6\">At Down Town, we're your trusted partner in the real estate journey. We're a registered and licensed company (<span class=\"font-bold text-foreground\">C.N. PROPERTY CANVAS LTD | Reg. No. 826 & License No. 432/E</span>), combining the freshness of a new establishment with the seasoned experience of several years in the industry.</p><p>Our extensive partner network allows us to cater to both local and international clients, offering a friendly yet fully professional approach to every interaction.</p>",
                image: "https://images.unsplash.com/photo-1577412647305-991150c7d163?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80", // Handshake
                badges: [
                    { title: "Reg. No. 826", subtitle: "Registered" },
                    { title: "Lic. No. 432/E", subtitle: "Licensed" }
                ],
                overlay: {
                    // No specific overlay card for this one in prototype, only background blob?
                    // Prototype has 'handshakeImg' with a background blob.
                    // My FeatureSection has a generic one. Let's leave overlay empty or maybe add something later.
                }
            },
            // 3. Portfolio (Image Left, Text Right)
            {
                type: "feature-section",
                layout: "split-right",
                supertitle: "Our Portfolio",
                title: "Large Portfolio of Properties <br /> for Sale and Rent in Paphos",
                description: "<p class=\"mb-6\">Discover a vast selection of properties in Paphos with Down Town. Our portfolio boasts a wide range of options sourced from banks, developers, and direct listings.</p><p>With our in-depth understanding of the local market, we're equipped to guide you through every step of your property search.</p>",
                ctaText: "View Properties",
                ctaLink: "/properties/search",
                image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80", // Paphos/Coast
                overlay: {
                    position: "top-left",
                    style: "primary",
                    title: "Prime<br/>Locations",
                    width: "8rem",
                    height: "8rem"
                },
                styles: {
                    backgroundColor: "#f3f4f6" // Secondary/30
                }
            },
            // 4. Consultation (Text Left, Image Right)
            {
                type: "feature-section",
                layout: "split-left",
                supertitle: "Consultation",
                title: "Professional Advice and <br /> Investment Consultation",
                description: "<p class=\"mb-6\">At Down Town, we offer more than just property listings; we provide professional advice and investment consultation to help you make informed decisions.</p><p>Whether you're a first-time buyer or an experienced investor, we're here to provide personalized guidance.</p>",
                image: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80", // Meeting
                overlay: {
                    position: "center-right",
                    style: "primary",
                    icon: "Award",
                    text: "\"Our goal is to help you achieve your real estate goals with confidence and clarity.\""
                }
            }
        ];

        const page = await db.contentPage.upsert({
            where: {
                locationId_slug: {
                    locationId: location.id,
                    slug: "about"
                }
            },
            update: {
                title: "About Us",
                blocks: blocks as any,
                published: true
            },
            create: {
                locationId: location.id,
                slug: "about",
                title: "About Us",
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
