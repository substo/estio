'use client';


import { useRouter } from 'next/navigation';
import { useState, useEffect, useActionState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { X, Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createContact, updateContact, deleteContactRole, verifyAndHealContact } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { GoogleSyncManager } from './google-sync-manager';
import { OutlookSyncManager } from './outlook-sync-manager';
import { RefreshCw, Mail } from 'lucide-react';
import { getPropertiesForSelect, getCompaniesForSelect, getUsersForSelect } from '../fetch-helpers';
import { LocationFilter } from '@/components/properties/location-filter';
import { PROPERTY_LOCATIONS } from '@/lib/properties/locations';

import { SearchableSelect } from './searchable-select';
import { MultiPropertySelect } from './multi-property-select';
import { ContactPropertyTypeSelector } from './contact-property-type-selector';
// AI Analyzer moved to Coordinator Panel
import {
    CONTACT_TYPES, CONTACT_TYPE_CONFIG, DEFAULT_CONTACT_TYPE, type ContactType,
    LEAD_GOALS, LEAD_PRIORITIES, LEAD_STAGES, REQUIREMENT_STATUSES, REQUIREMENT_CONDITIONS
} from './contact-types';

// Types for contact data (used in edit mode)
export type ContactData = {
    id: string;
    name: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email: string | null;
    phone: string | null;
    locationId: string;
    contactType?: string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;

    // Enhanced Demographics
    dateOfBirth?: Date | string | null;
    tags?: string[];

    // Address
    address1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;

    // Roles (read-only display in edit mode)
    propertyRoles?: {
        id: string;
        role: string;
        property: { title: string; reference?: string | null };
    }[];
    companyRoles?: {
        id: string;
        role: string;
        company: { name: string };
    }[];
    // Lead Details
    leadGoal?: string | null;
    leadPriority?: string;
    leadStage?: string;
    leadSource?: string | null;
    leadNextAction?: string | null;
    leadFollowUpDate?: Date | null;
    leadAssignedToAgent?: string | null;
    leadOtherDetails?: string | null;
    // Requirements
    requirementStatus?: string;
    requirementDistrict?: string;
    requirementBedrooms?: string;
    requirementMinPrice?: string;
    requirementMaxPrice?: string;
    requirementCondition?: string;
    requirementOtherDetails?: string | null;
    requirementPropertyTypes?: string[];
    requirementPropertyLocations?: string[];
    // Matching
    matchingPropertiesToMatch?: string;
    matchingEmailMatchedProperties?: string;
    matchingNotificationFrequency?: string;
    matchingLastMatchDate?: Date | null;
    // Properties
    propertiesInterested?: string[];
    propertiesInspected?: string[];
    propertiesEmailed?: string[];
    propertiesMatched?: string[];
    // Property Won
    propertyWonValue?: number | null;
    wonCommission?: number | null;
    propertyWonReference?: string | null;
    propertyWonDate?: Date | null;
    error?: string | null; // Sync Error
    ghlContactId?: string | null;
    googleContactId?: string | null;
    lastGoogleSync?: Date | null;
    payload?: any;
};

// Helper to safely display values
const RenderField = ({
    label,
    value,
    children,
    isEditing,
    className = ""
}: {
    label: string,
    value?: React.ReactNode | string | number | null,
    children: React.ReactNode,
    isEditing: boolean,
    className?: string
}) => {
    if (isEditing) {
        return (
            <div className={`space-y-2 ${className}`}>
                <Label>{label}</Label>
                {children}
            </div>
        );
    }
    // View Mode
    if (value === null || value === undefined || value === "") return null;
    return (
        <div className={`space-y-1 ${className}`}>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">{label}</Label>
            <div className="font-medium text-sm p-2 bg-muted/30 rounded-md border border-border/50 min-h-[36px] flex items-center w-full overflow-hidden text-ellipsis">
                {value}
            </div>
        </div>
    );
};

interface ContactFormProps {
    initialMode?: 'create' | 'edit' | 'view';
    contact?: ContactData;
    locationId: string;
    onSuccess?: () => void;
    /** Additional content to render inside the form (e.g., viewings tab for edit mode) */
    additionalTabs?: React.ReactNode;
    /** Additional footer content (e.g., delete button for edit mode) */
    additionalFooter?: React.ReactNode;
    /** Additional tab content nodes (for e.g. Viewings tab content) */
    additionalTabContent?: React.ReactNode | ((isEditing: boolean) => React.ReactNode);
    /** Number of additional tabs passed (for grid calculation) */
    additionalTabCount?: number;
    leadSources?: string[];
    isOutlookConnected?: boolean;
    initialData?: Partial<ContactData>;
}

function SubmitButton({ isEditing, isCreating, toggler }: { isEditing: boolean, isCreating: boolean, toggler: (e: React.MouseEvent) => void }) {
    const { pending } = useFormStatus();

    if (!isEditing) {
        return (
            <Button type="button" onClick={toggler}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Contact
            </Button>
        );
    }

    return (
        <Button type="submit" disabled={pending}>
            {pending ? (isCreating ? 'Creating...' : 'Saving...') : (isCreating ? 'Create Contact' : 'Save Changes')}
        </Button>
    );
}

function formatDate(date: Date | string | null | undefined) {
    if (!date) return '';
    try {
        return new Date(date).toISOString().split('T')[0];
    } catch (e) {
        return '';
    }
}

export function ContactForm({ initialMode = 'create', contact: initialContact, locationId, onSuccess, additionalTabs, additionalTabContent, additionalFooter, additionalTabCount = 0, leadSources = [], isOutlookConnected = false, initialData }: ContactFormProps) {
    // For initialization, merge passed contact with initialData (prefill)
    const contact = { ...initialData, ...initialContact } as ContactData | undefined;

    const router = useRouter();
    const [managerOpen, setManagerOpen] = useState(false);
    const [outlookOpen, setOutlookOpen] = useState(false);

    const [isEditing, setIsEditing] = useState(initialMode !== 'view');
    const isCreating = initialMode === 'create';

    // ... (rest of hook calls)

    const action = isCreating ? createContact : updateContact;
    const [state, formAction] = useActionState(action, {
        message: '',
        errors: {},
        success: false,
    });
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();

    const toggleEdit = (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (isCreating) return;
        setIsEditing(!isEditing);
    };

    // Determine initial contact type from existing data or default
    const initialContactType = (contact?.contactType as ContactType) || DEFAULT_CONTACT_TYPE;

    // Contact Type State
    const [contactType, setContactType] = useState<ContactType>(initialContactType);

    // ...

    const currentConfig = CONTACT_TYPE_CONFIG[contactType];

    // Entity Assignment State
    const [entityType, setEntityType] = useState<'property' | 'company'>('property');
    const [properties, setProperties] = useState<{ id: string; title: string; reference: string | null }[]>([]);
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
    const [users, setUsers] = useState<{ id: string; name: string | null; email: string }[]>([]);
    const [loadingData, setLoadingData] = useState(false);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
    const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]); // For multi-property (Owner)
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

    // Properties Tab State
    const [interestedProperties, setInterestedProperties] = useState<string[]>(contact?.propertiesInterested || []);
    const [inspectedProperties, setInspectedProperties] = useState<string[]>(contact?.propertiesInspected || []);
    const [emailedProperties, setEmailedProperties] = useState<string[]>(contact?.propertiesEmailed || []);
    const [matchedProperties, setMatchedProperties] = useState<string[]>(contact?.propertiesMatched || []);

    // Location Filter State - parse from contact if available
    const parseLocations = () => {
        const initialDistricts: string[] = [];
        const initialAreas: string[] = [];
        if (contact?.requirementPropertyLocations && Array.isArray(contact.requirementPropertyLocations)) {
            contact.requirementPropertyLocations.forEach(loc => {
                const isDistrict = PROPERTY_LOCATIONS.some(d => d.district_key === loc);
                if (isDistrict) {
                    initialDistricts.push(loc);
                } else {
                    initialAreas.push(loc);
                }
            });
        }
        return { initialDistricts, initialAreas };
    };

    const { initialDistricts, initialAreas } = parseLocations();
    const [selectedDistricts, setSelectedDistricts] = useState<string[]>(initialDistricts);
    const [selectedAreas, setSelectedAreas] = useState<string[]>(initialAreas);

    const handleLocationChange = (districts: string[], areas: string[]) => {
        setSelectedDistricts(districts);
        setSelectedAreas(areas);
    };

    const handleDeleteRole = async (roleId: string, type: 'property' | 'company') => {
        startTransition(async () => {
            const result = await deleteContactRole(roleId, type);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: result.message,
                });
                router.refresh(); // Refresh data without closing dialog (unlike onSubmit)
            } else {
                toast({
                    title: 'Error',
                    description: result.message,
                    variant: 'destructive',
                });
            }
        });
    };

    // Handle success/error state changes
    useEffect(() => {
        if (state.success) {
            // Reset form state if creating
            if (isCreating) {
                setSelectedPropertyId('');
                setSelectedCompanyId('');
                setInterestedProperties([]);
                setInspectedProperties([]);
                setEmailedProperties([]);
                setMatchedProperties([]);
                setSelectedDistricts([]);
                setSelectedAreas([]);
                if (onSuccess) onSuccess();
            } else {
                // If editing, just toggle back to view mode + refresh
                setIsEditing(false);
                router.refresh();
                if (onSuccess) onSuccess();
            }

            toast({
                title: 'Success',
                description: isCreating ? 'Contact created successfully.' : 'Contact updated successfully.',
            });

        } else if (state.message && !state.success) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast, onSuccess, isCreating]);

    // Auto-Heal Broken Links (Client Side to prevent render loops)
    const [hasAttemptedHeal, setHasAttemptedHeal] = useState(false);

    useEffect(() => {
        if (!contact || !contact.id || !contact.error || hasAttemptedHeal) return;

        if (contact.error.includes('Link broken') || contact.error.includes('not found')) {
            console.log('[Auto-Heal] broken link detected. Attempting recovery...');
            setHasAttemptedHeal(true); // Prevent infinite loops

            verifyAndHealContact(contact.id, contact.error).then(() => {
                router.refresh(); // Refresh to clear error if fixed
            });
        }
    }, [contact, hasAttemptedHeal, router]);

    // Fetch data when form is rendered
    const hasPropertiesTab = currentConfig.visibleTabs.includes('properties');
    const needsProperties = currentConfig.entityType === 'property' || currentConfig.entityType === 'either' || hasPropertiesTab;
    const needsCompanies = currentConfig.entityType === 'company' || currentConfig.entityType === 'either';

    useEffect(() => {
        setLoadingData(true);
        const promises: Promise<any>[] = [getUsersForSelect(locationId)];
        if (needsProperties) promises.push(getPropertiesForSelect(locationId));
        if (needsCompanies) promises.push(getCompaniesForSelect(locationId));

        Promise.all(promises).then((results) => {
            setUsers(results[0]);
            let idx = 1;
            if (needsProperties) setProperties(results[idx++] || []);
            if (needsCompanies) setCompanies(results[idx++] || []);
        }).finally(() => {
            setLoadingData(false);
        });
    }, [locationId, needsProperties, needsCompanies]);

    // leadSources are passed as props

    const districts = ["Any District", "Paphos", "Nicosia", "Famagusta", "Limassol", "Larnaca"];

    // Count visible tabs including additional tabs
    const visibleTabCount = currentConfig.visibleTabs.length + (additionalTabs ? (additionalTabCount || 1) : 0);

    const gridCols: Record<number, string> = {
        1: 'grid-cols-1',
        2: 'grid-cols-2',
        3: 'grid-cols-3',
        4: 'grid-cols-4',
        5: 'grid-cols-5',
        6: 'grid-cols-6',
    };

    return (
        <form action={formAction} className="flex flex-col flex-1 overflow-hidden">
            <input type="hidden" name="locationId" value={locationId} />
            {contact && <input type="hidden" name="contactId" value={contact.id} />}
            <input type="hidden" name="contactType" value={contactType} />

            <div className={`flex-1 overflow-y-auto px-1 py-2 ${!isEditing ? 'bg-muted/10' : ''}`}>

                {/* SYNC ERROR BANNER */}
                {contact?.error && (
                    <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative" role="alert">
                        <strong className="font-bold block">Sync Issue Detected</strong>
                        <span className="block sm:inline text-sm">{contact.error}</span>
                        <p className="text-xs mt-1">Please try saving this contact to re-attempt synchronization.</p>
                    </div>
                )}

                {/* AI Analyzer moved to Conversations > AI Coordinator Panel */}

                {/* Contact Type Selector */}
                <RenderField label="Contact Type" value={CONTACT_TYPE_CONFIG[contactType]?.label} isEditing={isEditing} className="mb-4">
                    <div className="mb-4 p-3 bg-muted/50 rounded-lg border">
                        <Select value={contactType} onValueChange={(v) => setContactType(v as ContactType)}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CONTACT_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        <div className="flex flex-col">
                                            <span>{CONTACT_TYPE_CONFIG[type].label}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">{currentConfig.description}</p>
                    </div>
                </RenderField>

                <Tabs defaultValue="details" className="w-full">
                    <TabsList className={`w-full grid ${gridCols[visibleTabCount] || 'grid-cols-4'}`}>
                        {currentConfig.visibleTabs.includes('details') && (
                            <TabsTrigger value="details">Details</TabsTrigger>
                        )}
                        {currentConfig.visibleTabs.includes('requirements') && (
                            <TabsTrigger value="requirements">Requirements</TabsTrigger>
                        )}
                        {currentConfig.visibleTabs.includes('matching') && (
                            <TabsTrigger value="matching">Matching</TabsTrigger>
                        )}
                        {currentConfig.visibleTabs.includes('properties') && (
                            <TabsTrigger value="properties">Properties</TabsTrigger>
                        )}
                        {additionalTabs}
                    </TabsList>

                    {/* Details Tab */}
                    <TabsContent value="details" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                        {/* Basic Info */}
                        {/* Basic Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <RenderField label="Full Name" value={contact?.name} isEditing={isEditing}>
                                <Input id="name" name="name" required placeholder="Full Name" defaultValue={contact?.name || ''} />
                                {state.errors?.name && <p className="text-sm text-red-500">{state.errors.name.join(', ')}</p>}
                            </RenderField>
                            <RenderField label="Email" value={contact?.email} isEditing={isEditing}>
                                <Input id="email" name="email" type="email" placeholder="email@example.com" defaultValue={contact?.email || ''} />
                                {state.errors?.email && <p className="text-sm text-red-500">{state.errors.email.join(', ')}</p>}
                            </RenderField>
                            <RenderField label="Phone" value={contact?.phone} isEditing={isEditing}>
                                <Input id="phone" name="phone" type="tel" placeholder="+123..." defaultValue={contact?.phone || ''} />
                                {state.errors?.phone && <p className="text-sm text-red-500">{state.errors.phone.join(', ')}</p>}
                            </RenderField>
                            <RenderField label="Date of Birth" value={contact?.dateOfBirth ? formatDate(contact?.dateOfBirth) : null} isEditing={isEditing}>
                                <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={formatDate(contact?.dateOfBirth)} />
                            </RenderField>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <RenderField label="First Name" value={contact?.firstName} isEditing={isEditing}>
                                <Input id="firstName" name="firstName" placeholder="First Name" defaultValue={contact?.firstName || ''} />
                            </RenderField>
                            <RenderField label="Last Name" value={contact?.lastName} isEditing={isEditing}>
                                <Input id="lastName" name="lastName" placeholder="Last Name" defaultValue={contact?.lastName || ''} />
                            </RenderField>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <RenderField label="Tags" value={contact?.tags?.join(', ')} isEditing={isEditing}>
                                <Input id="tags" name="tags" placeholder="Tag1, Tag2 (comma separated)" defaultValue={contact?.tags?.join(', ') || ''} />
                            </RenderField>
                        </div>

                        {/* Address Section */}
                        <div className="border-t pt-4 mt-2">
                            <Label className="mb-2 block font-semibold">Address</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <RenderField label="Address Line 1" value={contact?.address1} isEditing={isEditing}>
                                    <Input id="address1" name="address1" placeholder="Street Address" defaultValue={contact?.address1 || ''} />
                                </RenderField>
                                <RenderField label="City" value={contact?.city} isEditing={isEditing}>
                                    <Input id="city" name="city" placeholder="City" defaultValue={contact?.city || ''} />
                                </RenderField>
                                <RenderField label="State / Region" value={contact?.state} isEditing={isEditing}>
                                    <Input id="state" name="state" placeholder="State" defaultValue={contact?.state || ''} />
                                </RenderField>
                                <RenderField label="Postal Code" value={contact?.postalCode} isEditing={isEditing}>
                                    <Input id="postalCode" name="postalCode" placeholder="Postal Code" defaultValue={contact?.postalCode || ''} />
                                </RenderField>
                                <RenderField label="Country" value={contact?.country} isEditing={isEditing}>
                                    <Input id="country" name="country" placeholder="Country" defaultValue={contact?.country || ''} />
                                </RenderField>
                            </div>
                        </div>

                        {/* Lead Fields (conditional) */}
                        {currentConfig.showLeadFields && (
                            <div className="grid grid-cols-2 gap-4">
                                <RenderField label="Goal" value={contact?.leadGoal} isEditing={isEditing}>
                                    <Select name="leadGoal" defaultValue={contact?.leadGoal || undefined}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Goal" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LEAD_GOALS.map(o => (
                                                <SelectItem key={o} value={o}>{o}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Priority" value={contact?.leadPriority} isEditing={isEditing}>
                                    <Select name="leadPriority" defaultValue={contact?.leadPriority || "Medium"}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LEAD_PRIORITIES.map(o => (
                                                <SelectItem key={o} value={o}>{o}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Stage" value={contact?.leadStage} isEditing={isEditing}>
                                    <Select name="leadStage" defaultValue={contact?.leadStage || "Unassigned"}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LEAD_STAGES.map(o => (
                                                <SelectItem key={o} value={o}>{o}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Source" value={contact?.leadSource} isEditing={isEditing}>
                                    <Select name="leadSource" defaultValue={contact?.leadSource || undefined}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Source" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[200px]">
                                            {leadSources.map(o => (
                                                <SelectItem key={o} value={o}>{o}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Assigned Agent" value={contact?.leadAssignedToAgent ? (users.find(u => u.id === contact?.leadAssignedToAgent)?.name || contact?.leadAssignedToAgent) : null} isEditing={isEditing}>
                                    <Select name="leadAssignedToAgent" defaultValue={contact?.leadAssignedToAgent || undefined}>
                                        <SelectTrigger><SelectValue placeholder="Select Agent" /></SelectTrigger>
                                        <SelectContent>
                                            {users.map(u => (
                                                <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Next Action" value={contact?.leadNextAction} isEditing={isEditing}>
                                    <Input name="leadNextAction" defaultValue={contact?.leadNextAction || ''} />
                                </RenderField>
                                <RenderField label="Follow Up Date" value={contact?.leadFollowUpDate ? formatDate(contact?.leadFollowUpDate) : null} isEditing={isEditing}>
                                    <Input name="leadFollowUpDate" type="date" defaultValue={formatDate(contact?.leadFollowUpDate)} />
                                </RenderField>
                                <div className="col-span-2">
                                    <RenderField label="Other Details" value={contact?.leadOtherDetails} isEditing={isEditing}>
                                        <Textarea name="leadOtherDetails" placeholder="Add any other details..." defaultValue={contact?.leadOtherDetails || ''} />
                                    </RenderField>
                                </div>
                            </div>
                        )}


                        {/* Roles Display */}
                        {contact && (
                            <div className="border-t pt-4 mt-2">
                                <Label className="mb-2 block">Roles & Associations</Label>
                                {(!contact.propertyRoles?.length && !contact.companyRoles?.length) ? (
                                    <p className="text-sm text-muted-foreground">No roles assigned.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {contact.propertyRoles?.map((role) => (
                                            <div key={role.id} className="text-sm flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                                <span><span className="font-medium">{role.role}</span> at {role.property.reference || role.property.title}</span>
                                                {isEditing && (
                                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" onClick={() => handleDeleteRole(role.id, 'property')}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                        {contact.companyRoles?.map((role) => (
                                            <div key={role.id} className="text-sm flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                                <span><span className="font-medium">{role.role}</span> at {role.company.name}</span>
                                                {isEditing && (
                                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" onClick={() => handleDeleteRole(role.id, 'company')}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Entity Assignment - Based on Contact Type */}
                        {isEditing && currentConfig.entityType !== 'none' && (
                            <div className="border-t pt-4 mt-2 space-y-4">
                                <Label className="text-sm font-medium">
                                    {currentConfig.entityLabel || 'Assign to'}
                                    {currentConfig.entityRequired && <span className="text-red-500 ml-1">*</span>}
                                </Label>

                                {/* Hidden inputs for form submission */}
                                <input type="hidden" name="roleName" value={currentConfig.impliedRole || ''} />
                                {currentConfig.multiEntity ? (
                                    <input type="hidden" name="entityIds" value={JSON.stringify(selectedPropertyIds)} />
                                ) : (
                                    <input
                                        type="hidden"
                                        name="entityId"
                                        value={entityType === 'property' ? selectedPropertyId : selectedCompanyId}
                                    />
                                )}

                                {currentConfig.entityType === 'either' && (
                                    <RadioGroup
                                        value={entityType}
                                        onValueChange={(v) => setEntityType(v as 'property' | 'company')}
                                        className="flex space-x-4 mb-2"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="property" id="entity-property" />
                                            <Label htmlFor="entity-property">Property</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="company" id="entity-company" />
                                            <Label htmlFor="entity-company">Company</Label>
                                        </div>
                                    </RadioGroup>
                                )}

                                {(currentConfig.entityType === 'property' || (currentConfig.entityType === 'either' && entityType === 'property')) && (
                                    <div className="space-y-2">
                                        <input type="hidden" name="roleType" value="property" />
                                        {currentConfig.multiEntity ? (
                                            <MultiPropertySelect
                                                name="_propertySelector"
                                                options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                                value={selectedPropertyIds}
                                                onChange={setSelectedPropertyIds}
                                                placeholder={loadingData ? "Loading..." : "Search and select properties..."}
                                                disabled={loadingData}
                                            />
                                        ) : (
                                            <SearchableSelect
                                                name="_propertySelector"
                                                value={selectedPropertyId}
                                                onChange={setSelectedPropertyId}
                                                options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                                placeholder={loadingData ? "Loading..." : "Search properties..."}
                                                searchPlaceholder="Search by reference..."
                                                disabled={loadingData}
                                            />
                                        )}
                                    </div>
                                )}

                                {(currentConfig.entityType === 'company' || (currentConfig.entityType === 'either' && entityType === 'company')) && (
                                    <div className="space-y-2">
                                        <input type="hidden" name="roleType" value="company" />
                                        <SearchableSelect
                                            name="_companySelector"
                                            value={selectedCompanyId}
                                            onChange={setSelectedCompanyId}
                                            options={companies.map(c => ({ value: c.id, label: c.name }))}
                                            placeholder={loadingData ? "Loading..." : "Search companies..."}
                                            searchPlaceholder="Search by name..."
                                            disabled={loadingData}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    {/* Requirements Tab */}
                    {currentConfig.visibleTabs.includes('requirements') && (
                        <TabsContent value="requirements" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="grid grid-cols-2 gap-4">
                                <RenderField label="Requirement Status" value={contact?.requirementStatus} isEditing={isEditing}>
                                    <Select name="requirementStatus" defaultValue={contact?.requirementStatus || "For Sale"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {REQUIREMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="District" value={contact?.requirementDistrict} isEditing={isEditing}>
                                    <Select name="requirementDistrict" defaultValue={contact?.requirementDistrict || "Any District"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {districts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Bedrooms" value={contact?.requirementBedrooms} isEditing={isEditing}>
                                    <Select name="requirementBedrooms" defaultValue={contact?.requirementBedrooms || "Any Bedrooms"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["Any Bedrooms", "1+ Bedrooms", "2+ Bedrooms", "3+ Bedrooms", "4+ Bedrooms", "5+ Bedrooms"].map(b => (
                                                <SelectItem key={b} value={b}>{b}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Condition" value={contact?.requirementCondition} isEditing={isEditing}>
                                    <Select name="requirementCondition" defaultValue={contact?.requirementCondition || "Any Condition"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {REQUIREMENT_CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Min Price" value={contact?.requirementMinPrice} isEditing={isEditing}>
                                    <Select name="requirementMinPrice" defaultValue={contact?.requirementMinPrice || "Any"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent className="max-h-[200px]">
                                            {["Any", "€200", "€300", "€400", "€500", "€600", "€700", "€800", "€900", "€1,000", "€1,500", "€2,000", "€3,000", "€5,000", "€50,000", "€75,000", "€100,000", "€125,000", "€150,000", "€175,000"].map(p => (
                                                <SelectItem key={p} value={p}>{p}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Max Price" value={contact?.requirementMaxPrice} isEditing={isEditing}>
                                    <Select name="requirementMaxPrice" defaultValue={contact?.requirementMaxPrice || "Any"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent className="max-h-[200px]">
                                            {["Any", "€200", "€300", "€400", "€500", "€600", "€700", "€800", "€900", "€1,000", "€1,500", "€2,000", "€3,000", "€5,000", "€50,000", "€75,000", "€100,000", "€125,000", "€150,000", "€175,000"].map(p => (
                                                <SelectItem key={p} value={p}>{p}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                            </div>

                            <RenderField label="Property Types" value={contact?.requirementPropertyTypes?.length ? contact?.requirementPropertyTypes.join(', ') : null} isEditing={isEditing}>
                                <ContactPropertyTypeSelector name="requirementPropertyTypes" defaultValue={contact?.requirementPropertyTypes} />
                            </RenderField>
                            <RenderField label="Locations" value={contact?.requirementPropertyLocations?.length ? contact?.requirementPropertyLocations.join(', ') : null} isEditing={isEditing}>
                                <input
                                    type="hidden"
                                    name="requirementPropertyLocations"
                                    value={JSON.stringify([...selectedDistricts, ...selectedAreas])}
                                />
                                <LocationFilter
                                    selectedDistricts={selectedDistricts}
                                    selectedAreas={selectedAreas}
                                    onChange={handleLocationChange}
                                    modal={true}
                                />
                            </RenderField>
                            <div className="col-span-2">
                                <RenderField label="Other Details" value={contact?.requirementOtherDetails} isEditing={isEditing}>
                                    <Textarea name="requirementOtherDetails" placeholder="Add other specific requirements..." defaultValue={contact?.requirementOtherDetails || ''} />
                                </RenderField>
                            </div>
                        </TabsContent>
                    )}

                    {/* Matching Tab */}
                    {currentConfig.visibleTabs.includes('matching') && (
                        <TabsContent value="matching" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="grid grid-cols-2 gap-4">
                                <RenderField label="Properties To Match" value={contact?.matchingPropertiesToMatch} isEditing={isEditing}>
                                    <Select name="matchingPropertiesToMatch" defaultValue={contact?.matchingPropertiesToMatch || "Updated and New"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["None", "New Only", "Updated and New"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Email Matched Properties" value={contact?.matchingEmailMatchedProperties} isEditing={isEditing}>
                                    <Select name="matchingEmailMatchedProperties" defaultValue={contact?.matchingEmailMatchedProperties || "Yes - Automatic"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["No - Manual", "Yes - Automatic", "No - Client Unsubscribed"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Frequency" value={contact?.matchingNotificationFrequency} isEditing={isEditing}>
                                    <Select name="matchingNotificationFrequency" defaultValue={contact?.matchingNotificationFrequency || "Weekly"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["Daily", "Weekly", "Bi Weekly", "Monthly"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </RenderField>
                                <RenderField label="Last Match Date" value={contact?.matchingLastMatchDate ? formatDate(contact?.matchingLastMatchDate) : null} isEditing={isEditing}>
                                    <Input name="matchingLastMatchDate" type="date" defaultValue={formatDate(contact?.matchingLastMatchDate)} />
                                </RenderField>
                            </div>
                        </TabsContent>
                    )}

                    {/* Properties Tab */}
                    {currentConfig.visibleTabs.includes('properties') && (
                        <TabsContent value="properties" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="grid gap-4">
                                <RenderField label="Interested Properties" value={
                                    interestedProperties.length > 0 ? (
                                        <ul className="list-disc pl-5 mt-1">
                                            {interestedProperties.map(id => {
                                                const p = properties.find(prop => prop.id === id);
                                                return <li key={id}>{p ? (p.reference || p.title) : 'Unknown Property'}</li>
                                            })}
                                        </ul>
                                    ) : null
                                } isEditing={isEditing} className="w-full">
                                    <MultiPropertySelect
                                        name="propertiesInterested"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={interestedProperties}
                                        onChange={setInterestedProperties}
                                        placeholder={loadingData ? "Loading..." : "Search and select properties..."}
                                        disabled={loadingData}
                                    />
                                </RenderField>
                                <RenderField label="Inspected Properties" value={
                                    inspectedProperties.length > 0 ? (
                                        <ul className="list-disc pl-5 mt-1">
                                            {inspectedProperties.map(id => {
                                                const p = properties.find(prop => prop.id === id);
                                                return <li key={id}>{p ? (p.reference || p.title) : 'Unknown Property'}</li>
                                            })}
                                        </ul>
                                    ) : null
                                } isEditing={isEditing} className="w-full">
                                    <MultiPropertySelect
                                        name="propertiesInspected"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={inspectedProperties}
                                        onChange={setInspectedProperties}
                                        placeholder="Search and select properties..."
                                        disabled={loadingData}
                                    />
                                </RenderField>
                                <RenderField label="Properties Emailed" value={
                                    emailedProperties.length > 0 ? (
                                        <ul className="list-disc pl-5 mt-1">
                                            {emailedProperties.map(id => {
                                                const p = properties.find(prop => prop.id === id);
                                                return <li key={id}>{p ? (p.reference || p.title) : 'Unknown Property'}</li>
                                            })}
                                        </ul>
                                    ) : null
                                } isEditing={isEditing} className="w-full">
                                    <MultiPropertySelect
                                        name="propertiesEmailed"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={emailedProperties}
                                        onChange={setEmailedProperties}
                                        placeholder="Search and select properties..."
                                        disabled={loadingData}
                                    />
                                </RenderField>
                                <RenderField label="Properties Matched" value={
                                    matchedProperties.length > 0 ? (
                                        <ul className="list-disc pl-5 mt-1">
                                            {matchedProperties.map(id => {
                                                const p = properties.find(prop => prop.id === id);
                                                return <li key={id}>{p ? (p.reference || p.title) : 'Unknown Property'}</li>
                                            })}
                                        </ul>
                                    ) : null
                                } isEditing={isEditing} className="w-full">
                                    <MultiPropertySelect
                                        name="propertiesMatched"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={matchedProperties}
                                        onChange={setMatchedProperties}
                                        placeholder="Search and select properties..."
                                        disabled={loadingData}
                                    />
                                </RenderField>
                            </div>

                            {/* Property Won - Only shown if contact exists */}
                            {(contact) && (
                                <div className="border-t pt-4">
                                    <h3 className="font-semibold mb-2">Property Won</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <RenderField label="Property Won Reference" value={contact.propertyWonReference} isEditing={isEditing}>
                                            <Input name="propertyWonReference" defaultValue={contact.propertyWonReference || ''} />
                                        </RenderField>
                                        <RenderField label="Won Date" value={contact.propertyWonDate ? formatDate(contact.propertyWonDate) : null} isEditing={isEditing}>
                                            <Input name="propertyWonDate" type="date" defaultValue={formatDate(contact.propertyWonDate)} />
                                        </RenderField>
                                        <RenderField label="Won Value" value={contact.propertyWonValue} isEditing={isEditing}>
                                            <Input name="propertyWonValue" type="number" defaultValue={contact.propertyWonValue || ''} />
                                        </RenderField>
                                        <RenderField label="Commission" value={contact.wonCommission} isEditing={isEditing}>
                                            <Input name="wonCommission" type="number" defaultValue={contact.wonCommission || ''} />
                                        </RenderField>
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                    )}

                    {typeof additionalTabContent === 'function' ? additionalTabContent(isEditing) : additionalTabContent}
                </Tabs>
            </div>

            <div className={`pt-4 border-t flex items-center justify-between ${!isEditing ? 'bg-background p-2' : ''}`}>
                <div className="flex gap-2">
                    {isEditing ? (
                        <div className="flex gap-2 w-full items-center">
                            {/* Left Side: Sync Actions (Visible in Edit Mode too) */}
                            {contact && !isCreating && (
                                <div className="flex gap-2 mr-auto">
                                    <Button type="button" variant="outline" size="sm" onClick={() => setManagerOpen(true)}>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Manage Sync
                                    </Button>
                                    {contact.email && isOutlookConnected && (
                                        <Button type="button" variant="outline" size="sm" onClick={() => setOutlookOpen(true)}>
                                            <Mail className="mr-2 h-4 w-4" />
                                            Outlook Emails
                                        </Button>
                                    )}
                                </div>
                            )}

                            {/* Right Side: Additional Footer Action (Delete) */}
                            {additionalFooter}
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            {/* Manage Sync Button (Only in View Mode) */}
                            {contact && !isCreating && (
                                <>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setManagerOpen(true)}>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Manage Sync
                                    </Button>
                                    {contact.email && isOutlookConnected && (
                                        <Button type="button" variant="outline" size="sm" onClick={() => setOutlookOpen(true)}>
                                            <Mail className="mr-2 h-4 w-4" />
                                            Outlook Emails
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
                <SubmitButton isEditing={isEditing} isCreating={isCreating} toggler={toggleEdit} />
            </div>

            {contact && (
                <GoogleSyncManager
                    contact={contact}
                    open={managerOpen}
                    onOpenChange={setManagerOpen}
                />
            )}

            {contact && contact.email && (
                <OutlookSyncManager
                    contactEmail={contact.email}
                    contactName={contact.name || 'Contact'}
                    open={outlookOpen}
                    onOpenChange={setOutlookOpen}
                />
            )}
        </form >
    );
}
