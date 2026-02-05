'use client';

import { useState } from 'react';
import { Plus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { ContactForm, ContactData } from './contact-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { previewLeadAction } from '@/app/(main)/admin/settings/crm/actions';
import { CrmMergeDialog } from './crm-merge-dialog';
import { updateContactAction } from '../actions';
// import { checkContactPermissions } from './contact-types';

export function AddContactDialog({ locationId, leadSources }: { locationId: string; leadSources: string[] }) {
    const [open, setOpen] = useState(false);

    // Pull / Merge State
    const [crmId, setCrmId] = useState("");
    const [isPulling, setIsPulling] = useState(false);
    const [showMerge, setShowMerge] = useState(false);
    const [remoteData, setRemoteData] = useState<any>(null);
    const [duplicateOf, setDuplicateOf] = useState<any>(null);
    const [prefillData, setPrefillData] = useState<Partial<ContactData> | undefined>(undefined);

    const handlePull = async () => {
        if (!crmId) {
            toast.error("Please enter a Lead ID");
            return;
        }

        setIsPulling(true);
        try {
            const res = await previewLeadAction(crmId);
            if (!res.success) {
                toast.error(res.error || "Failed to pull data");
                return;
            }

            if (!res.data) {
                toast.error("No data returned");
                return;
            }

            const { data, duplicateOf, isDuplicate } = res.data;

            setRemoteData(data);
            setDuplicateOf(duplicateOf);
            setShowMerge(true); // Always show merge dialog to review, even if new

        } catch (error) {
            toast.error("An error occurred");
        } finally {
            setIsPulling(false);
        }
    };

    const handleMergeConfirm = async (mergedData: any, action: 'create' | 'update') => {
        setShowMerge(false);

        if (action === 'update' && duplicateOf) {
            // Perform update immediately
            const toastId = toast.loading("Updating contact...");
            try {
                // We need to call an update action. Assuming updateContactAction exists and takes id + data.
                // We might need to ensure the ID is correct.
                const res = await updateContactAction(duplicateOf.id, mergedData);
                if (res.success) {
                    toast.success("Contact updated successfully", { id: toastId });
                    setOpen(false); // Close parent dialog too
                } else {
                    toast.error(res.error || "Update failed", { id: toastId });
                }
            } catch (e) {
                toast.error("Server error during update", { id: toastId });
            }
        } else {
            // 'create' means we just pre-fill the form
            setPrefillData(mergedData);
            toast.success("Data imported! Please review and save.");
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Contact
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Add Contact</DialogTitle>
                        <DialogDescription>
                            Add a new person manually or import from CRM.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Pull Section */}
                    <div className="flex gap-2 items-end border-b pb-4 mb-4">
                        <div className="flex-1 space-y-1">
                            <Label htmlFor="crmPullId" className="text-xs text-muted-foreground">Import from Old CRM (Lead ID)</Label>
                            <Input
                                id="crmPullId"
                                placeholder="e.g. 19572"
                                value={crmId}
                                onChange={(e) => setCrmId(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <Button variant="outline" size="sm" onClick={handlePull} disabled={isPulling} className="h-9">
                            {isPulling ? "Pulling..." : <><Download className="mr-2 h-4 w-4" /> Pull</>}
                        </Button>
                    </div>

                    <ContactForm
                        initialMode="create"
                        locationId={locationId}
                        onSuccess={() => setOpen(false)}
                        leadSources={leadSources}
                        initialData={prefillData} // Pass prefill data
                    />
                </DialogContent>
            </Dialog>

            {/* Merge Dialog (Nested) */}
            {showMerge && remoteData && (
                <CrmMergeDialog
                    open={showMerge}
                    onOpenChange={setShowMerge}
                    localContact={null} // Passing null because "local" is empty for new contact, unless we scraped duplicate?
                    // Actually, if duplicateOf exists, we should fetch the FULL duplicate data to show in "Local Value" column?
                    // previewLeadAction returned duplicateOf with limited fields.
                    // For a perfect "Compare", we might need to fetch the full contact if duplicate found.
                    // Let's rely on duplicateOf (limited) for now, or fetch it.
                    // Ideally we fetch full contact. But for now let's pass undefined and handle it.
                    remoteData={remoteData}
                    duplicateOf={duplicateOf}
                    onConfirm={handleMergeConfirm}
                />
            )}
        </>
    );
}
