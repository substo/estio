/**
 * Contact Type Configuration
 * 
 * Defines the available contact types and which form sections/fields
 * are visible for each type. Contact Type directly implies the Role,
 * eliminating the need for a separate role dropdown.
 */

export const CONTACT_TYPES = [
    'Lead',
    'Agent',
    'Partner',
    'Owner',
    'Associate',
    'Contact',
    'Tenant',
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

// --- Enums / Constants for Validation ---

export const LEAD_GOALS = [
    'To Buy', 'To Rent', 'To List', 'Other'
] as const;

export const LEAD_PRIORITIES = [
    'Low', 'Medium', 'High'
] as const;

export const LEAD_STAGES = [
    'Unassigned', 'New', 'Contacted', 'Viewing', 'Negotiation', 'Closed', 'Lost'
] as const;

export const LEAD_SOURCES = [
    'None',
    'Website Inquiry',
    'Manual',
    'Referral',
    'Facebook',
    'Instagram',
    'Portal',
    'Other',
    'Direct Clients',
    'Sign Board',
    'Walk-In Clients',
    'FacebookADS',
    'Bazaraki',
    'Right Move',
    'A Place in the Sun',
    'RealityOn Expo 2025',
    'Property Canvas / Christos Nicolaou',
    'Roni',
    'Nachum Szwarcberg',
    'Nahum & Roni',
    'Uri Mass',
    'Lia Dar',
    'Meny Friedman',
    'Nizar swidan',
    'Wassim Al-Khateeb',
    'Shady Qubti - Growth Together Services',
    'Keynote assets',
    'Sarah Elleni Hibbett 1111',
    'CCS Shipping',
    'Becky Jackson _ Smart Rentz',
    'Sarah Eleni Hibbett',
    'Cular Estate',
    'Realty On Expo 2024',
    'MB ADS',
    'EKA',
    'Meinhard',
    'sebastian',
    'Burkhard',
    'Mr. Manar',
    'Stefan RECY',
    'benmalina',
    'Abdul',
    'pbeeck',
    'Chris F',
    'juergenoeffel',
    'MarcoFendt',
    'LisaW',
    'LydiaH',
    'AgnieszkaL',
    'PDAVE',
    'JuliaN',
    'Linda HO',
    'einfach zypern',
    'COBA',
    'Daniel Vogel',
    'sandra',
    'AaronI',
    'Daniela Hallmann',
    'MINDLOVERS',
    'andreaslindner',
    'StephanMeyer',
    'MarcStietzel',
    'MarekS',
    'molu',
    'WalterM',
    'SvenPawelke',
    'autowerbung',
    'SandraValera',
    'TomBritton',
    'Fabianhohnhaiser',
    'AlexandraFillipisou',
    'HeikeN',
    'MarkJankowski',
    'joergcarstensen',
    'zypernblogger',
    'DanielSchmidt',
    'MaikSchaefer',
    'YuliaD Brilliance consulting LTD',
    'InHome Paphos',
    'Giannis Georgiou Realty Connect CY',
    'Hera Property Concierge'
] as const;

export const REQUIREMENT_STATUSES = [
    'For Sale', 'For Rent'
] as const;

export const REQUIREMENT_CONDITIONS = [
    'Any Condition', 'New', 'Resale', 'Under Construction', 'Renovation Project'
] as const;


export interface ContactTypeConfig {
    label: string;
    description: string;
    /** Which tabs to show in the form */
    visibleTabs: ('details' | 'requirements' | 'matching' | 'properties')[];
    /** Whether to show lead-specific fields (Goal, Priority, Stage, Source, etc.) */
    showLeadFields: boolean;
    /** The database role implied by this contact type (for ContactPropertyRole/ContactCompanyRole) */
    impliedRole?: string;
    /** What entity types can be assigned */
    entityType: 'property' | 'company' | 'either' | 'none';
    /** Whether entity assignment is required */
    entityRequired: boolean;
    /** Custom label for the entity selector */
    entityLabel?: string;
    /** Whether multiple entities can be assigned (e.g., Owner can own multiple properties) */
    multiEntity?: boolean;
}

/**
 * Configuration for each contact type.
 * 
 * - Lead: Property buyers/renters - shows all fields, optional property assignment
 * - Agent: Real estate agents - can be assigned to property or company
 * - Partner: Business partners - can be assigned to property or company
 * - Owner: Property owners - requires property assignment
 * - Associate: Business associates - can be assigned to property or company
 * - Contact: Converted customer (renting/bought) - optional property, no lead fields
 */
export const CONTACT_TYPE_CONFIG: Record<ContactType, ContactTypeConfig> = {
    Lead: {
        label: 'Lead',
        description: 'Property buyer or renter looking for properties',
        visibleTabs: ['details', 'requirements', 'matching', 'properties'],
        showLeadFields: true,
        impliedRole: 'buyer',
        entityType: 'none', // Uses "Interested Properties" in Properties tab instead
        entityRequired: false,
    },
    Agent: {
        label: 'Agent',
        description: 'Real estate agent or broker',
        visibleTabs: ['details'],
        showLeadFields: false,
        impliedRole: 'agent',
        entityType: 'either',
        entityRequired: false,
        entityLabel: 'Assign to',
    },
    Partner: {
        label: 'Partner',
        description: 'Business partner or referral source',
        visibleTabs: ['details'],
        showLeadFields: false,
        impliedRole: 'partner',
        entityType: 'either',
        entityRequired: false,
        entityLabel: 'Assign to',
    },
    Owner: {
        label: 'Owner',
        description: 'Property owner',
        visibleTabs: ['details'],
        showLeadFields: false,
        impliedRole: 'owner',
        entityType: 'property',
        entityRequired: true,
        entityLabel: 'Owns Properties',
        multiEntity: true,
    },
    Associate: {
        label: 'Associate',
        description: 'Business associate',
        visibleTabs: ['details'],
        showLeadFields: false,
        impliedRole: 'associate',
        entityType: 'either',
        entityRequired: false,
        entityLabel: 'Assign to',
    },
    Contact: {
        label: 'Contact',
        description: 'Converted customer (renting or purchased)',
        visibleTabs: ['details', 'requirements', 'matching', 'properties'],
        showLeadFields: true,
        impliedRole: 'customer',
        entityType: 'none',
        entityRequired: false,
        entityLabel: 'Associated Property',
    },
    Tenant: {
        label: 'Tenant',
        description: 'Current tenant of a property',
        visibleTabs: ['details', 'requirements', 'matching', 'properties'],
        showLeadFields: true,
        impliedRole: 'tenant',
        entityType: 'property',
        entityRequired: true,
        entityLabel: 'Tenant of',
    },
};

export const DEFAULT_CONTACT_TYPE: ContactType = 'Lead';
