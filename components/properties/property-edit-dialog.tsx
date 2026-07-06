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
    precisionRemoveEnabled?: boolean;
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
    precisionRemoveEnabled = false,
    contactsData,
    developersData,
    managementCompaniesData,
    projectsData,
    onSuccess
}: PropertyEditDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:w-[94vw] sm:max-w-6xl sm:rounded-lg">
                <DialogHeader className="shrink-0 border-b px-4 pb-3 pt-4 pr-12 text-left sm:px-6 sm:pb-4 sm:pt-5 sm:pr-12">
                    <DialogTitle className="text-xl sm:text-2xl">
                        {property?.id && property.id !== "new"
                            ? `Edit Property${property.reference ? ` - Ref: ${property.reference}` : ''}`
                            : "Add Property"}
                    </DialogTitle>
                    <DialogDescription className="text-sm sm:text-base">
                        Make changes to the property details below.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-hidden px-3 py-2 sm:px-5 sm:py-4">
                    <PropertyForm
                        property={property}
                        locationId={locationId}
                        precisionRemoveEnabled={precisionRemoveEnabled}
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
