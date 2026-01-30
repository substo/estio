"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PublicImageUploader, UploadedImage } from "./public-image-uploader";

// Actually, I'll import from the admin lib directly if possible or copy simplified versions.
import { PROPERTY_LOCATIONS as LOCATIONS } from "@/lib/properties/locations";
import { PROPERTY_TYPES as TYPES } from "@/lib/properties/constants";

import { updatePublicProperty, submitPublicProperty } from "@/app/actions/public-user";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

// Simplified types for public users
const SIMPLE_TYPES = TYPES.map(cat => ({
    label: cat.category_label,
    value: cat.category_key,
    subtypes: cat.subtypes.map(sub => ({
        label: sub.subtype_label,
        value: sub.subtype_key
    }))
}));

interface PublicPropertyFormProps {
    locationId: string;
    initialData?: any; // Property object with media
}

export function PublicPropertyForm({ locationId, initialData }: PublicPropertyFormProps) {
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    // Controlled State for Dependents
    const [category, setCategory] = useState(initialData?.category || "");
    const [district, setDistrict] = useState(initialData?.propertyLocation || "");

    // Initial images transformation
    const initialImages = initialData?.media?.map((m: any) => ({
        url: m.url,
        cloudflareImageId: m.cloudflareImageId,
        fileId: m.id || Math.random().toString(36).substr(2, 9)
    })) || [];

    const [images, setImages] = useState<UploadedImage[]>(initialImages);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsSubmitting(true);

        const formData = new FormData(event.currentTarget);

        // Append Images
        const mediaJson = JSON.stringify(images.map(img => ({
            url: img.url,
            cloudflareImageId: img.cloudflareImageId
        })));
        formData.append("mediaJson", mediaJson);
        formData.append("locationId", locationId);

        if (initialData?.id) {
            formData.append("propertyId", initialData.id);
        }

        try {
            // @ts-ignore
            const result = initialData?.id
                ? await updatePublicProperty(null, formData)
                : await submitPublicProperty(null, formData);

            if (result.success) {
                setIsSuccess(true);
                toast.success(initialData?.id ? "Property Updated Successfully!" : "Property Submitted Successfully!");
                router.refresh();
            } else {
                toast.error(result.error || "Submission failed");
                if (result.fieldErrors) {
                    console.error("Field Errors:", result.fieldErrors);
                }
            }
        } catch (error) {
            console.error("Form Error:", error);
            toast.error("Something went wrong. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isSuccess) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className="bg-green-100 p-4 rounded-full">
                    <CheckCircle2 className="w-16 h-16 text-green-600" />
                </div>
                <h2 className="text-3xl font-heading font-bold text-gray-900">
                    {initialData?.id ? "Update Received!" : "Submission Received!"}
                </h2>
                <p className="text-lg text-gray-600 max-w-md">
                    {initialData?.id
                        ? "Your property updates have been submitted for review."
                        : "Thank you for listing with us. Your property has been submitted for review."
                    }
                    {" "}Our team will verify details before publishing.
                </p>
                <div className="flex gap-4 pt-4">
                    <Button variant="outline" onClick={() => window.location.href = '/submissions'}>
                        Back to My Submissions
                    </Button>
                    {!initialData?.id && (
                        <Button onClick={() => window.location.reload()}>
                            Submit Another
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-8 max-w-3xl mx-auto">
            {initialData?.id && (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-md text-sm">
                    <strong>Note:</strong> Editing your property will set its status back to <strong>Pending Review</strong> until an administrator approves the changes.
                </div>
            )}

            {/* Property Details */}
            <div className="bg-white p-6 rounded-xl border shadow-sm space-y-6">
                <h3 className="text-lg font-bold font-heading border-b pb-2">Property Details</h3>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="title">Property Title <span className="text-red-500">*</span></Label>
                        <Input
                            id="title"
                            name="title"
                            required
                            placeholder="e.g. Modern 2-Bedroom Apartment in Limassol"
                            minLength={10}
                            defaultValue={initialData?.title}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description <span className="text-red-500">*</span></Label>
                        <Textarea
                            id="description"
                            name="description"
                            required
                            placeholder="Describe the key features, view, location benefits..."
                            className="min-h-[120px]"
                            minLength={20}
                            defaultValue={initialData?.description}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="category">Category <span className="text-red-500">*</span></Label>
                            <Select name="category" value={category} onValueChange={setCategory} required>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Category" />
                                </SelectTrigger>
                                <SelectContent>
                                    {SIMPLE_TYPES.map(t => (
                                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="type">Property Type <span className="text-red-500">*</span></Label>
                            <Select name="type" disabled={!category} defaultValue={initialData?.type} required>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {category && SIMPLE_TYPES.find(c => c.value === category)?.subtypes.map(s => (
                                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="price">Price (€) <span className="text-red-500">*</span></Label>
                            <Input
                                id="price"
                                name="price"
                                type="number"
                                required
                                placeholder="e.g. 250000"
                                min={0}
                                defaultValue={initialData?.price}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="currency">Currency</Label>
                            <Select name="currency" defaultValue={initialData?.currency || "EUR"}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="EUR">EUR (€)</SelectItem>
                                    <SelectItem value="USD">USD ($)</SelectItem>
                                    <SelectItem value="GBP">GBP (£)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Location & Specs */}
            <div className="bg-white p-6 rounded-xl border shadow-sm space-y-6">
                <h3 className="text-lg font-bold font-heading border-b pb-2">Location & Specs</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="propertyLocation">District <span className="text-red-500">*</span></Label>
                        <Select name="propertyLocation" value={district} onValueChange={setDistrict} required>
                            <SelectTrigger>
                                <SelectValue placeholder="Select District" />
                            </SelectTrigger>
                            <SelectContent>
                                {LOCATIONS.map(d => (
                                    <SelectItem key={d.district_key} value={d.district_key}>{d.district_label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="propertyArea">Area / Village</Label>
                        <Select name="propertyArea" disabled={!district} defaultValue={initialData?.propertyArea}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Area" />
                            </SelectTrigger>
                            <SelectContent>
                                {district && LOCATIONS.find(d => d.district_key === district)?.locations.map(a => (
                                    <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="addressLine1">Address (Optional)</Label>
                        <Input
                            id="addressLine1"
                            name="addressLine1"
                            placeholder="Street name, number..."
                            defaultValue={initialData?.addressLine1}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="bedrooms">Bedrooms</Label>
                        <Input
                            id="bedrooms"
                            name="bedrooms"
                            type="number"
                            min={0}
                            placeholder="e.g. 3"
                            defaultValue={initialData?.bedrooms}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="bathrooms">Bathrooms</Label>
                        <Input
                            id="bathrooms"
                            name="bathrooms"
                            type="number"
                            min={0}
                            placeholder="e.g. 2"
                            defaultValue={initialData?.bathrooms}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="coveredAreaSqm">Covered Area (sqm)</Label>
                        <Input
                            id="coveredAreaSqm"
                            name="coveredAreaSqm"
                            type="number"
                            min={0}
                            placeholder="e.g. 120"
                            defaultValue={initialData?.coveredAreaSqm}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="plotAreaSqm">Plot Area (sqm)</Label>
                        <Input
                            id="plotAreaSqm"
                            name="plotAreaSqm"
                            type="number"
                            min={0}
                            placeholder="e.g. 500"
                            defaultValue={initialData?.plotAreaSqm}
                        />
                    </div>
                </div>
            </div>

            {/* Media */}
            <div className="bg-white p-6 rounded-xl border shadow-sm space-y-6">
                <h3 className="text-lg font-bold font-heading border-b pb-2">Photos</h3>
                <p className="text-sm text-gray-500">Upload high-quality photos to make your listing stand out. First image will be the main photo.</p>
                <PublicImageUploader
                    onImagesChange={setImages}
                    initialImages={initialImages}
                    locationId={locationId}
                    maxImages={15}
                />
            </div>

            {/* Submit */}
            <div className="pt-4 pb-12">
                <Button size="lg" className="w-full font-bold text-lg h-14" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Submitting...
                        </>
                    ) : (
                        initialData?.id ? "Update Property" : "Submit Property for Review"
                    )}
                </Button>
            </div>
        </form>
    );
}
