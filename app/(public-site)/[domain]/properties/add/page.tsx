import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PublicPropertyForm } from "./_components/public-property-form";
import db from "@/lib/db";
import { getSiteConfig } from "@/lib/public-data";
import { headers } from "next/headers";

export const metadata = {
    title: "List Your Property",
    description: "Submit your property for sale or rent.",
};

export default async function AddPropertyPage({ params }: { params: Promise<{ domain: string }> }) {
    const { userId } = await auth();
    const resolvedParams = await params;

    if (!userId) {
        redirect(`/sign-in?redirect_url=/properties/add`);
    }

    // Resolve Location ID from Domain (Standard Pattern in this app)
    const headerList = await headers();
    const host = headerList.get("host"); // We can trust the middleware rewrite or use params.domain if consistent. 
    // Usually `getSiteConfig` handles the lookup.
    // However, `params.domain` in the path might be the tenant domain.
    const config = await getSiteConfig(resolvedParams.domain);

    if (!config) {
        return <div>Site configuration error.</div>;
    }

    if (config.publicListingEnabled === false) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center p-8 bg-gray-50">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Feature Disabled</h1>
                <p className="text-gray-600 mb-4">The property listing feature is currently not available for this site.</p>
                <a href="/" className="text-primary hover:underline">Back to Home</a>
            </div>
        );
    }

    // Contact info is handled via session on submission now

    return (
        <div className="bg-gray-50 min-h-screen">
            {/* Hero / Header Section */}
            <div className="bg-slate-900 text-white py-16">
                <div className="container mx-auto px-4 text-center">
                    <h1 className="text-4xl md:text-5xl font-heading font-bold mb-4">List Your Property</h1>
                    <p className="text-lg text-gray-300 max-w-2xl mx-auto">
                        Reach thousands of potential buyers. Submit your property details below and our team will review it within 24 hours.
                    </p>
                </div>
            </div>

            <div className="container mx-auto px-4 -mt-8 pb-16">
                <PublicPropertyForm
                    locationId={config.locationId}
                />
            </div>
        </div>
    );
}

