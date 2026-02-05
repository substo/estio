'use client';

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
// import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ArrowRight, Save, X } from "lucide-react";
import { ContactData } from "./contact-form";

interface CrmMergeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    localContact?: Partial<ContactData> | null; // Null if new contact
    remoteData: any;
    duplicateOf?: { id: string, name: string | null } | null;
    onConfirm: (mergedData: any, action: 'create' | 'update') => void;
}

// Field definitions for the UI
const MERGE_FIELDS = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'leadGoal', label: 'Goal' },
    { key: 'leadPriority', label: 'Priority' },
    { key: 'leadStatus', label: 'Status' },
    { key: 'requirementStatus', label: 'Req. Status' },
    { key: 'requirementMinPrice', label: 'Min Price' },
    { key: 'requirementMaxPrice', label: 'Max Price' },
    { key: 'requirementBedrooms', label: 'Bedrooms' },
    { key: 'requirementDistrict', label: 'District' },
    { key: 'requirementCondition', label: 'Condition' },
    { key: 'requirementPropertyTypes', label: 'Property Types', isArray: true },
    { key: 'requirementOtherDetails', label: 'Notes' },
];

export function CrmMergeDialog({ open, onOpenChange, localContact, remoteData, duplicateOf, onConfirm }: CrmMergeDialogProps) {
    // State to track which source to use for each field: 'local' | 'remote'
    // For arrays, maybe we allow 'merge'? For now, strictly 'local' vs 'remote'
    const [selection, setSelection] = useState<Record<string, 'local' | 'remote'>>({});

    // Initialize selection
    useEffect(() => {
        if (!open) return;

        const initialSelection: Record<string, 'local' | 'remote'> = {};
        MERGE_FIELDS.forEach(field => {
            // Default to remote if local is empty/null, otherwise keep local (safe default)
            const localVal = localContact?.[field.key as keyof ContactData];
            const remoteVal = remoteData[field.key];

            // If we are creating new (no localContact), always remote
            if (!localContact) {
                initialSelection[field.key] = 'remote';
            } else {
                // If local is missing but remote exists, take remote
                if ((!localVal || (Array.isArray(localVal) && localVal.length === 0)) && remoteVal) {
                    initialSelection[field.key] = 'remote';
                } else {
                    initialSelection[field.key] = 'local';
                }
            }
        });
        setSelection(initialSelection);
    }, [open, localContact, remoteData]);

    const handleToggle = (key: string, source: 'local' | 'remote') => {
        setSelection(prev => ({ ...prev, [key]: source }));
    };

    const handleConfirm = () => {
        const finalData: any = { ...localContact }; // Start with local

        Object.entries(selection).forEach(([key, source]) => {
            if (source === 'remote') {
                finalData[key] = remoteData[key];
            }
            // If source is local, it's already in finalData (or we might need to be explicit if localContact was partial)
            else if (source === 'local' && localContact) {
                finalData[key] = localContact[key as keyof ContactData];
            }
        });

        // Always merge payload metadata if available
        if (remoteData.payload) {
            finalData.payload = { ...(localContact?.payload as object || {}), ...remoteData.payload };
        }

        onConfirm(finalData, duplicateOf ? 'update' : 'create');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Import from CRM</DialogTitle>
                    <DialogDescription>
                        {duplicateOf
                            ? `Duplicate found: "${duplicateOf.name}". Select fields to update.`
                            : "Review and select data to import."}
                    </DialogDescription>
                </DialogHeader>

                {duplicateOf && (
                    <Alert variant="default" className="mb-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Duplicate Detected</AlertTitle>
                        <AlertDescription>
                            This lead matches an existing contact by Email or Phone.
                            Confirming will update the existing record <strong>{duplicateOf.name}</strong>.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="grid grid-cols-3 gap-4 font-bold p-2 border-b bg-muted/50">
                    <div>Field</div>
                    <div>Local Value</div>
                    <div>CRM Value</div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    <div className="space-y-1 p-2">
                        {MERGE_FIELDS.map(field => {
                            const localVal = localContact?.[field.key as keyof ContactData];
                            const remoteVal = remoteData[field.key];
                            const isSelectedRemote = selection[field.key] === 'remote';

                            // Format values for display
                            const fmt = (v: any) => {
                                if (Array.isArray(v)) return v.join(', ');
                                if (typeof v === 'boolean') return v ? 'Yes' : 'No';
                                if (!v) return <span className="text-muted-foreground italic">Empty</span>;
                                return String(v);
                            };

                            const isDiff = JSON.stringify(localVal) !== JSON.stringify(remoteVal);
                            const rowClass = isDiff ? "bg-yellow-50/50 dark:bg-yellow-900/10" : "";

                            return (
                                <div key={field.key} className={`grid grid-cols-3 gap-4 items-center p-2 rounded hover:bg-muted/50 ${rowClass}`}>
                                    <div className="font-medium text-sm text-muted-foreground">{field.label}</div>

                                    {/* Local Option */}
                                    <div
                                        className={`p-2 rounded cursor-pointer border ${selection[field.key] === 'local' ? 'border-primary bg-primary/5' : 'border-transparent'}`}
                                        onClick={() => handleToggle(field.key, 'local')}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Checkbox checked={selection[field.key] === 'local'} id={`local-${field.key}`} />
                                            <Label htmlFor={`local-${field.key}`} className="cursor-pointer truncate block w-full">
                                                {fmt(localVal)}
                                            </Label>
                                        </div>
                                    </div>

                                    {/* Remote Option */}
                                    <div
                                        className={`p-2 rounded cursor-pointer border ${selection[field.key] === 'remote' ? 'border-primary bg-primary/5' : 'border-transparent'}`}
                                        onClick={() => handleToggle(field.key, 'remote')}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Checkbox checked={selection[field.key] === 'remote'} id={`remote-${field.key}`} />
                                            <Label htmlFor={`remote-${field.key}`} className="cursor-pointer truncate block w-full">
                                                {fmt(remoteVal)}
                                            </Label>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <DialogFooter className="mt-4 gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm}>
                        <Save className="mr-2 h-4 w-4" />
                        {duplicateOf ? "Update Contact" : "Import Data"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
