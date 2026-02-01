import { Contact } from "@prisma/client";

export interface CrmLeadFieldMapping {
    dbField: string;
    selector: string;
    type: 'text' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'checkbox-group' | 'multi-select';
    label?: string;
    valueMap?: Record<string, string>;
    transform?: (value: any, contact?: Partial<Contact>) => any;
}

// Map CRM IDs to your system values. Ideally these should be dynamic or user-configurable in future.
// For now, we seed with common defaults and fallback to raw values.

export const LEAD_SOURCE_MAP: Record<string, string> = {
    '1': 'Website',
    '2': 'Walk-in',
    '3': 'Telephone',
    '4': 'Email',
    '5': 'Referral',
    '6': 'Facebook',
    '7': 'Instagram',
    '8': 'Other'
};

export const LEAD_STATUS_MAP: Record<string, string> = {
    'sale': 'For Sale',
    'rent': 'For Rent',
    'let': 'To Let',
    'buy': 'To Buy',
    'list': 'To List'
};

export const LEAD_CONDITION_MAP: Record<string, string> = {
    '0': 'Any Condition',
    '1': 'Off-Plan',
    '2': 'Under Construction',
    '3': 'New / Resale (Ready)',
    '4': 'Resale'
};

export const CRM_LEAD_FIELD_MAPPING: CrmLeadFieldMapping[] = [
    // Core Info
    {
        dbField: 'name',
        selector: 'input[name="contact_name"]',
        type: 'text'
    },
    {
        dbField: 'email',
        selector: 'input[name="contact_email"]',
        type: 'text'
    },
    {
        dbField: 'phone', // contact_tel in JSON
        selector: 'input[name="contact_tel"]',
        type: 'text'
    },
    {
        dbField: 'preferredLang',
        selector: 'input[name="preferred_lang"]',
        type: 'text'
    },
    {
        dbField: 'notes',
        selector: 'textarea[name="contact_other"]',
        type: 'textarea'
    },
    // Meta / Details
    {
        dbField: 'leadGoal',
        selector: 'select[name="goal_id"]',
        type: 'select'
        // TODO: transformation using GOAL_MAP if needed
    },
    {
        dbField: 'leadPriority',
        selector: 'select[name="priority_id"]',
        type: 'select'
    },
    {
        dbField: 'leadStage',
        selector: 'select[name="stage_id"]',
        type: 'select'
    },
    {
        dbField: 'leadSource',
        selector: 'select[name="source_id"]',
        type: 'select',
        transform: (val) => LEAD_SOURCE_MAP[val] || val || "Unknown"
    },
    {
        dbField: 'leadNextAction',
        selector: 'input[name="next_action"]',
        type: 'text'
    },
    {
        dbField: 'leadFollowUpDate',
        selector: 'input[name="follow_up"]',
        type: 'text',
        transform: (val) => val ? new Date(val.split('-').reverse().join('-')) : null
    },
    {
        dbField: 'leadAssignedToAgent',
        selector: 'select[name="assigned_to_user_id"]',
        type: 'select'
        // We might need to map ID to Name via DB lookup in real-time or just store name if available in options
    },

    // Requirements
    {
        dbField: 'requirementStatus',
        selector: 'select[name="requirements_status"]',
        type: 'select',
        transform: (val) => LEAD_STATUS_MAP[val] || val || "Any"
    },
    {
        dbField: 'requirementDistrict',
        selector: 'select[name="requirements_district"]',
        type: 'select'
        // Value map for districts matches Property location map typically
    },
    {
        dbField: 'requirementBedrooms',
        selector: 'select[name="requirements_bedrooms"]',
        type: 'select'
    },
    {
        dbField: 'requirementMinPrice',
        selector: 'select[name="requirements_price_min"]',
        type: 'select'
    },
    {
        dbField: 'requirementMaxPrice',
        selector: 'select[name="requirements_price_max"]',
        type: 'select'
    },
    {
        dbField: 'requirementCondition',
        selector: 'select[name="requirements_condition"]',
        type: 'select',
        transform: (val) => LEAD_CONDITION_MAP[val] || val || "Any Condition"
    },
    {
        dbField: 'requirementPropertyTypes',
        selector: 'select[name="requirements_types[]"]',
        type: 'multi-select'
    },
    {
        dbField: 'requirementPropertyLocations',
        selector: 'select[name="requirements_locations[]"]',
        type: 'multi-select'
    },
    {
        dbField: 'requirementOtherDetails',
        selector: 'textarea[name="requirements_other_details"]',
        type: 'textarea'
    },

    // Property Matching Settings
    {
        dbField: 'matchingPropertiesToMatch',
        selector: 'select[name="match_existing_properties"]',
        type: 'select'
    },
    {
        dbField: 'matchingEmailMatchedProperties',
        selector: 'select[name="match_notifications_auto"]',
        type: 'select',
        transform: (val) => val === '1' ? 'Yes - Automatic' : 'No'
    },
    {
        dbField: 'matchingNotificationFrequency',
        selector: 'select[name="match_notifications_freq"]',
        type: 'select',
        transform: (val: string) => val ? val.charAt(0).toUpperCase() + val.slice(1) : "Weekly"
    },
    {
        dbField: 'matchingLastMatchDate',
        selector: 'input[name="match_last_date"]',
        type: 'text',
        transform: (val) => val ? new Date(val.split('-').reverse().join('-')) : null
    },

    // Property Arrays (IDs)
    {
        dbField: 'propertiesInterested',
        selector: 'select[name="properties[interested][]"]',
        type: 'multi-select'
    },
    {
        dbField: 'propertiesInspected',
        selector: 'select[name="properties[inspected][]"]',
        type: 'multi-select'
    },
    {
        dbField: 'propertiesEmailed',
        selector: 'select[name="properties[emailed][]"]',
        type: 'multi-select'
    },
    {
        dbField: 'propertiesMatched',
        selector: 'select[name="properties[matched][]"]',
        type: 'multi-select'
    },

    // Won Deal
    {
        dbField: 'propertyWonValue',
        selector: 'input[name="won_value"]',
        type: 'text',
        transform: (val) => val ? parseFloat(val.replace(/,/g, '')) : null
    },
    {
        dbField: 'wonCommission',
        selector: 'input[name="won_commission"]',
        type: 'text',
        transform: (val) => val ? parseFloat(val.replace(/,/g, '')) : null
    },
    {
        dbField: 'propertyWonReference',
        selector: 'input[name="won_reference"]',
        type: 'text'
    },
    {
        dbField: 'propertyWonDate',
        selector: 'input[name="won_date"]',
        type: 'text',
        transform: (val) => val ? new Date(val.split('-').reverse().join('-')) : null
    }
];
