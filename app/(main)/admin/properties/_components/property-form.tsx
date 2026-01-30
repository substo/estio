"use client";

import { Project } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { upsertProperty, pushToOldCrm, pullFromOldCrm, linkPropertyCreator } from "../actions";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { PROPERTY_TYPES } from "@/lib/properties/constants";
import { PROPERTY_LOCATIONS } from "@/lib/properties/locations";
import { PROPERTY_CONDITIONS, FEATURE_CATEGORIES, PROPERTY_SOURCES } from "@/lib/properties/filter-constants";
import { MediaUploader } from "@/components/ui/media-uploader";
import { X, Plus, Pencil } from "lucide-react";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { SearchableSelect } from "../../contacts/_components/searchable-select";
// Fetch helpers removed as data is passed via props
import { useEffect } from "react";
import { AddCompanyDialog } from "./add-company-dialog";
import { ContactDialog } from "./contact-dialog";
import { ProjectDialog } from "../../projects/_components/project-dialog";

import { CloudflareImageUploader } from "@/components/media/CloudflareImageUploader";
import { CloudflareImage } from "@/components/media/CloudflareImage";

import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { toast } from "sonner";
import { CSS } from '@dnd-kit/utilities';

interface SortableImageProps {
    id: string;
    index: number;
    children: React.ReactNode;
    onRemove: (index: number) => void;
}

function SortableImage({ id, index, children, onRemove }: SortableImageProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative group aspect-square rounded-lg overflow-hidden border bg-gray-100 touch-none">
            {children}
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation(); // Prevent affecting drag
                    onRemove(index);
                }}
                onPointerDown={(e) => e.stopPropagation()} // Prevent drag initiation on button
                className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

export default function PropertyForm({
    property: initialProperty,
    locationId,
    onSuccess,
    accountHash,
    contactsData,
    developersData,
    managementCompaniesData,
    projectsData
}: {
    property?: any,
    locationId: string,
    onSuccess?: (savedProperty?: any) => void,
    accountHash?: string;
    // New props for dropdown data
    contactsData?: { id: string; name: string; email?: string | null; phone?: string | null; message?: string | null }[];
    developersData?: { id: string; name: string }[];
    managementCompaniesData?: { id: string; name: string }[];
    projectsData?: Project[];
}) {
    const [pulledData, setPulledData] = useState<any>(null);
    const property = pulledData || initialProperty;
    // Key to force re-mounting of uncontrolled components when data changes
    const [formVersion, setFormVersion] = useState(0);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string>(property?.category || "");
    const [selectedType, setSelectedType] = useState<string>(property?.type || "");
    const [selectedDistrict, setSelectedDistrict] = useState<string>(property?.propertyLocation || "");
    const [selectedArea, setSelectedArea] = useState<string>(property?.propertyArea || "");
    const [description, setDescription] = useState<string>(property?.description || "");

    // Role Selection State - Initialize from props
    // We map 'name' to ensure it exists, though the props type says it does.
    // Role Selection State - Initialize from props
    // We map 'name' to ensure it exists, though the props type says it does.
    const [contacts, setContacts] = useState<{ id: string; name: string; email?: string | null; phone?: string | null; message?: string | null }[]>(contactsData || []);
    const [developers, setDevelopers] = useState<{ id: string; name: string }[]>(developersData || []);
    const [managementCompanies, setManagementCompanies] = useState<{ id: string; name: string }[]>(managementCompaniesData || []);
    const [projects, setProjects] = useState<Project[]>(projectsData || []);

    const [selectedOwnerId, setSelectedOwnerId] = useState<string>(
        property?.contactRoles?.find((r: any) => r.role.toLowerCase() === 'owner')?.contact?.id || ""
    );
    const [selectedDeveloperId, setSelectedDeveloperId] = useState<string>(
        property?.companyRoles?.find((r: any) => r.role.toLowerCase() === 'developer')?.company?.id || ""
    );
    const [selectedAgentId, setSelectedAgentId] = useState<string>(
        property?.contactRoles?.find((r: any) => r.role.toLowerCase() === 'agent')?.contact?.id || ""
    );
    const [selectedManagementCompanyId, setSelectedManagementCompanyId] = useState<string>(
        property?.companyRoles?.find((r: any) => r.role.toLowerCase() === 'management company')?.company?.id || ""
    );
    const [selectedProjectId, setSelectedProjectId] = useState<string>(property?.projectId || "");

    // Import Metadata State
    const [originalCreatorName, setOriginalCreatorName] = useState<string>(property?.originalCreatorName || "");
    const [originalCreatorEmail, setOriginalCreatorEmail] = useState<string>(property?.originalCreatorEmail || "");
    const [originalCreatedAt, setOriginalCreatedAt] = useState<string>(property?.originalCreatedAt || "");
    const [originalUpdatedAt, setOriginalUpdatedAt] = useState<string>(property?.originalUpdatedAt || "");

    // useEffect fetching removed to prevent loop. Data is now passed as props.

    interface ImageItem {
        url: string;
        cloudflareImageId?: string;
        kind: string;
        sortOrder: number;
    }

    // ... inside component
    // Media State
    const [images, setImages] = useState<ImageItem[]>(() => {
        if (property?.media) {
            return property.media
                .filter((m: any) => m.kind === 'IMAGE')
                .map((m: any) => ({
                    url: m.url,
                    cloudflareImageId: m.cloudflareImageId,
                    kind: 'IMAGE',
                    sortOrder: m.sortOrder || 0
                }));
        }
        // Fallback for legacy comma-separated string
        if (property?.mediaUrls) {
            return property.mediaUrls.split(',').map((s: string, i: number) => ({
                url: s.trim(),
                kind: 'IMAGE',
                sortOrder: i
            })).filter((i: any) => i.url);
        }
        return [];
    });

    const [videoUrls, setVideoUrls] = useState<string[]>(
        property?.media?.filter((m: any) => m.kind === 'VIDEO').map((m: any) => m.url) ||
        (property?.videoUrls ? property.videoUrls.split('\n').map((s: string) => s.trim()).filter(Boolean) : [])
    );
    const [documentUrls, setDocumentUrls] = useState<string[]>(
        property?.media?.filter((m: any) => m.kind === 'DOCUMENT').map((m: any) => m.url) ||
        (property?.documentUrls ? property.documentUrls.split('\n').map((s: string) => s.trim()).filter(Boolean) : [])
    );

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Require 8px movement before drag starts (prevents accidental clicks)
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setImages((items) => {
                const oldIndex = items.findIndex((item) => (item.cloudflareImageId || item.url) === active.id);
                const newIndex = items.findIndex((item) => (item.cloudflareImageId || item.url) === over.id);

                return arrayMove(items, oldIndex, newIndex);
            });
        }
    }

    const handleRemoveMedia = (type: 'image' | 'video' | 'document', index: number) => {
        if (type === 'image') {
            setImages(prev => prev.filter((_, i) => i !== index));
        } else if (type === 'video') {
            setVideoUrls(prev => prev.filter((_, i) => i !== index));
        } else {
            setDocumentUrls(prev => prev.filter((_, i) => i !== index));
        }
    };

    async function handleSubmit(formData: FormData) {
        setIsSubmitting(true);
        try {
            const savedProperty = await upsertProperty(formData);

            // If we are in "new" mode, we won't have an ID to push until after redirect.
            // But if we are editing, we can push.
            // For now, let's keep it simple: Save first, then user can push.

            if (onSuccess) {
                onSuccess(savedProperty);
            }
        } catch (error) {
            console.error("Failed to save property:", error);
            // Handle error (e.g., show toast)
        } finally {
            setIsSubmitting(false);
        }
    }

    const onFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter;

        // Allow submission ONLY if the submitter is the Save Property button
        if (submitter?.id !== 'save-property-button') {
            e.preventDefault();
            console.warn('[FORM_SUBMIT_BLOCKED] Blocked submission from:', submitter);
            return;
        }

        console.log('[FORM_SUBMIT_ALLOWED] Submitting via Save Property button');
    };

    const [isPushing, setIsPushing] = useState(false);

    // Dynamically import to avoid server-side issues if any, though server actions are fine.
    // actually we need to import { pushToOldCrm } from "../actions"; which is already imported above if we change the import.

    const handlePushToCrm = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!property?.id || property.id === 'new') {
            alert("Please save the property first.");
            return;
        }

        // Removed confirm dialog to prevent potential browser blocking/cancellation issues
        console.log("Client: Calling server action pushToOldCrm...");

        setIsPushing(true);
        try {
            // we need to import pushToOldCrm from actions
            const result = await pushToOldCrm(property.id);
            if (result.success) {
                alert("CRM Push Started: " + result.message);
            } else {
                alert("CRM Push Failed: " + result.error);
            }
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setIsPushing(false);
        }
    };

    // --- PULL feature ---
    const [importId, setImportId] = useState("");
    const [isPulling, setIsPulling] = useState(false);

    const handlePull = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!importId) return;

        setIsPulling(true);
        try {
            const res = await pullFromOldCrm(importId);
            if (!res.success) {
                alert("Pull Failed: " + res.error);
                return;
            }

            const data = res.data;
            console.log("Pulled Data:", data);
            console.log("Debug Creator:", {
                name: data.originalCreatorName,
                email: data.originalCreatorEmail,
                createdAt: data.originalCreatedAt,
                updatedAt: data.originalUpdatedAt
            });

            setPulledData(data);

            // Explicitly update controlled states for Category and Type
            if (data.category) setSelectedCategory(data.category);
            if (data.type) setSelectedType(data.type);
            if (data.description) setDescription(data.description);
            // Explicitly update Location states
            if (data.propertyLocation) setSelectedDistrict(data.propertyLocation);
            if (data.propertyArea) setSelectedArea(data.propertyArea);

            // Handle Images (Support both legacy array of strings and new array of objects)
            if (data.images && Array.isArray(data.images)) {
                const newImages = data.images.map((img: any, idx: number) => {
                    if (typeof img === 'string') {
                        // Legacy/Fallback
                        return {
                            url: img,
                            kind: 'IMAGE',
                            sortOrder: idx
                        };
                    } else {
                        // New Object Format
                        return {
                            url: img.url,
                            cloudflareImageId: img.cloudflareImageId,
                            kind: 'IMAGE',
                            sortOrder: img.sortOrder || idx
                        };
                    }
                });
                setImages(newImages);
            }

            if (data.ownerContactId) {
                // Optimistically update or add owner in contacts list
                setContacts(prev => {
                    const newContactData = {
                        id: data.ownerContactId,
                        name: data.ownerName,
                        email: data.ownerEmail,
                        phone: data.ownerMobile || data.ownerPhone,
                        message: `Imported from CRM. \nCompany: ${data.ownerCompany || ''}\nNotes: ${data.ownerNotes || ''}`
                    };

                    const exists = prev.some(c => c.id === data.ownerContactId);
                    if (exists) {
                        // Update existing contact with new details (preserving ID)
                        return prev.map(c => c.id === data.ownerContactId ? { ...c, ...newContactData } : c);
                    } else {
                        // Add new
                        return [...prev, newContactData].sort((a, b) => a.name.localeCompare(b.name));
                    }
                });
                setSelectedOwnerId(data.ownerContactId);
            }

            if (data.projectId && data.project) {
                // Optimistically add/update project in list
                setProjects(prev => {
                    const exists = prev.some(p => p.id === data.projectId);
                    if (exists) {
                        return prev;
                    }
                    return [...prev, data.project].sort((a, b) => a.name.localeCompare(b.name));
                });
                setProjects(prev => {
                    const exists = prev.some(p => p.id === data.projectId);
                    if (exists) {
                        return prev;
                    }
                    return [...prev, data.project].sort((a, b) => a.name.localeCompare(b.name));
                });
                setSelectedProjectId(data.projectId);
            }

            // Set Import Metadata
            if (data.originalCreatorName) setOriginalCreatorName(data.originalCreatorName);
            // Email might not be scraped, but if it was (e.g. from existing user match?)
            if (data.originalCreatorEmail) setOriginalCreatorEmail(data.originalCreatorEmail);
            if (data.originalCreatedAt) setOriginalCreatedAt(data.originalCreatedAt);
            if (data.originalUpdatedAt) setOriginalUpdatedAt(data.originalUpdatedAt);

            setFormVersion(v => v + 1);

            if (res.warnings && res.warnings.length > 0) {
                toast.warning("Data Pulled with Warnings", {
                    description: (
                        <div className="flex flex-col gap-1">
                            <p>Property data pulled, but some issues occurred:</p>
                            <ul className="list-disc pl-4 text-xs">
                                {res.warnings.map((w: string, i: number) => (
                                    <li key={i}>{w}</li>
                                ))}
                            </ul>
                            <p className="mt-1">Please review images carefully.</p>
                        </div>
                    ),
                    duration: 8000
                });
            } else {
                toast.success("Data Pulled Successfully", {
                    description: "Property details and images have been imported. Please review before saving."
                });
            }

        } catch (e: any) {
            console.error(e);
            toast.error("Pull Failed", {
                description: e.message
            });
        } finally {
            setIsPulling(false);
        }
    };

    return (
        <form key={formVersion} action={handleSubmit} onSubmit={onFormSubmit} className="h-full flex flex-col overflow-hidden">
            <input type="hidden" name="id" value={property?.id || "new"} />
            <input type="hidden" name="locationId" value={locationId} />

            {/* Import Block */}
            {(!property?.id || property.id === 'new') && (
                <div className="bg-blue-50 p-4 border-b flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Label htmlFor="importId" className="whitespace-nowrap">Pull from Old CRM (ID):</Label>
                        <Input
                            id="importId"
                            value={importId}
                            onChange={(e) => setImportId(e.target.value)}
                            placeholder="e.g. 2981"
                            className="w-32 bg-white"
                        />
                    </div>
                    <Button
                        onClick={handlePull}
                        disabled={isPulling || !importId}
                        variant="secondary"
                        size="sm"
                    >
                        {isPulling ? "Pulling..." : "Pull Data"}
                    </Button>
                    <p className="text-xs text-muted-foreground ml-2">
                        Fetches details, pricing, and images. Review before saving.
                    </p>
                </div>
            )}

            <Tabs defaultValue="details" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-1 pt-1">
                    <TabsList className="grid w-full grid-cols-8">
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="pricing">Pricing</TabsTrigger>
                        <TabsTrigger value="location">Location</TabsTrigger>
                        <TabsTrigger value="specs">Specs</TabsTrigger>
                        <TabsTrigger value="publish">Publish</TabsTrigger>
                        <TabsTrigger value="media">Media</TabsTrigger>
                        <TabsTrigger value="stakeholders">Stakeholders</TabsTrigger>
                        <TabsTrigger value="notes">Notes</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto px-1">
                    <TabsContent value="details" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="title">Property Title</Label>
                                <Input id="title" name="title" defaultValue={property?.title} required />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="reference">Ref. No.</Label>
                                <Input id="reference" name="reference" defaultValue={property?.reference || ""} placeholder="e.g. REF-001" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="status">Status</Label>
                                <Select name="status" defaultValue={property?.status || "ACTIVE"}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ACTIVE">Active</SelectItem>
                                        <SelectItem value="RESERVED">Reserved</SelectItem>
                                        <SelectItem value="SOLD">Sold</SelectItem>
                                        <SelectItem value="RENTED">Rented</SelectItem>
                                        <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="goal">Goal</Label>
                                <Select name="goal" defaultValue={property?.goal || "SALE"}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select goal" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="SALE">For Sale</SelectItem>
                                        <SelectItem value="RENT">For Rent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="publicationStatus">Publication Status</Label>
                                <Select name="publicationStatus" defaultValue={property?.publicationStatus || "PUBLISHED"}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PUBLISHED">Published</SelectItem>
                                        <SelectItem value="PENDING">Pending</SelectItem>
                                        <SelectItem value="DRAFT">Draft</SelectItem>
                                        <SelectItem value="UNLISTED">Unlisted</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="category">Category</Label>
                                <Select
                                    name="category"
                                    value={selectedCategory}
                                    onValueChange={(value) => {
                                        setSelectedCategory(value);
                                        setSelectedType(""); // Reset type when category changes
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PROPERTY_TYPES.map((cat) => (
                                            <SelectItem key={cat.category_key} value={cat.category_key}>
                                                {cat.category_label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="type">Type</Label>
                                <Select
                                    name="type"
                                    value={selectedType}
                                    onValueChange={setSelectedType}
                                    disabled={!selectedCategory}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selectedCategory ? (
                                            PROPERTY_TYPES.find(c => c.category_key === selectedCategory)?.subtypes.map((sub) => (
                                                <SelectItem key={sub.subtype_key} value={sub.subtype_key}>
                                                    {sub.subtype_label}
                                                </SelectItem>
                                            ))
                                        ) : (
                                            <div className="p-2 text-sm text-muted-foreground">Please select a category first</div>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="condition">Condition</Label>
                                <Select name="condition" defaultValue={property?.condition || ""}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select condition" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PROPERTY_CONDITIONS.map((c) => (
                                            <SelectItem key={c.key} value={c.key}>
                                                {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="source">Source</Label>
                                <Select name="source" defaultValue={property?.source || "Estio"}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select source" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Estio">Estio</SelectItem>
                                        {PROPERTY_SOURCES.map((s) => (
                                            <SelectItem key={s.key} value={s.key}>
                                                {s.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="sortOrder">Sort Order</Label>
                                <Input type="number" id="sortOrder" name="sortOrder" defaultValue={property?.sortOrder || 0} />
                            </div>

                            <div className="flex items-center space-x-2 pt-8">
                                <Checkbox id="featured" name="featured" defaultChecked={property?.featured} />
                                <Label htmlFor="featured">Featured Property</Label>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <RichTextEditor
                                content={description}
                                onChange={setDescription}
                                placeholder="Property description..."
                                className="min-h-[150px]"
                            />
                            <input type="hidden" name="description" value={description} />
                        </div>
                    </TabsContent>

                    <TabsContent value="pricing" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="price">Price</Label>
                                <Input type="number" id="price" name="price" defaultValue={property?.price} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="currency">Currency</Label>
                                <Select name="currency" defaultValue={property?.currency || "EUR"}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select currency" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="EUR">EUR (€)</SelectItem>
                                        <SelectItem value="USD">USD ($)</SelectItem>
                                        <SelectItem value="GBP">GBP (£)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="rentalPeriod">Price Type (Rental Period)</Label>
                                <Select name="rentalPeriod" defaultValue={property?.rentalPeriod || "n/a"}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select period" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="n/a">n/a</SelectItem>
                                        <SelectItem value="/day">/day</SelectItem>
                                        <SelectItem value="/week">/week</SelectItem>
                                        <SelectItem value="/month">/month</SelectItem>
                                        <SelectItem value="/year">/year</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="communalFees">Communal Fees</Label>
                                <div className="flex items-center gap-2">
                                    <Input type="number" id="communalFees" name="communalFees" defaultValue={property?.communalFees} />
                                    <span className="text-sm text-gray-500">/mo</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="deposit">Deposit (Text)</Label>
                                <Input id="deposit" name="deposit" defaultValue={property?.deposit || ""} placeholder="e.g. 2 months rent" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="depositValue">Deposit Amount</Label>
                                <Input type="number" id="depositValue" name="depositValue" defaultValue={property?.depositValue} />
                            </div>
                            <div className="flex items-center space-x-2 pt-8">
                                <Checkbox id="priceIncludesCommunalFees" name="priceIncludesCommunalFees" defaultChecked={property?.priceIncludesCommunalFees} />
                                <Label htmlFor="priceIncludesCommunalFees">Price includes Communal Fees</Label>
                            </div>
                            <div className="flex items-center space-x-2 pt-8">
                                <Checkbox id="billsTransferable" name="billsTransferable" defaultChecked={property?.billsTransferable} />
                                <Label htmlFor="billsTransferable">Bills are Transferable</Label>
                            </div>
                        </div>
                    </TabsContent>



                    <TabsContent value="location" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="addressLine1">Address Line 1</Label>
                                <Input id="addressLine1" name="addressLine1" defaultValue={property?.addressLine1 || ""} />
                            </div>
                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="addressLine2">Address Line 2</Label>
                                <Input id="addressLine2" name="addressLine2" defaultValue={property?.addressLine2 || ""} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="city">City</Label>
                                <Input id="city" name="city" defaultValue={property?.city || ""} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="postalCode">Postal Code</Label>
                                <Input id="postalCode" name="postalCode" defaultValue={property?.postalCode || ""} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="propertyLocation">District/Region</Label>
                                <Select
                                    name="propertyLocation"
                                    value={selectedDistrict}
                                    onValueChange={(value) => {
                                        setSelectedDistrict(value);
                                        setSelectedArea(""); // Reset area when district changes
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select district" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PROPERTY_LOCATIONS.map((d) => (
                                            <SelectItem key={d.district_key} value={d.district_key}>
                                                {d.district_label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="propertyArea">Area/Village</Label>
                                <SearchableSelect
                                    name="propertyArea"
                                    value={selectedArea}
                                    onChange={setSelectedArea}
                                    options={selectedDistrict ? (
                                        PROPERTY_LOCATIONS.find(d => d.district_key === selectedDistrict)?.locations
                                            .slice()
                                            .sort((a, b) => a.label.localeCompare(b.label))
                                            .map((loc) => ({
                                                value: loc.key,
                                                label: loc.label
                                            })) || []
                                    ) : []}
                                    placeholder={selectedDistrict ? "Select area" : "Please select a district first"}
                                    searchPlaceholder="Search area..."
                                    disabled={!selectedDistrict}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="country">Country</Label>
                                <Input id="country" name="country" defaultValue={property?.country || "Cyprus"} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                            <div className="space-y-2">
                                <Label htmlFor="latitude">Latitude</Label>
                                <Input type="number" step="any" id="latitude" name="latitude" defaultValue={property?.latitude} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="longitude">Longitude</Label>
                                <Input type="number" step="any" id="longitude" name="longitude" defaultValue={property?.longitude} />
                            </div>

                        </div>


                    </TabsContent>


                    <TabsContent value="specs" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="bedrooms">Bedrooms</Label>
                                <Input type="number" id="bedrooms" name="bedrooms" defaultValue={property?.bedrooms} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="bathrooms">Bathrooms</Label>
                                <Input type="number" id="bathrooms" name="bathrooms" defaultValue={property?.bathrooms} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="areaSqm">Total Covered Area (sqm)</Label>
                                <Input type="number" id="areaSqm" name="areaSqm" defaultValue={property?.areaSqm} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="coveredAreaSqm">Internal Covered (sqm)</Label>
                                <Input type="number" id="coveredAreaSqm" name="coveredAreaSqm" defaultValue={property?.coveredAreaSqm} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="coveredVerandaSqm">Covered Veranda (sqm)</Label>
                                <Input type="number" id="coveredVerandaSqm" name="coveredVerandaSqm" defaultValue={property?.coveredVerandaSqm} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="uncoveredVerandaSqm">Uncovered Veranda (sqm)</Label>
                                <Input type="number" id="uncoveredVerandaSqm" name="uncoveredVerandaSqm" defaultValue={property?.uncoveredVerandaSqm} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="basementSqm">Basement (sqm)</Label>
                                <Input type="number" id="basementSqm" name="basementSqm" defaultValue={property?.basementSqm} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="plotAreaSqm">Plot Area (sqm)</Label>
                                <Input type="number" id="plotAreaSqm" name="plotAreaSqm" defaultValue={property?.plotAreaSqm} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="buildYear">Build Year</Label>
                                <Input type="number" id="buildYear" name="buildYear" defaultValue={property?.buildYear} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="floor">Floor</Label>
                                <Input type="number" id="floor" name="floor" defaultValue={property?.floor} />
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t">
                            <Label className="text-lg font-semibold">Features</Label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {FEATURE_CATEGORIES.map((category) => (
                                    <div key={category.label} className="space-y-3">
                                        <h4 className="font-medium text-sm text-muted-foreground">{category.label}</h4>
                                        <div className="grid grid-cols-1 gap-2">
                                            {category.items.map((feature) => (
                                                <div key={feature.key} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`feature-${feature.key}`}
                                                        name="features"
                                                        value={feature.key}
                                                        defaultChecked={property?.features?.includes(feature.key)}
                                                    />
                                                    <Label
                                                        htmlFor={`feature-${feature.key}`}
                                                        className="text-sm font-normal cursor-pointer"
                                                    >
                                                        {feature.label}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>



                    <TabsContent value="publish" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="slug">Slug (URL Path)</Label>
                                <Input id="slug" name="slug" defaultValue={property?.slug || ""} placeholder="auto-generated-if-empty" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="metaTitle">Meta Title</Label>
                                <Input id="metaTitle" name="metaTitle" defaultValue={property?.metaTitle || ""} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="metaKeywords">Meta Keywords</Label>
                                <Input id="metaKeywords" name="metaKeywords" defaultValue={property?.metaKeywords || ""} placeholder="comma, separated, keywords" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="metaDescription">Meta Description</Label>
                                <Textarea id="metaDescription" name="metaDescription" defaultValue={property?.metaDescription || ""} />
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t">
                            <Label className="text-lg font-semibold text-gray-700">Publishing Information</Label>
                            <div className="grid grid-cols-2 gap-6">
                                {/* Created By Column */}
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Created By</Label>

                                    {/* Display Logic: Prioritize Original Creator if imported */}
                                    <div className="font-medium text-sm">
                                        {property?.creator?.name ? (
                                            // Case 1: Linked to a real System User
                                            <span className="text-green-600 flex items-center gap-1">
                                                {property.creator.name}
                                                <span className="text-xs text-green-500 font-normal">(Linked)</span>
                                            </span>
                                        ) : originalCreatorName ? (
                                            // Case 2: Imported Name exists (Unlinked)
                                            <span className="text-gray-900">
                                                {originalCreatorName}
                                                <span className="block text-xs text-orange-500 font-normal">Imported (Unlinked)</span>
                                            </span>
                                        ) : (
                                            // Case 3: Standard System Creation
                                            <span className="text-gray-500">System / Current User</span>
                                        )}
                                    </div>

                                    {/* Edit Import Details - Always allow editing metadata to facilitate future linking */}
                                    <div className="p-3 bg-gray-50 rounded-md border space-y-2">
                                        <Label className="text-xs font-semibold">Legacy CRM Data</Label>
                                        <div className="space-y-4">
                                            <div>
                                                <Label className="text-xs text-muted-foreground">Original Name</Label>
                                                <Input
                                                    value={originalCreatorName}
                                                    onChange={(e) => setOriginalCreatorName(e.target.value)}
                                                    name="originalCreatorName"
                                                    className="mt-1"
                                                    placeholder="e.g. John Doe"
                                                    disabled={!!property?.creator}
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs text-muted-foreground">Original Email (for linking)</Label>
                                                <Input
                                                    value={originalCreatorEmail}
                                                    onChange={(e) => setOriginalCreatorEmail(e.target.value)}
                                                    name="originalCreatorEmail"
                                                    className="mt-1"
                                                    placeholder="e.g. john@example.com"
                                                    disabled={!!property?.creator}
                                                />
                                                <p className="text-[10px] text-muted-foreground pt-1">
                                                    {property?.creator?.name
                                                        ? "User linked. Fields are locked."
                                                        : "Enter email and save property to auto-link user."}
                                                </p>
                                            </div>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">
                                                Original Date
                                            </Label>
                                            <Input
                                                name="originalCreatedAt_display"
                                                value={originalCreatedAt ? new Date(originalCreatedAt).toLocaleString() : ""}
                                                readOnly
                                                className="h-8 text-sm bg-gray-100 text-gray-500"
                                            />
                                            {/* Hidden input to ensure value is submitted if not changed */}
                                            <input type="hidden" name="originalCreatedAt" value={originalCreatedAt} />
                                        </div>
                                    </div>
                                </div>

                                {/* Updated By Column */}
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Updated By</Label>
                                    <div className="font-medium text-sm">{property?.updater?.name || "System/Unknown"}</div>

                                    {/* Edit Import Details (Updated At) */}
                                    {originalUpdatedAt && (
                                        <div className="p-3 bg-gray-50 rounded-md border space-y-2 mt-6">
                                            <div>
                                                <Label className="text-xs text-muted-foreground">
                                                    Original Last Update
                                                </Label>
                                                <Input
                                                    name="originalUpdatedAt_display"
                                                    value={new Date(originalUpdatedAt).toLocaleString()}
                                                    readOnly
                                                    className="h-8 text-sm bg-gray-100 text-gray-500"
                                                />
                                                <input type="hidden" name="originalUpdatedAt" value={originalUpdatedAt} />
                                            </div>
                                        </div>
                                    )}
                                    {!originalUpdatedAt && property?.updatedAt && (
                                        <div className="text-sm text-muted-foreground">System: {new Date(property.updatedAt).toLocaleString()}</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </TabsContent>



                    <TabsContent value="media" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="space-y-6">
                            {/* Images Section */}
                            <div className="space-y-4">
                                <Label className="text-lg font-semibold">Images</Label>
                                {/* Legacy mediaUrls hidden input for backward compat if needed, but we rely on mediaJson now */}
                                <input type="hidden" name="mediaUrls" value={images.map(i => i.url).join(', ')} />
                                <input type="hidden" name="mediaJson" value={JSON.stringify(images)} />

                                <div className="space-y-4 mb-4">
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={handleDragEnd}
                                    >
                                        <SortableContext
                                            items={images.map(img => img.cloudflareImageId || img.url)}
                                            strategy={rectSortingStrategy}
                                        >
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                {images.map((img, index) => {
                                                    const uniqueId = img.cloudflareImageId || img.url;
                                                    return (
                                                        <SortableImage
                                                            key={uniqueId}
                                                            id={uniqueId}
                                                            index={index}
                                                            onRemove={() => handleRemoveMedia('image', index)}
                                                        >
                                                            {img.cloudflareImageId ? (
                                                                <CloudflareImage
                                                                    imageId={img.cloudflareImageId}
                                                                    variant="public"
                                                                    className="w-full h-full object-cover"
                                                                    width={300}
                                                                    height={300}
                                                                    alt={`Property Image ${index + 1}`}
                                                                />
                                                            ) : (
                                                                <img src={img.url} alt={`Property ${index + 1}`} className="w-full h-full object-cover" />
                                                            )}
                                                        </SortableImage>
                                                    );
                                                })}
                                            </div>
                                        </SortableContext>
                                    </DndContext>
                                </div>

                                <CloudflareImageUploader
                                    locationId={locationId}
                                    onUploaded={(imageId) => {
                                        // Construct URL for display/fallback
                                        // Uses the accountHash passed from server or empty string if missing (should be handled)
                                        const url = `https://imagedelivery.net/${process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH || accountHash || 'MISSING_HASH'}/${imageId}/public`;
                                        setImages(prev => [...prev, {
                                            url,
                                            cloudflareImageId: imageId,
                                            kind: 'IMAGE',
                                            sortOrder: prev.length
                                        }]);
                                    }}
                                    buttonLabel="Upload Image"
                                />
                            </div>

                            {/* Videos Section */}
                            <div className="space-y-4 pt-4 border-t">
                                <Label className="text-lg font-semibold">Videos</Label>
                                <input type="hidden" name="videoUrls" value={videoUrls.join('\n')} />

                                <div className="space-y-2 mb-4">
                                    {videoUrls.map((url, index) => (
                                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                                            <span className="text-sm truncate max-w-[80%]">{url}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveMedia('video', index)}
                                                className="text-red-500 hover:text-red-700"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <MediaUploader
                                    locationId={locationId}
                                    onUploadComplete={(url) => setVideoUrls(prev => [...prev, url])}
                                    acceptedTypes="video/*"
                                    label="drop your videos here"
                                />
                            </div>

                            {/* Documents Section */}
                            <div className="space-y-4 pt-4 border-t">
                                <Label className="text-lg font-semibold">Documents</Label>
                                <input type="hidden" name="documentUrls" value={documentUrls.join('\n')} />

                                <div className="space-y-2 mb-4">
                                    {documentUrls.map((url, index) => (
                                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                                            <span className="text-sm truncate max-w-[80%]">{url}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveMedia('document', index)}
                                                className="text-red-500 hover:text-red-700"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <MediaUploader
                                    locationId={locationId}
                                    onUploadComplete={(url) => setDocumentUrls(prev => [...prev, url])}
                                    acceptedTypes=".pdf,.doc,.docx"
                                    label="drop your documents here"
                                />
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="stakeholders" className="space-y-6 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        {/* Owner Section */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Owner Details</Label>
                            <div className="space-y-2">
                                <Label>Select Owner</Label>
                                <div className="flex gap-2">
                                    <SearchableSelect
                                        name="ownerId"
                                        value={selectedOwnerId}
                                        onChange={setSelectedOwnerId}
                                        options={contacts.map(c => {
                                            let label = c.name;
                                            if (c.email) label += ` (${c.email})`;
                                            if (c.phone) label += ` - ${c.phone}`;
                                            return { value: c.id, label };
                                        })}
                                        placeholder="Select Owner..."
                                        searchPlaceholder="Search contacts..."
                                        className="flex-1"
                                    />
                                    <ContactDialog
                                        locationId={locationId}
                                        roleName="Owner"
                                        onSuccess={(newContact) => {
                                            // Add or update contact in list
                                            setContacts(prev => {
                                                const exists = prev.some(c => c.id === newContact.id);
                                                if (exists) {
                                                    return prev.map(c => c.id === newContact.id ? newContact : c).sort((a, b) => a.name.localeCompare(b.name));
                                                }
                                                return [...prev, newContact].sort((a, b) => a.name.localeCompare(b.name));
                                            });
                                            setSelectedOwnerId(newContact.id);
                                        }}
                                    />
                                </div>
                                {selectedOwnerId && (() => {
                                    const owner = contacts.find(c => c.id === selectedOwnerId);
                                    if (!owner) return null;
                                    return (
                                        <div className="mt-2 p-3 bg-white rounded border text-sm space-y-1 relative group">
                                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <ContactDialog
                                                    locationId={locationId}
                                                    roleName="Owner"
                                                    contact={owner}
                                                    trigger={
                                                        <Button variant="ghost" size="icon" className="h-6 w-6">
                                                            <Pencil className="h-3 w-3" />
                                                        </Button>
                                                    }
                                                    onSuccess={(updatedContact) => {
                                                        setContacts(prev => prev.map(c => c.id === updatedContact.id ? updatedContact : c).sort((a, b) => a.name.localeCompare(b.name)));
                                                    }}
                                                />
                                            </div>
                                            <div className="font-semibold pr-6">{owner.name}</div>
                                            {owner.email && <div><span className="text-muted-foreground mr-2">Email:</span>{owner.email}</div>}
                                            {owner.phone && <div><span className="text-muted-foreground mr-2">Phone:</span>{owner.phone}</div>}
                                            {owner.message && (
                                                <div className="pt-2 border-t mt-2">
                                                    <span className="text-muted-foreground text-xs uppercase">Notes/Company:</span>
                                                    <div className="whitespace-pre-wrap text-gray-600">{owner.message}</div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Developer Section */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Developer Details</Label>
                            <div className="space-y-2">
                                <Label>Select Developer</Label>
                                <div className="flex gap-2">
                                    <SearchableSelect
                                        name="developerId"
                                        value={selectedDeveloperId}
                                        onChange={setSelectedDeveloperId}
                                        options={developers.map(c => ({ value: c.id, label: c.name }))}
                                        placeholder="Select Developer..."
                                        searchPlaceholder="Search companies..."
                                        className="flex-1"
                                    />
                                    <AddCompanyDialog
                                        locationId={locationId}
                                        type="Developer"
                                        onSuccess={(newCompany) => {
                                            setDevelopers(prev => [...prev, newCompany].sort((a, b) => a.name.localeCompare(b.name)));
                                            setSelectedDeveloperId(newCompany.id);
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* External Agent Section */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">External Agent Details</Label>
                            <div className="space-y-2">
                                <Label>Select Agent</Label>
                                <div className="flex gap-2">
                                    <SearchableSelect
                                        name="agentId"
                                        value={selectedAgentId}
                                        onChange={setSelectedAgentId}
                                        options={contacts.map(c => ({ value: c.id, label: c.name }))}
                                        placeholder="Select Agent..."
                                        searchPlaceholder="Search contacts..."
                                        className="flex-1"
                                    />
                                    <ContactDialog
                                        locationId={locationId}
                                        roleName="Agent"
                                        onSuccess={(newContact) => {
                                            // Add or update contact in list
                                            setContacts(prev => {
                                                const exists = prev.some(c => c.id === newContact.id);
                                                if (exists) {
                                                    return prev.map(c => c.id === newContact.id ? newContact : c).sort((a, b) => a.name.localeCompare(b.name));
                                                }
                                                return [...prev, newContact].sort((a, b) => a.name.localeCompare(b.name));
                                            });
                                            setSelectedAgentId(newContact.id);
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="notes" className="space-y-6 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        {/* Internal Property Notes */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Internal Property Notes <span className="text-sm font-normal text-gray-500">(notes specific to this property & internal use only)</span></Label>
                            <div className="space-y-2">
                                <Label htmlFor="internalNotes">Property Notes</Label>
                                <Textarea id="internalNotes" name="internalNotes" defaultValue={property?.internalNotes || ""} className="min-h-[150px]" />
                            </div>
                        </div>

                        {/* Developer / Agent Ref. No URL */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Developer / Agent Ref. No URL</Label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="agentRef">Agent Ref.</Label>
                                    <Input id="agentRef" name="agentRef" defaultValue={property?.agentRef || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="agentUrl">Agent URL</Label>
                                    <Input id="agentUrl" name="agentUrl" defaultValue={property?.agentUrl || ""} />
                                </div>
                            </div>
                        </div>

                        {/* Project / Development Details */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Project / Development Details</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="projectName">Project Name</Label>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <SearchableSelect
                                                name="projectIdSelect"
                                                value={selectedProjectId}
                                                onChange={(val) => {
                                                    setSelectedProjectId(val);
                                                    setFormVersion(v => v + 1); // Rerender
                                                }}
                                                options={projects.map(p => ({ value: p.id, label: p.name }))}
                                                placeholder="Select Project..."
                                                searchPlaceholder="Search projects..."
                                                className="w-full"
                                            />
                                        </div>
                                        {/* Edit Project Button */}
                                        {selectedProjectId && (() => {
                                            const proj = projects.find(p => p.id === selectedProjectId);
                                            if (proj) {
                                                return (
                                                    <ProjectDialog
                                                        locationId={locationId}
                                                        project={proj}
                                                        triggerButton={
                                                            <Button type="button" variant="outline" size="icon" title="Edit Project">
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                        }
                                                        onSuccess={(updatedProject) => {
                                                            setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p).sort((a, b) => a.name.localeCompare(b.name)));
                                                        }}
                                                    />
                                                )
                                            }
                                            return null;
                                        })()}

                                        <ProjectDialog
                                            locationId={locationId}
                                            onSuccess={(newProject) => {
                                                setProjects(prev => [...prev, newProject].sort((a, b) => a.name.localeCompare(b.name)));
                                                setSelectedProjectId(newProject.id);
                                            }}
                                            triggerButton={
                                                <Button type="button" variant="outline" size="icon" title="Create New Project">
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            }
                                        />
                                    </div>
                                    <input type="hidden" name="projectId" value={selectedProjectId} />
                                    <input type="hidden" name="projectName" value={projects.find(p => p.id === selectedProjectId)?.name || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="unitNumber">Flat / House No</Label>
                                    <Input id="unitNumber" name="unitNumber" defaultValue={property?.unitNumber || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="managementCompany">Management Company</Label>
                                    <div className="flex gap-2">
                                        <SearchableSelect
                                            name="managementCompanyId"
                                            value={selectedManagementCompanyId}
                                            onChange={setSelectedManagementCompanyId}
                                            options={managementCompanies.map(c => ({ value: c.id, label: c.name }))}
                                            placeholder="Select Management Company..."
                                            searchPlaceholder="Search companies..."
                                            className="flex-1"
                                        />
                                        <AddCompanyDialog
                                            locationId={locationId}
                                            type="Management"
                                            onSuccess={(newCompany) => {
                                                setManagementCompanies(prev => [...prev, newCompany].sort((a, b) => a.name.localeCompare(b.name)));
                                                setSelectedManagementCompanyId(newCompany.id);
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Key Holder, Viewings and Directions */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Key Holder, Viewings and Directions</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="keyHolder">Key Holder</Label>
                                    <Input id="keyHolder" name="keyHolder" defaultValue={property?.keyHolder || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="keyBoxCode">Keybox Passcode</Label>
                                    <Input id="keyBoxCode" name="keyBoxCode" defaultValue={property?.keyBoxCode || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="officeKeyNumber">Keys in Office No.</Label>
                                    <Input id="officeKeyNumber" name="officeKeyNumber" defaultValue={property?.officeKeyNumber || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="occupancyStatus">Occupancy</Label>
                                    <Input id="occupancyStatus" name="occupancyStatus" defaultValue={property?.occupancyStatus || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="viewingContact">Contact for Viewings</Label>
                                    <Input id="viewingContact" name="viewingContact" defaultValue={property?.viewingContact || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="viewingNotes">Notes for Viewings</Label>
                                    <Input id="viewingNotes" name="viewingNotes" defaultValue={property?.viewingNotes || ""} />
                                </div>
                                <div className="space-y-2 col-span-2">
                                    <Label htmlFor="viewingDirections">Directions for Viewings</Label>
                                    <Textarea id="viewingDirections" name="viewingDirections" defaultValue={property?.viewingDirections || ""} className="min-h-[100px]" />
                                </div>
                            </div>
                        </div>

                        {/* Legal and Financial */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Legal and Financial</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="lawyer">Property Lawyer</Label>
                                    <Input id="lawyer" name="lawyer" defaultValue={property?.lawyer || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="loanDetails">Property Loan</Label>
                                    <Input id="loanDetails" name="loanDetails" defaultValue={property?.loanDetails || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="purchasePrice">Purchase Price</Label>
                                    <Input type="number" id="purchasePrice" name="purchasePrice" defaultValue={property?.purchasePrice} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="lowestOffer">Lowest Offer</Label>
                                    <Input type="number" id="lowestOffer" name="lowestOffer" defaultValue={property?.lowestOffer} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="landSurveyValue">Land Survey Value</Label>
                                    <Input type="number" id="landSurveyValue" name="landSurveyValue" defaultValue={property?.landSurveyValue} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="estimatedValue">Property Estimated Value</Label>
                                    <Input type="number" id="estimatedValue" name="estimatedValue" defaultValue={property?.estimatedValue} />
                                </div>
                            </div>
                        </div>

                        {/* Agency Agreement */}
                        <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700">Agency Agreement</Label>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="agencyAgreement">Agency Agreement (sole/multi)</Label>
                                    <Input id="agencyAgreement" name="agencyAgreement" defaultValue={property?.agencyAgreement || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="commission">Agreed Commission</Label>
                                    <Input id="commission" name="commission" defaultValue={property?.commission || ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="agreementDate">Agreement Date</Label>
                                    <Input type="date" id="agreementDate" name="agreementDate" defaultValue={property?.agreementDate ? new Date(property.agreementDate).toISOString().split('T')[0] : ""} />
                                </div>
                                <div className="space-y-2 col-span-3">
                                    <Label htmlFor="agreementNotes">Agreement Notes</Label>
                                    <Textarea id="agreementNotes" name="agreementNotes" defaultValue={property?.agreementNotes || ""} className="min-h-[100px]" />
                                </div>
                            </div>
                        </div>
                    </TabsContent>



                </div>
            </Tabs>

            <div className="flex gap-4 pt-4 border-t mt-auto px-1 pb-4 shrink-0">
                <Button id="save-property-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save Property"}
                </Button>
                <Button variant="outline" type="button" onClick={() => onSuccess?.()} disabled={isSubmitting}>
                    Cancel
                </Button>

                {property?.id && property.id !== 'new' && (
                    <Button
                        type="button"
                        variant="secondary"
                        className="ml-auto bg-orange-100 text-orange-900 hover:bg-orange-200 border-orange-200"
                        onClick={handlePushToCrm}
                        disabled={isPushing || isSubmitting}
                    >
                        {isPushing ? "Pushing..." : "Push to Old CRM"}
                    </Button>
                )}
            </div>
        </form>
    );
}
