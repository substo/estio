'use client';

import { useState, useEffect } from 'react';
import { Pencil, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { createViewing, updateViewing, deleteViewing, checkPropertyOwnerEmail, deleteContact } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { getPropertiesForSelect, getUsersForSelect, getContactViewings, getContactHistory } from '../fetch-helpers';

import { SearchableSelect } from './searchable-select';
import { HistoryTab } from './history-tab';

import { ContactForm, type ContactData } from './contact-form';
import { CONTACT_TYPE_CONFIG, type ContactType } from './contact-types';

export function EditContactForm({ contact, onSuccess, onDelete, leadSources, initialMode = 'edit', isOutlookConnected = false }: { contact: ContactData; onSuccess?: () => void; onDelete?: () => void; leadSources: string[]; initialMode?: 'view' | 'edit' | 'create'; isOutlookConnected?: boolean }) {
    const { toast } = useToast();
    const [isDeleting, setIsDeleting] = useState(false);

    // Viewings State
    const [properties, setProperties] = useState<{ id: string; title: string }[]>([]);
    const [users, setUsers] = useState<{ id: string; name: string | null; email: string; ghlCalendarId?: string | null }[]>([]);
    const [loadingData, setLoadingData] = useState(false);

    const [viewingDate, setViewingDate] = useState('');
    const [viewingNotes, setViewingNotes] = useState('Customer Feedback');
    const [viewingPropertyId, setViewingPropertyId] = useState('');
    const [viewingUserId, setViewingUserId] = useState('');
    const [editingViewingId, setEditingViewingId] = useState<string | null>(null);
    const [ownerNotification, setOwnerNotification] = useState<string | null>(null);
    const [pastViewings, setPastViewings] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [viewingModalOpen, setViewingModalOpen] = useState(false);

    // Fetch data for Viewings and Modal
    useEffect(() => {
        const fetchData = async () => {
            setLoadingData(true);
            try {
                const [props, usrs, viewings, hist] = await Promise.all([
                    getPropertiesForSelect(contact.locationId),
                    getUsersForSelect(contact.locationId),
                    getContactViewings(contact.id),
                    getContactHistory(contact.id)
                ]);
                setProperties(props);
                setUsers(usrs);
                setPastViewings(viewings);
                setHistory(hist);
            } catch (e) {
                console.error("Error fetching data", e);
            } finally {
                setLoadingData(false);
            }
        };
        fetchData();
    }, [contact.locationId, contact.id]);

    // Check Owner Email when Viewing Property changes
    useEffect(() => {
        if (viewingPropertyId) {
            checkPropertyOwnerEmail(viewingPropertyId).then(result => {
                if (!result.hasEmail) {
                    const prop = properties.find(p => p.id === viewingPropertyId);
                    const ref = (prop as any)?.unitNumber || (prop as any)?.title || 'Selected Property';
                    setOwnerNotification(`Please note that owner of property ${ref} does not have a valid email to receive viewing notifications.`);
                } else {
                    setOwnerNotification(null);
                }
            });
        } else {
            setOwnerNotification(null);
        }
    }, [viewingPropertyId, properties]);

    const handleSaveViewing = async () => {
        if (!viewingPropertyId || !viewingUserId || !viewingDate) {
            toast({ title: "Validation Error", description: "Please fill in all required fields (Date, Property, Agent).", variant: "destructive" });
            return;
        }

        const formData = new FormData();
        formData.append('contactId', contact.id);
        formData.append('propertyId', viewingPropertyId);
        formData.append('userId', viewingUserId);
        formData.append('date', viewingDate);
        formData.append('notes', viewingNotes);

        let result;
        if (editingViewingId) {
            formData.append('viewingId', editingViewingId);
            result = await updateViewing(null, formData);
        } else {
            result = await createViewing(null, formData);
        }

        if (result.success) {
            toast({ title: "Success", description: result.message });
            resetViewingForm();
            const viewings = await getContactViewings(contact.id);
            setPastViewings(viewings);
        } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
        }
    };

    const handleEditViewing = (viewing: any) => {
        setEditingViewingId(viewing.id);
        const dateObj = new Date(viewing.date);
        const offset = dateObj.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(dateObj.getTime() - offset)).toISOString().slice(0, 16);

        setViewingDate(localISOTime);
        setViewingPropertyId(viewing.propertyId);
        setViewingUserId(viewing.userId);
        setViewingNotes(viewing.notes || '');
        setViewingModalOpen(true);
    };

    const handleDeleteViewing = async (viewingId: string) => {
        if (confirm("Are you sure you want to delete this viewing?")) {
            const result = await deleteViewing(viewingId);
            if (result.success) {
                toast({ title: "Success", description: result.message });
                const viewings = await getContactViewings(contact.id);
                setPastViewings(viewings);
                if (editingViewingId === viewingId) {
                    resetViewingForm();
                }
            } else {
                toast({ title: "Error", description: result.message, variant: "destructive" });
            }
        }
    };

    const resetViewingForm = () => {
        setViewingDate('');
        setViewingNotes('Customer Feedback');
        setViewingPropertyId('');
        setViewingUserId('');
        setOwnerNotification(null);
        setEditingViewingId(null);
        setViewingModalOpen(false);
    };

    const handleDeleteContact = async () => {
        setIsDeleting(true);
        const result = await deleteContact(contact.id);
        if (result.success) {
            toast({ title: "Success", description: result.message });
            if (onDelete) onDelete();
            else if (onSuccess) onSuccess();
        } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
            setIsDeleting(false);
        }
    };

    const contactConfig = CONTACT_TYPE_CONFIG[(contact.contactType as ContactType) || 'Lead'];
    // Show Viewings only if 'properties' tab is enabled (implies property interest/seeker)
    const showViewings = contactConfig.visibleTabs.includes('properties');

    return (
        <ContactForm
            initialMode={initialMode}
            contact={contact}
            locationId={contact.locationId}
            onSuccess={onSuccess}
            leadSources={leadSources}
            isOutlookConnected={isOutlookConnected}
            additionalTabCount={showViewings ? 2 : 1}
            additionalTabs={
                <>
                    {showViewings ? <TabsTrigger value="viewings">Viewings</TabsTrigger> : null}
                    <TabsTrigger value="history">History</TabsTrigger>
                </>
            }
            additionalTabContent={(isEditing) => (
                <>
                    {showViewings ? (
                        <TabsContent value="viewings" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="font-semibold">Viewings</h3>
                                    {isEditing && (
                                        <Button
                                            onClick={() => {
                                                resetViewingForm();
                                                setViewingModalOpen(true);
                                            }}
                                            size="sm"
                                            type="button"
                                        >
                                            Add a New Property Viewing
                                        </Button>
                                    )}
                                </div>

                                <Dialog open={viewingModalOpen} onOpenChange={setViewingModalOpen}>
                                    <DialogContent className="sm:max-w-[500px]">
                                        <DialogHeader>
                                            <DialogTitle>{editingViewingId ? 'Edit Viewing' : 'Add a New Property Viewing'}</DialogTitle>
                                            <DialogDescription>
                                                {editingViewingId ? 'Update the details of the viewing below.' : 'Enter the details for the new viewing.'}
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Date & Time</Label>
                                                    <Input
                                                        type="datetime-local"
                                                        value={viewingDate}
                                                        onChange={e => setViewingDate(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Assigned Agent</Label>
                                                    <Select value={viewingUserId} onValueChange={setViewingUserId}>
                                                        <SelectTrigger><SelectValue placeholder="Select Agent" /></SelectTrigger>
                                                        <SelectContent>
                                                            {users.map(u => (
                                                                <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    {viewingUserId && users.find(u => u.id === viewingUserId)?.ghlCalendarId && (
                                                        <div className="mt-1 text-xs text-green-600 flex items-center gap-1">
                                                            <span>📅 GHL Calendar Connected</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Property</Label>
                                                <SearchableSelect
                                                    name="viewingPropertyId"
                                                    value={viewingPropertyId}
                                                    onChange={setViewingPropertyId}
                                                    options={properties.map(p => ({ value: p.id, label: (p as any).unitNumber ? `[${(p as any).unitNumber}] ${p.title}` : p.title }))}
                                                    placeholder="Select Property..."
                                                    searchPlaceholder="Search Property..."
                                                />
                                                {ownerNotification && (
                                                    <div className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded border border-yellow-200">
                                                        {ownerNotification}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Notes</Label>
                                                <Input
                                                    value={viewingNotes}
                                                    onChange={e => setViewingNotes(e.target.value)}
                                                    placeholder="Customer Feedback"
                                                />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button variant="ghost" type="button" onClick={() => setViewingModalOpen(false)}>Cancel</Button>
                                            <Button type="button" onClick={handleSaveViewing} disabled={loadingData}>
                                                {editingViewingId ? 'Update Viewing' : 'Save Viewing'}
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>

                                <div className="pt-2">
                                    {pastViewings.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No viewings recorded.</p>
                                    ) : (
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto w-full">
                                            {pastViewings.map((v) => (
                                                <div key={v.id} className="text-sm bg-gray-50 dark:bg-gray-900 p-2 rounded border flex flex-col gap-1 w-full">
                                                    <div className="flex justify-between items-start font-medium w-full">
                                                        <span>{new Date(v.date).toLocaleString()} - {v.property.unitNumber || v.property.title}</span>
                                                        <div className="flex items-center space-x-2">
                                                            <span className="text-muted-foreground text-xs mr-2">{v.user.name}</span>
                                                            {isEditing && (
                                                                <>
                                                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => handleEditViewing(v)}>
                                                                        <Pencil className="h-3 w-3" />
                                                                    </Button>
                                                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-red-50" onClick={() => handleDeleteViewing(v.id)}>
                                                                        <Trash className="h-3 w-3" />
                                                                    </Button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-gray-600">{v.notes}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>
                    ) : null}

                    <TabsContent value="history" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                        <div className="space-y-4">
                            <h3 className="font-semibold">Audit History</h3>
                            <HistoryTab history={history} loading={loadingData} contact={contact} />
                        </div>
                    </TabsContent>
                </>
            )}
            additionalFooter={
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button type="button" variant="destructive" disabled={isDeleting}>
                            <Trash className="mr-2 h-4 w-4" /> Delete Contact
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the contact and all associated data.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteContact} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {isDeleting ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            }
        />
    );
}

export function EditContactDialog({ contact, leadSources = [], trigger, isOutlookConnected = false }: { contact: ContactData; leadSources?: string[]; trigger?: React.ReactNode; isOutlookConnected?: boolean }) {
    const [open, setOpen] = useState(false);

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
                <EditContactForm contact={contact} onSuccess={() => setOpen(false)} leadSources={leadSources || []} isOutlookConnected={isOutlookConnected} />
            </DialogContent>
        </Dialog>
    );
}
