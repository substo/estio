"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, ExternalLink } from "lucide-react";
import {
    PROPERTY_TYPES,
} from "@/lib/properties/constants";
import {
    PROPERTY_CONDITIONS,
    PROPERTY_SOURCES,
    FEATURE_CATEGORIES
} from "@/lib/properties/filter-constants";
import { PROPERTY_LOCATIONS } from "@/lib/properties/locations";

// Helper to safely display values
const DisplayField = ({ label, value, className = "" }: { label: string, value: React.ReactNode | string | number | null | undefined, className?: string }) => {
    if (value === null || value === undefined || value === "") return null;
    return (
        <div className={`space-y-1 ${className}`}>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">{label}</Label>
            <div className="font-medium text-sm p-2 bg-muted/30 rounded-md border border-border/50 min-h-[36px] flex items-center">
                {value}
            </div>
        </div>
    );
};



const DisplaySection = ({ title, children }: { title: string, children: React.ReactNode }) => {
    // We only render the section if there are valid children (this is a bit tricky with ReactNode, 
    // effectively we rely on the parent to only pass children if data exists, or we accept empty sections if they are main ones).
    // For this simplified view, let's always render the title if it's a main section.
    return (
        <div className="space-y-4 pt-6 first:pt-0">
            <h3 className="text-lg font-semibold border-b pb-2">{title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {children}
            </div>
        </div>
    );
};

import { useState } from "react";
import { PropertyEditDialog } from "@/components/properties/property-edit-dialog";

interface PropertyViewProps {
    property: any;
    domain?: string | null;
    locationId: string;
    contactsData?: { id: string; name: string }[];
    developersData?: { id: string; name: string }[];
    managementCompaniesData?: { id: string; name: string }[];
    projectsData?: any[]; // Project[] but avoiding cyclic import for now or simplify
}

export default function PropertyView({
    property,
    domain,
    locationId,
    contactsData,
    developersData,
    managementCompaniesData,
    projectsData
}: PropertyViewProps) {
    const [isEditOpen, setIsEditOpen] = useState(false);

    if (!property) return <div>No property data available.</div>;

    // Resolve Enums/Constants for display
    const categoryLabel = PROPERTY_TYPES.find(c => c.category_key === property.category)?.category_label || property.category;
    const typeLabel = PROPERTY_TYPES.find(c => c.category_key === property.category)?.subtypes.find(s => s.subtype_key === property.type)?.subtype_label || property.type;
    const conditionLabel = PROPERTY_CONDITIONS.find(c => c.key === property.condition)?.label || property.condition;
    const sourceLabel = PROPERTY_SOURCES.find(s => s.key === property.source)?.label || property.source;

    const districtLabel = PROPERTY_LOCATIONS.find(d => d.district_key === property.propertyLocation)?.district_label || property.propertyLocation;
    const areaLabel = PROPERTY_LOCATIONS.find(d => d.district_key === property.propertyLocation)?.locations.find(l => l.key === property.propertyArea)?.label || property.propertyArea;


    // Images
    const images = property.media?.filter((m: any) => m.kind === 'IMAGE').sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)) || [];
    const videos = property.media?.filter((m: any) => m.kind === 'VIDEO') || [];
    // Legacy support for video/doc urls if not in media relation could be added but skipping for cleaner view as per "no clutter"

    return (
        <div className="space-y-8 pb-12">
            {/* Header / Actions */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" asChild>
                    <Link href="/admin/properties">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to List
                    </Link>
                </Button>
                <div className="flex gap-2">
                    {domain && (
                        <Button variant="outline" asChild>
                            <a href={`http://${domain}/properties/${property.slug}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View on Public Site
                            </a>
                        </Button>
                    )}
                    <Button onClick={() => setIsEditOpen(true)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Property
                    </Button>
                </div>
            </div>

            <PropertyEditDialog
                isOpen={isEditOpen}
                onOpenChange={setIsEditOpen}
                property={property}
                locationId={locationId}
                contactsData={contactsData}
                developersData={developersData}
                managementCompaniesData={managementCompaniesData}
                projectsData={projectsData}
            />

            <div className="space-y-6 max-w-5xl mx-auto bg-card p-8 rounded-xl shadow-sm border">

                {/* 1. KEY DETAILS */}
                <DisplaySection title="Details">
                    <DisplayField label="Title" value={property.title} className="col-span-2" />
                    <DisplayField label="Ref. No." value={property.reference || property.slug} />
                    <DisplayField label="Status" value={property.status} />
                    <DisplayField label="Goal" value={property.goal} />
                    <DisplayField label="Publication Status" value={property.publicationStatus} />
                    <DisplayField label="Category" value={categoryLabel} />
                    <DisplayField label="Type" value={typeLabel} />
                    <DisplayField label="Condition" value={conditionLabel} />
                    <DisplayField label="Source" value={sourceLabel} />
                    <DisplayField label="Sort Order" value={property.sortOrder} />
                    {property.featured && (
                        <div className="flex items-center space-x-2 pt-6">
                            <Checkbox checked={true} disabled />
                            <Label>Featured Property</Label>
                        </div>
                    )}
                </DisplaySection>

                {/* Description */}
                {property.description && (
                    <div className="space-y-2 pt-6">
                        <h3 className="text-lg font-semibold border-b pb-2">Description</h3>
                        <div
                            className="prose prose-sm max-w-none p-4 bg-muted/20 rounded-md border border-border/50"
                            dangerouslySetInnerHTML={{ __html: property.description }}
                        />
                    </div>
                )}

                {/* 2. PRICING */}
                <DisplaySection title="Pricing">
                    <DisplayField label="Price" value={`${property.price?.toLocaleString()} ${property.currency || ''}`} />
                    <DisplayField label="Price Type" value={property.rentalPeriod !== 'n/a' ? property.rentalPeriod : null} />
                    <DisplayField label="Communal Fees" value={property.communalFees ? `${property.communalFees}/mo` : null} />
                    <DisplayField label="Deposit (Text)" value={property.deposit} />
                    <DisplayField label="Deposit Amount" value={property.depositValue?.toLocaleString()} />

                    {property.priceIncludesCommunalFees && (
                        <div className="flex items-center space-x-2 pt-6">
                            <Checkbox checked={true} disabled />
                            <Label>Price includes Communal Fees</Label>
                        </div>
                    )}
                    {property.billsTransferable && (
                        <div className="flex items-center space-x-2 pt-6">
                            <Checkbox checked={true} disabled />
                            <Label>Bills are Transferable</Label>
                        </div>
                    )}
                </DisplaySection>

                {/* 3. LOCATION */}
                <DisplaySection title="Location">
                    <DisplayField label="Address Line 1" value={property.addressLine1} />
                    <DisplayField label="Address Line 2" value={property.addressLine2} />
                    <DisplayField label="City" value={property.city} />
                    <DisplayField label="Postal Code" value={property.postalCode} />
                    <DisplayField label="District" value={districtLabel} />
                    <DisplayField label="Area/Village" value={areaLabel} />
                    <DisplayField label="Country" value={property.country} />
                    <DisplayField label="Coordinates" value={(property.latitude && property.longitude) ? `${property.latitude}, ${property.longitude}` : null} />
                </DisplaySection>

                {/* 4. SPECS */}
                <DisplaySection title="Specs">
                    <DisplayField label="Bedrooms" value={property.bedrooms} />
                    <DisplayField label="Bathrooms" value={property.bathrooms} />
                    <DisplayField label="Total Covered Area" value={property.areaSqm ? `${property.areaSqm} sqm` : null} />
                    <DisplayField label="Internal Covered" value={property.coveredAreaSqm ? `${property.coveredAreaSqm} sqm` : null} />
                    <DisplayField label="Covered Veranda" value={property.coveredVerandaSqm ? `${property.coveredVerandaSqm} sqm` : null} />
                    <DisplayField label="Uncovered Veranda" value={property.uncoveredVerandaSqm ? `${property.uncoveredVerandaSqm} sqm` : null} />
                    <DisplayField label="Basement" value={property.basementSqm ? `${property.basementSqm} sqm` : null} />
                    <DisplayField label="Plot Area" value={property.plotAreaSqm ? `${property.plotAreaSqm} sqm` : null} />
                    <DisplayField label="Build Year" value={property.buildYear} />
                    <DisplayField label="Floor" value={property.floor} />
                </DisplaySection>

                {/* Features */}
                {property.features && property.features.length > 0 && (
                    <div className="space-y-4 pt-6">
                        <h3 className="text-lg font-semibold border-b pb-2">Features</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {FEATURE_CATEGORIES.map((category) => {
                                const activeFeatures = category.items.filter(f => property.features.includes(f.key));
                                if (activeFeatures.length === 0) return null;

                                return (
                                    <div key={category.label} className="space-y-2">
                                        <h4 className="font-medium text-sm text-muted-foreground">{category.label}</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {activeFeatures.map(f => (
                                                <div key={f.key} className="flex items-center space-x-2 bg-secondary px-2 py-1 rounded-sm text-sm">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                                                    <span>{f.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* 5. PUBLISH / SEO */}
                <DisplaySection title="SEO & Publishing">
                    <DisplayField label="Slug" value={property.slug} />
                    <DisplayField label="Meta Title" value={property.metaTitle} />
                    <DisplayField label="Meta Keywords" value={property.metaKeywords} />
                    <DisplayField label="Meta Description" value={property.metaDescription} className="col-span-2" />

                    <DisplayField label="Created By" value={property.creator?.name} />
                    <DisplayField label="Updated By" value={property.updater?.name} />
                    <DisplayField
                        label="Created At"
                        value={property.createdAt ? <span suppressHydrationWarning>{new Date(property.createdAt).toLocaleString()}</span> : null}
                    />
                    <DisplayField
                        label="Updated At"
                        value={property.updatedAt ? <span suppressHydrationWarning>{new Date(property.updatedAt).toLocaleString()}</span> : null}
                    />
                </DisplaySection>

                {/* 6. MEDIA */}
                {images.length > 0 && (
                    <div className="space-y-4 pt-6">
                        <h3 className="text-lg font-semibold border-b pb-2">Images ({images.length})</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {images.map((img: any, idx: number) => (
                                <div key={img.id || idx} className="aspect-square rounded-lg overflow-hidden border bg-gray-100 relative group">
                                    {img.cloudflareImageId ? (
                                        <CloudflareImage
                                            imageId={img.cloudflareImageId}
                                            variant="public"
                                            className="w-full h-full object-cover"
                                            width={300}
                                            height={300}
                                            alt={`Property Image ${idx + 1}`}
                                        />
                                    ) : (
                                        <img src={img.url} alt={`Property ${idx + 1}`} className="w-full h-full object-cover" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {videos.length > 0 && (
                    <div className="space-y-4 pt-6">
                        <h3 className="text-lg font-semibold border-b pb-2">Videos ({videos.length})</h3>
                        <ul className="list-disc pl-5 space-y-1">
                            {videos.map((vid: any, idx: number) => (
                                <li key={idx}><a href={vid.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{vid.url}</a></li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* 7. STAKEHOLDERS */}
                {(property.contactRoles?.length > 0 || property.companyRoles?.length > 0) && (
                    <DisplaySection title="Stakeholders">
                        {property.contactRoles?.map((role: any) => (
                            <DisplayField key={role.id} label={`${role.role} (Contact)`} value={role.contact.name} />
                        ))}
                        {property.companyRoles?.map((role: any) => (
                            <DisplayField key={role.id} label={`${role.role} (Company)`} value={role.company.name} />
                        ))}
                    </DisplaySection>
                )}
            </div>
        </div>
    );
}
