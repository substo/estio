'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { Pencil, Trash, RefreshCw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewLeadAction } from '@/app/(main)/admin/settings/crm/actions';
import { CrmMergeDialog } from './crm-merge-dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
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
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { updateContactAction } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { getContactHistory } from '../fetch-helpers';
import { HistoryTab } from './history-tab';
import { DeleteContactDialog } from './delete-contact-dialog';

import { ContactForm, type ContactData, type ContactIdentityPatch } from './contact-form';
import { CONTACT_TYPE_CONFIG, DEFAULT_CONTACT_TYPE, isKnownContactType, type ContactType } from './contact-types';
import { MergeContactDialog } from './merge-contact-dialog';

const ContactTaskManager = dynamic(
    () => import('@/components/tasks/contact-task-manager').then((mod) => mod.ContactTaskManager),
    {
        loading: () => <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />,
    }
);

const ContactViewingManager = dynamic(
    () => import('@/components/tasks/contact-viewing-manager').then((mod) => mod.ContactViewingManager),
    {
        loading: () => <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />,
    }
);

export function EditContactForm({ contact, onSuccess, onDelete, onContactSaved, onMergeSuccess, leadSources, initialMode = 'edit', isOutlookConnected = false, isGoogleConnected = false, isGhlConnected = false, skipRouterRefresh = false }: { contact: ContactData; onSuccess?: () => void; onDelete?: () => void; onContactSaved?: (patch: ContactIdentityPatch) => void; onMergeSuccess?: (targetContactId: string, targetConversationId?: string | null) => void; leadSources: string[]; initialMode?: 'view' | 'edit' | 'create'; isOutlookConnected?: boolean; isGoogleConnected?: boolean; isGhlConnected?: boolean; skipRouterRefresh?: boolean }) {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('details');
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [history, setHistory] = useState<any[]>([]);

    // CRM Pull State
    const [pullModalOpen, setPullModalOpen] = useState(false);
    const [crmLeadId, setCrmLeadId] = useState('');
    const [isPulling, setIsPulling] = useState(false);
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [remoteData, setRemoteData] = useState<any>(null);
    const [mergeContactDialogOpen, setMergeContactDialogOpen] = useState(false);
    const [deleteContactDialogOpen, setDeleteContactDialogOpen] = useState(false);

    useEffect(() => {
        setActiveTab('details');
        setHistory([]);
        setLoadingHistory(false);
    }, [contact.id]);

    useEffect(() => {
        if (activeTab !== 'history') return;
        let cancelled = false;

        const fetchHistory = async () => {
            setLoadingHistory(true);
            try {
                const hist = await getContactHistory(contact.id);
                if (!cancelled) {
                    setHistory(hist);
                }
            } catch (e) {
                console.error("Error fetching contact history", e);
            } finally {
                if (!cancelled) {
                    setLoadingHistory(false);
                }
            }
        };

        void fetchHistory();

        return () => {
            cancelled = true;
        };
    }, [activeTab, contact.id]);

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
        toast({ title: "Updating contact...", description: "Saving merged data." });

        try {
            const res = await updateContactAction(contact.id, mergedData);
            if (res.success) {
                onContactSaved?.({
                    id: contact.id,
                    name: mergedData?.name ?? contact.name ?? null,
                    email: mergedData?.email ?? contact.email ?? null,
                    phone: mergedData?.phone ?? contact.phone ?? null,
                    firstName: mergedData?.firstName ?? contact.firstName ?? null,
                    lastName: mergedData?.lastName ?? contact.lastName ?? null,
                    preferredLang: mergedData?.preferredLang ?? contact.preferredLang ?? null,
                });
                toast({ title: "Success", description: "Contact updated successfully" });
                if (onSuccess) onSuccess(); // Refresh data
            } else {
                toast({ title: "Error", description: res.error || "Update failed", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Server error during update", variant: "destructive" });
        }
    };


    const contactType = isKnownContactType(contact.contactType)
        ? (contact.contactType as ContactType)
        : DEFAULT_CONTACT_TYPE;
    const contactConfig = CONTACT_TYPE_CONFIG[contactType];
    // Show Viewings only if 'properties' tab is enabled (implies property interest/seeker)
    const showViewings = contactConfig.visibleTabs.includes('properties');

    return (
        <>
            <ContactForm
                initialMode={initialMode}
                contact={contact}
                locationId={contact.locationId}
                onSuccess={onSuccess}
                onContactSaved={onContactSaved}
                leadSources={leadSources}
                isOutlookConnected={isOutlookConnected}
                skipRouterRefresh={skipRouterRefresh}
                onTabChange={setActiveTab}
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
                            <TabsContent value="viewings" className="space-y-4 pt-4">
                                <ContactViewingManager
                                    contactId={contact.id}
                                    locationId={contact.locationId}
                                    isEditing={isEditing}
                                />
                            </TabsContent>
                        ) : null}

                        <TabsContent value="tasks" className="space-y-4 pt-4">
                            <div className="space-y-4">
                                <h3 className="font-semibold">Tasks</h3>
                                <ContactTaskManager contactId={contact.id} compact={!isEditing} />
                            </div>
                        </TabsContent>

                        <TabsContent value="history" className="space-y-4 pt-4">
                            <div className="space-y-4">
                                <h3 className="font-semibold">Audit History</h3>
                                <HistoryTab history={history} loading={loadingHistory} contact={contact} />
                            </div>
                        </TabsContent>
                    </>
                )}
                editActionsMenuItems={
                    <>
                        <DropdownMenuItem onSelect={() => setPullModalOpen(true)}>
                            <UploadCloud className="mr-2 h-4 w-4" />
                            Pull from CRM
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setMergeContactDialogOpen(true)}>
                            Merge
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteContactDialogOpen(true)}
                        >
                            <Trash className="mr-2 h-4 w-4" />
                            Delete Contact
                        </DropdownMenuItem>
                    </>
                }
            />

            <Dialog open={pullModalOpen} onOpenChange={setPullModalOpen}>
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
                open={mergeContactDialogOpen}
                onOpenChange={setMergeContactDialogOpen}
                onMergeSuccess={onMergeSuccess}
            />

            <DeleteContactDialog
                contact={contact}
                onSuccess={onSuccess}
                onDelete={onDelete}
                isGoogleConnected={isGoogleConnected}
                isGhlConnected={isGhlConnected}
                open={deleteContactDialogOpen}
                onOpenChange={setDeleteContactDialogOpen}
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

export function EditContactDialog({ contact, leadSources = [], trigger, isOutlookConnected = false, isGoogleConnected = false, isGhlConnected = false, onContactSaved, onMergeSuccess, skipRouterRefresh = false }: { contact: ContactData; leadSources?: string[]; trigger?: React.ReactNode; isOutlookConnected?: boolean; isGoogleConnected?: boolean; isGhlConnected?: boolean; onContactSaved?: (patch: ContactIdentityPatch) => void; onMergeSuccess?: (targetContactId: string, targetConversationId?: string | null) => void; skipRouterRefresh?: boolean }) {
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
                    onContactSaved={onContactSaved}
                    onMergeSuccess={onMergeSuccess}
                    leadSources={leadSources || []}
                    isOutlookConnected={isOutlookConnected}
                    isGoogleConnected={isGoogleConnected}
                    isGhlConnected={isGhlConnected}
                    skipRouterRefresh={skipRouterRefresh}
                />
            </DialogContent>
        </Dialog>
    );
}
