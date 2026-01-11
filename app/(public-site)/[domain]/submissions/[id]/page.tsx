
import { getSiteConfig } from "@/lib/public-data";
import { PublicPropertyForm } from "../../properties/add/_components/public-property-form";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { SetHeaderStyle } from "../../_components/header-context";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Metadata } from "next";

interface Props {
    params: Promise<{ domain: string; id: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    return {
        title: "Edit Property",
        description: "Edit your submitted property listing"
    };
}

export default async function EditSubmissionPage(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const { userId } = await auth();
    if (!userId) {
        redirect(`/sign-in?redirect_url=/submissions/${params.id}`);
    }

    // Verify ownership and fetch property
    const contact = await db.contact.findUnique({
        where: { clerkUserId: userId },
        select: { id: true }
    });

    if (!contact) {
        redirect('/submissions?error=profile_not_found');
    }

    const property = await db.property.findFirst({
        where: {
            id: params.id,
            contactRoles: {
                some: {
                    contactId: contact.id,
                    role: 'Owner'
                }
            }
        },
        include: {
            media: {
                orderBy: { sortOrder: 'asc' }
            }
        }
    });

    if (!property) {
        notFound();
    }

    const headerStyle = "solid"; // Enforce solid header for form pages

    return (
        <div className="min-h-screen bg-background pb-20 pt-24 font-sans">
            <SetHeaderStyle style={headerStyle} />

            <div className="container mx-auto px-4 max-w-3xl">
                <div className="mb-8">
                    <Button variant="ghost" className="pl-0 gap-2 mb-4 hover:bg-transparent hover:text-primary" asChild>
                        <Link href="/submissions">
                            <ArrowLeft className="h-4 w-4" />
                            Back to My Submissions
                        </Link>
                    </Button>
                    <h1 className="text-3xl font-bold font-heading mb-2">Edit Property</h1>
                    <p className="text-muted-foreground">
                        Update your listing details. Changes will require re-verification.
                    </p>
                </div>

                <PublicPropertyForm
                    locationId={config.locationId}
                    initialData={property}
                />
            </div>
        </div>
    );
}
