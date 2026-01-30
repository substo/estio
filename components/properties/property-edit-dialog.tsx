"use client";

import { Project } from "@prisma/client";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import PropertyForm from "@/app/(main)/admin/properties/_components/property-form";

interface PropertyEditDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    property: any;
    locationId: string;
    contactsData?: { id: string; name: string }[];
    developersData?: { id: string; name: string }[];
    managementCompaniesData?: { id: string; name: string }[];
    projectsData?: Project[];
    onSuccess?: (savedProperty?: any) => void;
}

export function PropertyEditDialog({
    isOpen,
    onOpenChange,
    property,
    locationId,
    contactsData,
    developersData,
    managementCompaniesData,
    projectsData,
    onSuccess
}: PropertyEditDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        {property?.id && property.id !== "new"
                            ? `Edit Property${property.reference ? ` - Ref: ${property.reference}` : ''}`
                            : "Add Property"}
                    </DialogTitle>
                    <DialogDescription>
                        Make changes to the property details below.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden p-1">
                    <PropertyForm
                        property={property}
                        locationId={locationId}
                        onSuccess={(savedProperty) => {
                            // If parent provided onSuccess, call it with result
                            if (onSuccess) onSuccess(savedProperty);
                            // Otherwise just close
                            else onOpenChange(false);
                        }}
                        contactsData={contactsData}
                        developersData={developersData}
                        managementCompaniesData={managementCompaniesData}
                        projectsData={projectsData}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
