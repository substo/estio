"use client";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, ExternalLink, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useState } from "react";
import { EditContactDialog } from "./edit-contact-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ContactData } from "./contact-form";
import { CONTACT_TYPE_CONFIG, ContactType, DEFAULT_CONTACT_TYPE } from "./contact-types";
import { OutlookSyncManager } from "./outlook-sync-manager";


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
    return (
        <div className="space-y-4 pt-6 first:pt-0">
            <h3 className="text-lg font-semibold border-b pb-2">{title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {children}
            </div>
        </div>
    );
};

interface ContactViewProps {
    contact: any; // Using any for flexibility to accommodate relations, but ideally should be typed
    propertyMap?: Record<string, string>; // ID -> Title/Ref
    userMap?: Record<string, string>; // ID -> Name
    leadSources?: string[];
    variant?: 'page' | 'modal';
    isOutlookConnected?: boolean;
    isGoogleConnected?: boolean;
    isGhlConnected?: boolean;
}

export default function ContactView({
    contact,
    propertyMap = {},
    userMap = {},
    leadSources = [],
    variant = 'page',
    isOutlookConnected = false,
    isGoogleConnected = false,
    isGhlConnected = false
}: ContactViewProps) {
    const router = useRouter();
    const [outlookOpen, setOutlookOpen] = useState(false);

    const resolveProperty = (id: string) => {
        return propertyMap[id] || id;
    };

    // Format arrays of IDs to lists of names
    const renderPropertyList = (ids: string[]) => {
        if (!ids || ids.length === 0) return null;
        return (
            <ul className="list-disc pl-5 space-y-1">
                {ids.map(id => (
                    <li key={id}>
                        <Link href={`/admin/properties/${id}/view`} className="text-blue-600 hover:underline">
                            {resolveProperty(id)}
                        </Link>
                    </li>
                ))}
            </ul>
        );
    };

    // Format Roles
    const propertyRoles = contact.propertyRoles || [];
    const companyRoles = contact.companyRoles || [];
    const viewings = contact.viewings || []; // Assuming these might be passed attached

    // Determine Config
    const contactType = (contact.contactType as ContactType) || DEFAULT_CONTACT_TYPE;
    const config = CONTACT_TYPE_CONFIG[contactType];

    return (
        <div className={variant === 'modal' ? "flex flex-col h-full overflow-hidden" : "space-y-8 pb-12"}>
            {/* Header / Actions - Only show in Page variant */}
            {variant === 'page' && (
                <div className="flex items-center justify-between">
                    <Button variant="ghost" asChild>
                        <Link href="/admin/contacts">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to List
                        </Link>
                    </Button>
                    <div className="flex gap-2">
                        {contact.email && isOutlookConnected && (
                            <Button variant="outline" onClick={() => setOutlookOpen(true)}>
                                <Mail className="mr-2 h-4 w-4" />
                                Outlook Emails
                            </Button>
                        )}
                        <EditContactDialog
                            contact={contact}
                            leadSources={leadSources}
                            isGoogleConnected={isGoogleConnected}
                            isGhlConnected={isGhlConnected}
                            trigger={
                                <Button>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit Contact
                                </Button>
                            }
                        />
                    </div>
                </div>
            )}

            {/* Content Container - Scrollable in Modal, Normal in Page */}
            <div className={variant === 'modal' ? "flex-1 overflow-y-auto px-1" : ""}>
                <div className="space-y-6 max-w-5xl mx-auto bg-card p-8 rounded-xl shadow-sm border">

                    {/* 1. KEY DETAILS */}
                    <DisplaySection title="Key Details">
                        <DisplayField label="Name" value={contact.name} />
                        <DisplayField label="Email" value={contact.email} />
                        <DisplayField label="Phone" value={contact.phone} />
                        {contact.contactType && <DisplayField label="Type" value={contact.contactType} />}
                        <DisplayField label="Status" value={contact.status} />
                        <DisplayField label="Status" value={contact.status} />
                        {config.showLeadFields && <DisplayField label="Heat Score" value={contact.heatScore} />}
                        <DisplayField label="Created At" value={contact.createdAt ? format(new Date(contact.createdAt), 'dd/MM/yyyy') : null} />
                        <DisplayField label="Updated At" value={contact.updatedAt ? format(new Date(contact.updatedAt), 'dd/MM/yyyy') : null} />
                    </DisplaySection>

                    {/* 2. LEAD DETAILS */}
                    {config.showLeadFields && (
                        <DisplaySection title="Lead Details">
                            <DisplayField label="Goal" value={contact.leadGoal} />
                            <DisplayField label="Priority" value={contact.leadPriority} />
                            <DisplayField label="Stage" value={contact.leadStage} />
                            <DisplayField label="Source" value={contact.leadSource} />
                            <DisplayField label="Assigned Agent" value={contact.leadAssignedToAgent ? (userMap[contact.leadAssignedToAgent] || contact.leadAssignedToAgent) : null} />
                            <DisplayField label="Next Action" value={contact.leadNextAction} />
                            <DisplayField label="Follow Up Date" value={contact.leadFollowUpDate ? format(new Date(contact.leadFollowUpDate), 'dd/MM/yyyy') : null} />
                        </DisplaySection>
                    )}

                    {/* 3. REQUIREMENTS */}
                    {config.visibleTabs.includes('requirements') && (
                        <DisplaySection title="Requirements">
                            <DisplayField label="Status" value={contact.requirementStatus} />
                            <DisplayField label="Condition" value={contact.requirementCondition} />
                            <DisplayField label="District" value={contact.requirementDistrict} />
                            <DisplayField label="Bedrooms" value={contact.requirementBedrooms} />
                            <DisplayField label="Price Range" value={`${contact.requirementMinPrice} - ${contact.requirementMaxPrice}`} />

                            {/* Arrays */}
                            {contact.requirementPropertyTypes && contact.requirementPropertyTypes.length > 0 && (
                                <div className="col-span-2">
                                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Property Types</Label>
                                    <div className="font-medium text-sm p-2 bg-muted/30 rounded-md border border-border/50 min-h-[36px] flex flex-wrap gap-2">
                                        {contact.requirementPropertyTypes.map((t: string) => (
                                            <span key={t} className="bg-white border px-2 py-0.5 rounded shadow-sm text-xs">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {contact.requirementPropertyLocations && contact.requirementPropertyLocations.length > 0 && (
                                <div className="col-span-2">
                                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Locations</Label>
                                    <div className="font-medium text-sm p-2 bg-muted/30 rounded-md border border-border/50 min-h-[36px] flex flex-wrap gap-2">
                                        {contact.requirementPropertyLocations.map((l: string) => (
                                            <span key={l} className="bg-white border px-2 py-0.5 rounded shadow-sm text-xs">{l}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <DisplayField label="Other Details" value={contact.requirementOtherDetails} className="col-span-2" />
                        </DisplaySection>
                    )}


                    {/* 4. MATCHING */}
                    {config.visibleTabs.includes('matching') && (
                        <DisplaySection title="Matching">
                            <DisplayField label="Criteria" value={contact.matchingPropertiesToMatch} />
                            <DisplayField label="Email Matched Properties" value={contact.matchingEmailMatchedProperties} />
                            <DisplayField label="Frequency" value={contact.matchingNotificationFrequency} />
                            <DisplayField label="Last Match Date" value={contact.matchingLastMatchDate ? format(new Date(contact.matchingLastMatchDate), 'dd/MM/yyyy') : 'Never'} />
                        </DisplaySection>
                    )}

                    {/* 5. LISTS */}
                    {config.visibleTabs.includes('properties') && (contact.propertiesInterested?.length > 0 || contact.propertiesInspected?.length > 0 || contact.propertiesMatched?.length > 0) && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-semibold border-b pb-2">Property Lists</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {contact.propertiesInterested?.length > 0 && (
                                    <div className="space-y-2">
                                        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Interested</Label>
                                        <div className="p-4 bg-muted/30 rounded-md border border-border/50">
                                            {renderPropertyList(contact.propertiesInterested)}
                                        </div>
                                    </div>
                                )}
                                {contact.propertiesInspected?.length > 0 && (
                                    <div className="space-y-2">
                                        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Inspected</Label>
                                        <div className="p-4 bg-muted/30 rounded-md border border-border/50">
                                            {renderPropertyList(contact.propertiesInspected)}
                                        </div>
                                    </div>
                                )}
                                {contact.propertiesMatched?.length > 0 && (
                                    <div className="space-y-2">
                                        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Matched</Label>
                                        <div className="p-4 bg-muted/30 rounded-md border border-border/50">
                                            {renderPropertyList(contact.propertiesMatched)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 6. ROLES */}
                    {(propertyRoles.length > 0 || companyRoles.length > 0) && (
                        <DisplaySection title="Roles & Associations">
                            {propertyRoles.map((role: any) => (
                                <DisplayField
                                    key={role.id}
                                    label={`${role.role} at Property`}
                                    value={
                                        role.property ? (
                                            <Link href={`/admin/properties/${role.property.id}/view`} className="text-blue-600 hover:underline">
                                                {role.property.reference || role.property.title}
                                            </Link>
                                        ) : 'Unknown Property'
                                    }
                                />
                            ))}
                            {companyRoles.map((role: any) => (
                                <DisplayField
                                    key={role.id}
                                    label={`${role.role} at Company`}
                                    value={role.company?.name || 'Unknown Company'}
                                />
                            ))}
                        </DisplaySection>
                    )}


                </div>
            </div>

            {/* Modal Footer with Edit Action */}
            {variant === 'modal' && (
                <div className="pt-4 border-t bg-background mt-auto">
                    <DialogFooter>
                        <Button type="button" onClick={() => router.push(`/admin/contacts/${contact.id}/edit`)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit Contact
                        </Button>
                    </DialogFooter>
                </div>
            )}

            {/* Outlook Sync Manager Dialog */}
            {contact.email && (
                <OutlookSyncManager
                    contactEmail={contact.email}
                    contactName={contact.name || 'Contact'}
                    open={outlookOpen}
                    onOpenChange={setOutlookOpen}
                />
            )}
        </div>
    );
}
