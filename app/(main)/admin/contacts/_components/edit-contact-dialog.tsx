'use client';

import { useState, useEffect } from 'react';
import { Pencil, Trash, RefreshCw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewLeadAction } from '@/app/(main)/admin/settings/crm/actions';
import { CrmMergeDialog } from './crm-merge-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { createViewing, updateViewing, deleteViewing, checkPropertyOwnerEmail, deleteContact, updateContactAction } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { getPropertiesForSelect, getUsersForSelect, getContactViewings, getContactHistory } from '../fetch-helpers';

import { SearchableSelect } from './searchable-select';
import { HistoryTab } from './history-tab';
import { DeleteContactDialog } from './delete-contact-dialog';

import { ContactForm, type ContactData } from './contact-form';
import { CONTACT_TYPE_CONFIG, type ContactType } from './contact-types';
import { MergeContactDialog } from './merge-contact-dialog';
import { ContactTaskManager } from '@/components/tasks/contact-task-manager';
import { ContactViewingManager } from '@/components/tasks/contact-viewing-manager';

export function EditContactForm({ contact, onSuccess, onDelete, leadSources, initialMode = 'edit', isOutlookConnected = false, isGoogleConnected = false, isGhlConnected = false }: { contact: ContactData; onSuccess?: () => void; onDelete?: () => void; leadSources: string[]; initialMode?: 'view' | 'edit' | 'create'; isOutlookConnected?: boolean; isGoogleConnected?: boolean; isGhlConnected?: boolean }) {
    const { toast } = useToast();
    const [isDeleting, setIsDeleting] = useState(false);

    // Viewings State (Now handled largely by ContactViewingManager, keeping only what's needed for other tabs)
    const [properties, setProperties] = useState<{ id: string; title: string }[]>([]);
    const [loadingData, setLoadingData] = useState(false);

    const [history, setHistory] = useState<any[]>([]);

    // CRM Pull State
    const [pullModalOpen, setPullModalOpen] = useState(false);
    const [crmLeadId, setCrmLeadId] = useState('');
    const [isPulling, setIsPulling] = useState(false);
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [remoteData, setRemoteData] = useState<any>(null);

    // Fetch data for Viewings and Modal
    useEffect(() => {
        const fetchData = async () => {
            setLoadingData(true);
            try {
                const [props, hist] = await Promise.all([
                    getPropertiesForSelect(contact.locationId),
                    getContactHistory(contact.id)
                ]);
                setProperties(props);
                setHistory(hist);
            } catch (e) {
                console.error("Error fetching data", e);
            } finally {
                setLoadingData(false);
            }
        };
        fetchData();
    }, [contact.locationId, contact.id]);



    const handlePullFromCrm = async () => {
        if (!crmLeadId) {
            toast({ title: "Error", description: "Please enter a CRM Lead ID", variant: "destructive" });
            return;
        }
        setIsPulling(true);
        try {
            const result = await previewLeadAction(crmLeadId);
            if (result.success) {
                setRemoteData(result.data?.data);
                setPullModalOpen(false); // Close ID input dialog
                setMergeModalOpen(true); // Open Merge Dialog
                setCrmLeadId('');
            } else {
                toast({ title: "Error", description: result.error || "Failed to pull lead", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
        } finally {
            setIsPulling(false);
        }
    };

    const handleMergeConfirm = async (mergedData: any) => {
        setMergeModalOpen(false);
        const toastId = toast({ title: "Updating contact...", description: "Saving merged data." });

        try {
            const res = await updateContactAction(contact.id, mergedData);
            if (res.success) {
                toast({ title: "Success", description: "Contact updated successfully" });
                if (onSuccess) onSuccess(); // Refresh data
            } else {
                toast({ title: "Error", description: res.error || "Update failed", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Server error during update", variant: "destructive" });
        }
    };


    const contactConfig = CONTACT_TYPE_CONFIG[(contact.contactType as ContactType) || 'Lead'];
    // Show Viewings only if 'properties' tab is enabled (implies property interest/seeker)
    const showViewings = contactConfig.visibleTabs.includes('properties');

    return (
        <>
            <ContactForm
                initialMode={initialMode}
                contact={contact}
                locationId={contact.locationId}
                onSuccess={onSuccess}
                leadSources={leadSources}
                isOutlookConnected={isOutlookConnected}
                additionalTabCount={showViewings ? 3 : 2}
                additionalTabs={
                    <>
                        {showViewings ? <TabsTrigger value="viewings">Viewings</TabsTrigger> : null}
                        <TabsTrigger value="tasks">Tasks</TabsTrigger>
                        <TabsTrigger value="history">History</TabsTrigger>
                    </>
                }
                additionalTabContent={(isEditing) => (
                    <>
                        {showViewings ? (
                            <TabsContent value="viewings" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                                <ContactViewingManager
                                    contactId={contact.id}
                                    locationId={contact.locationId}
                                    isEditing={isEditing}
                                />
                            </TabsContent>
                        ) : null}

                        <TabsContent value="tasks" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="space-y-4">
                                <h3 className="font-semibold">Tasks</h3>
                                <ContactTaskManager contactId={contact.id} compact={!isEditing} />
                            </div>
                        </TabsContent>

                        <TabsContent value="history" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="space-y-4">
                                <h3 className="font-semibold">Audit History</h3>
                                <HistoryTab history={history} loading={loadingData} contact={contact} />
                            </div>
                        </TabsContent>
                    </>
                )}
                additionalFooter={
                    <div className="flex justify-between w-full">
                        <div className="flex gap-2">
                            <Dialog open={pullModalOpen} onOpenChange={setPullModalOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" type="button">
                                        <UploadCloud className="mr-2 h-4 w-4" /> Pull from CRM
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Pull from Old CRM</DialogTitle>
                                        <DialogDescription>
                                            Enter the numeric Lead ID from the old CRM to pull data. This will update this contact.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>CRM Lead ID</Label>
                                            <Input
                                                value={crmLeadId}
                                                onChange={(e) => setCrmLeadId(e.target.value)}
                                                placeholder="e.g. 12345"
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setPullModalOpen(false)}>Cancel</Button>
                                        <Button onClick={handlePullFromCrm} disabled={isPulling}>
                                            {isPulling && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                                            {isPulling ? 'Pulling...' : 'Pull Data'}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>

                            <MergeContactDialog
                                sourceContactId={contact.id}
                                sourceName={contact.name || contact.phone || 'Unknown'}
                            />
                        </div>

                        <DeleteContactDialog
                            contact={contact}
                            onSuccess={onSuccess}
                            onDelete={onDelete}
                            isGoogleConnected={isGoogleConnected}
                            isGhlConnected={isGhlConnected}
                        />
                    </div>
                }
            />

            {/* Merge Dialog */}
            {
                mergeModalOpen && remoteData && (
                    <CrmMergeDialog
                        open={mergeModalOpen}
                        onOpenChange={setMergeModalOpen}
                        localContact={contact}
                        remoteData={remoteData}
                        duplicateOf={null}
                        onConfirm={(data) => handleMergeConfirm(data)}
                    />
                )
            }
        </>
    );
}

export function EditContactDialog({ contact, leadSources = [], trigger, isOutlookConnected = false, isGoogleConnected = false, isGhlConnected = false }: { contact: ContactData; leadSources?: string[]; trigger?: React.ReactNode; isOutlookConnected?: boolean; isGoogleConnected?: boolean; isGhlConnected?: boolean }) {
    const [open, setOpen] = useState(false);
    const normalizedContact: ContactData = {
        ...contact,
        leadOtherDetails: contact.leadOtherDetails ?? contact.notes ?? undefined,
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger ? trigger : (
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Edit Contact</DialogTitle>
                    <DialogDescription>
                        Update contact details.
                    </DialogDescription>
                </DialogHeader>
                <EditContactForm
                    contact={normalizedContact}
                    onSuccess={() => setOpen(false)}
                    leadSources={leadSources || []}
                    isOutlookConnected={isOutlookConnected}
                    isGoogleConnected={isGoogleConnected}
                    isGhlConnected={isGhlConnected}
                />
            </DialogContent>
        </Dialog>
    );
}
