'use client';


import { useRouter } from 'next/navigation';
import { useState, useEffect, useActionState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

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
import { createContact, updateContact, deleteContactRole } from '../actions';
import { useToast } from '@/components/ui/use-toast';
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
    email: string | null;
    phone: string | null;
    locationId: string;
    contactType?: string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
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
};

interface ContactFormProps {
    mode: 'create' | 'edit';
    contact?: ContactData;
    locationId: string;
    onSuccess: () => void;
    /** Additional content to render inside the form (e.g., viewings tab for edit mode) */
    additionalTabs?: React.ReactNode;
    /** Additional footer content (e.g., delete button for edit mode) */
    additionalFooter?: React.ReactNode;
    /** Additional tab content nodes (for e.g. Viewings tab content) */
    /** Additional tab content nodes (for e.g. Viewings tab content) */
    additionalTabContent?: React.ReactNode;
    /** Number of additional tabs passed (for grid calculation) */
    additionalTabCount?: number;
    leadSources?: string[];
}

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? (mode === 'create' ? 'Creating...' : 'Saving...') : (mode === 'create' ? 'Create Contact' : 'Save Changes')}
        </Button>
    );
}

function formatDate(date: Date | null | undefined) {
    if (!date) return '';
    try {
        return new Date(date).toISOString().split('T')[0];
    } catch (e) {
        return '';
    }
}

export function ContactForm({ mode, contact, locationId, onSuccess, additionalTabs, additionalTabContent, additionalFooter, additionalTabCount = 0, leadSources = [] }: ContactFormProps) {
    const router = useRouter();
    const action = mode === 'create' ? createContact : updateContact;
    const [state, formAction] = useActionState(action, {
        message: '',
        errors: {},
        success: false,
    });
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();

    // Determine initial contact type from existing data or default
    const initialContactType = (contact?.contactType as ContactType) || DEFAULT_CONTACT_TYPE;

    // Contact Type State
    const [contactType, setContactType] = useState<ContactType>(initialContactType);
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
            // Reset form state
            setSelectedPropertyId('');
            setSelectedCompanyId('');
            if (mode === 'create') {
                setInterestedProperties([]);
                setInspectedProperties([]);
                setEmailedProperties([]);
                setMatchedProperties([]);
                setSelectedDistricts([]);
                setSelectedAreas([]);
            }
            toast({
                title: 'Success',
                description: mode === 'create' ? 'Contact created successfully.' : 'Contact updated successfully.',
            });
            onSuccess();
        } else if (state.message && !state.success) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast, onSuccess, mode]);

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
            {mode === 'edit' && contact && <input type="hidden" name="contactId" value={contact.id} />}
            <input type="hidden" name="contactType" value={contactType} />

            <div className="flex-1 overflow-y-auto px-1 py-2">
                {/* AI Analyzer moved to Conversations > AI Coordinator Panel */}

                {/* Contact Type Selector */}
                <div className="mb-4 p-3 bg-muted/50 rounded-lg border">
                    <Label className="text-sm font-medium mb-2 block">Contact Type</Label>
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
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input id="name" name="name" required placeholder="Full Name" defaultValue={contact?.name || ''} />
                                {state.errors?.name && <p className="text-sm text-red-500">{state.errors.name.join(', ')}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input id="email" name="email" type="email" placeholder="email@example.com" defaultValue={contact?.email || ''} />
                                {state.errors?.email && <p className="text-sm text-red-500">{state.errors.email.join(', ')}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone</Label>
                                <Input id="phone" name="phone" type="tel" placeholder="+123..." defaultValue={contact?.phone || ''} />
                                {state.errors?.phone && <p className="text-sm text-red-500">{state.errors.phone.join(', ')}</p>}
                            </div>
                        </div>

                        {/* Lead Fields (conditional) */}
                        {currentConfig.showLeadFields && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Goal</Label>
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
                                </div>
                                <div className="space-y-2">
                                    <Label>Priority</Label>
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
                                </div>
                                <div className="space-y-2">
                                    <Label>Stage</Label>
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
                                </div>
                                <div className="space-y-2">
                                    <Label>Source</Label>
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
                                </div>
                                <div className="space-y-2">
                                    <Label>Assigned Agent</Label>
                                    <Select name="leadAssignedToAgent" defaultValue={contact?.leadAssignedToAgent || undefined}>
                                        <SelectTrigger><SelectValue placeholder="Select Agent" /></SelectTrigger>
                                        <SelectContent>
                                            {users.map(u => (
                                                <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Next Action</Label>
                                    <Input name="leadNextAction" defaultValue={contact?.leadNextAction || ''} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Follow Up Date</Label>
                                    <Input name="leadFollowUpDate" type="date" defaultValue={formatDate(contact?.leadFollowUpDate)} />
                                </div>
                                <div className="col-span-2 space-y-2">
                                    <Label>Other Details</Label>
                                    <Textarea name="leadOtherDetails" placeholder="Add any other details..." defaultValue={contact?.leadOtherDetails || ''} />
                                </div>
                            </div>
                        )}


                        {/* Current Roles Display (Edit Mode Only) */}
                        {mode === 'edit' && contact && (
                            <div className="border-t pt-4 mt-2">
                                <Label className="mb-2 block">Current Roles</Label>
                                {(!contact.propertyRoles?.length && !contact.companyRoles?.length) ? (
                                    <p className="text-sm text-muted-foreground">No roles assigned.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {contact.propertyRoles?.map((role) => (
                                            <div key={role.id} className="text-sm flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                                <span><span className="font-medium">{role.role}</span> at {role.property.reference || role.property.title}</span>
                                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" onClick={() => handleDeleteRole(role.id, 'property')}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                        {contact.companyRoles?.map((role) => (
                                            <div key={role.id} className="text-sm flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                                <span><span className="font-medium">{role.role}</span> at {role.company.name}</span>
                                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" onClick={() => handleDeleteRole(role.id, 'company')}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Entity Assignment - Based on Contact Type */}
                        {currentConfig.entityType !== 'none' && (
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
                                <div className="space-y-2">
                                    <Label>Requirement Status</Label>
                                    <Select name="requirementStatus" defaultValue={contact?.requirementStatus || "For Sale"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {REQUIREMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>District</Label>
                                    <Select name="requirementDistrict" defaultValue={contact?.requirementDistrict || "Any District"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {districts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Bedrooms</Label>
                                    <Select name="requirementBedrooms" defaultValue={contact?.requirementBedrooms || "Any Bedrooms"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["Any Bedrooms", "1+ Bedrooms", "2+ Bedrooms", "3+ Bedrooms", "4+ Bedrooms", "5+ Bedrooms"].map(b => (
                                                <SelectItem key={b} value={b}>{b}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Condition</Label>
                                    <Select name="requirementCondition" defaultValue={contact?.requirementCondition || "Any Condition"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {REQUIREMENT_CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Min Price</Label>
                                    <Select name="requirementMinPrice" defaultValue={contact?.requirementMinPrice || "Any"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent className="max-h-[200px]">
                                            {["Any", "€200", "€300", "€400", "€500", "€600", "€700", "€800", "€900", "€1,000", "€1,500", "€2,000", "€3,000", "€5,000", "€50,000", "€75,000", "€100,000", "€125,000", "€150,000", "€175,000"].map(p => (
                                                <SelectItem key={p} value={p}>{p}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Max Price</Label>
                                    <Select name="requirementMaxPrice" defaultValue={contact?.requirementMaxPrice || "Any"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent className="max-h-[200px]">
                                            {["Any", "€200", "€300", "€400", "€500", "€600", "€700", "€800", "€900", "€1,000", "€1,500", "€2,000", "€3,000", "€5,000", "€50,000", "€75,000", "€100,000", "€125,000", "€150,000", "€175,000"].map(p => (
                                                <SelectItem key={p} value={p}>{p}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Property Types</Label>
                                <ContactPropertyTypeSelector name="requirementPropertyTypes" defaultValue={contact?.requirementPropertyTypes} />
                            </div>
                            <div className="space-y-2">
                                <Label>Locations</Label>
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
                            </div>
                            <div className="col-span-2 space-y-2">
                                <Label>Other Details</Label>
                                <Textarea name="requirementOtherDetails" placeholder="Add other specific requirements..." defaultValue={contact?.requirementOtherDetails || ''} />
                            </div>
                        </TabsContent>
                    )}

                    {/* Matching Tab */}
                    {currentConfig.visibleTabs.includes('matching') && (
                        <TabsContent value="matching" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Properties To Match</Label>
                                    <Select name="matchingPropertiesToMatch" defaultValue={contact?.matchingPropertiesToMatch || "Updated and New"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["None", "New Only", "Updated and New"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Email Matched Properties</Label>
                                    <Select name="matchingEmailMatchedProperties" defaultValue={contact?.matchingEmailMatchedProperties || "Yes - Automatic"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["No - Manual", "Yes - Automatic", "No - Client Unsubscribed"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Frequency</Label>
                                    <Select name="matchingNotificationFrequency" defaultValue={contact?.matchingNotificationFrequency || "Weekly"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["Daily", "Weekly", "Bi Weekly", "Monthly"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Last Match Date</Label>
                                    <Input name="matchingLastMatchDate" type="date" defaultValue={formatDate(contact?.matchingLastMatchDate)} />
                                </div>
                            </div>
                        </TabsContent>
                    )}

                    {/* Properties Tab */}
                    {currentConfig.visibleTabs.includes('properties') && (
                        <TabsContent value="properties" forceMount={true} className="space-y-4 pt-4 data-[state=inactive]:hidden">
                            <div className="grid gap-4">
                                <div className="space-y-2">
                                    <Label>Interested Properties</Label>
                                    <MultiPropertySelect
                                        name="propertiesInterested"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={interestedProperties}
                                        onChange={setInterestedProperties}
                                        placeholder={loadingData ? "Loading..." : "Search and select properties..."}
                                        disabled={loadingData}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Inspected Properties</Label>
                                    <MultiPropertySelect
                                        name="propertiesInspected"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={inspectedProperties}
                                        onChange={setInspectedProperties}
                                        placeholder="Search and select properties..."
                                        disabled={loadingData}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Properties Emailed</Label>
                                    <MultiPropertySelect
                                        name="propertiesEmailed"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={emailedProperties}
                                        onChange={setEmailedProperties}
                                        placeholder="Search and select properties..."
                                        disabled={loadingData}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Properties Matched</Label>
                                    <MultiPropertySelect
                                        name="propertiesMatched"
                                        options={properties.map(p => ({ value: p.id, label: p.reference || p.title }))}
                                        value={matchedProperties}
                                        onChange={setMatchedProperties}
                                        placeholder="Search and select properties..."
                                        disabled={loadingData}
                                    />
                                </div>
                            </div>

                            {/* Property Won - Only shown in edit mode or if contact exists */}
                            {mode === 'edit' && contact && (
                                <div className="border-t pt-4">
                                    <h3 className="font-semibold mb-2">Property Won</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Property Won Reference</Label>
                                            <Input name="propertyWonReference" defaultValue={contact.propertyWonReference || ''} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Won Date</Label>
                                            <Input name="propertyWonDate" type="date" defaultValue={formatDate(contact.propertyWonDate)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Won Value</Label>
                                            <Input name="propertyWonValue" type="number" defaultValue={contact.propertyWonValue || ''} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Commission</Label>
                                            <Input name="wonCommission" type="number" defaultValue={contact.wonCommission || ''} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                    )}

                    {additionalTabContent}
                </Tabs>
            </div>

            <div className="pt-4 border-t flex justify-between">
                {additionalFooter}
                <SubmitButton mode={mode} />
            </div>
        </form >
    );
}
