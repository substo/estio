import { Property } from "@prisma/client";

export interface CrmFieldMapping {
    dbField: string;
    selector: string; // CSS Selector usually name="..."
    type: 'text' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'checkbox-group';
    tab?: string; // CSS Selector for the tab link to click before filling this field
    label?: string; // For checkbox groups where we match by label text
    valueMap?: Record<string, string>; // Optional map for select values (e.g. "0" -> "No")
    transform?: (value: any, property?: Property) => string | boolean | null;
}

// MAPPINGS derived from User provided JSON
export const TYPE_MAP: Record<string, string> = {
    // DB Value (slug/string) : CRM Value (ID)
    'detached-villa': '14',
    'semi-detached-villa': '33',
    'town-house': '17',
    'traditional-house': '27',
    'bungalow': '18',
    'studio': '9',
    'apartment': '10',
    'penthouse': '12',
    'ground-floor-apartment': '11',
    'shop': '20',
    'office': '19',
    'business': '21',
    'building': '28',
    'project': '22',
    'showroom': '24',
    'hotel': '25',
    'warehouse': '29',
    'residential-land': '6',
    'agricultural-land': '7',
    'industrial-land': '8',
    'touristic-land': '30',
    'commercial-land': '31',
    'land-with-permits': '34',
    // Fallbacks
    'villa': '14',
    'house': '14',
    'land': '6',
};

// Partial Location Map (User provided many, adding a subset/logic to match)
// Ideally we'd do a fuzzy match on text in the pusher if ID fails, but here is explicit map
export const LOCATION_MAP: Record<string, string> = {
    // --- Paphos Town & Suburbs ---
    'paphos': '861',
    'paphos_town': '861',
    'kato_paphos': '924',
    'tombs_of_the_kings': '926', // Kato Paphos - Tombs of The Kings
    'universal': '925', // Kato Paphos - Universal
    'moutallos': '933',
    'anavargos': '932',
    'geroskipou': '892',
    'konia': '827',
    'mesogi': '851',
    'mesa_chorio': '849',
    'tremithousa': '888',
    'tsada': '890',
    'chlorakas': '791',
    'emba': '799',
    'kissonerga': '823',
    'lemba': '837', // Lempa
    'tala': '882',
    'kamares': '1426', // Tala - Kamares
    'episkopi_paphos': '800', // Episkopi
    'armou': '787',
    'marathounta': '845',
    'koili': '824',

    // --- East of Paphos / Airport Area ---
    'acheleia': '769',
    'agia_varvara': '773',
    'timi': '886',
    'anarita': '782',
    'mandria_paphos': '844', // Mandria
    'nikokleia': '858',
    'kouklia': '828',
    'secret_valley': '930', // Kouklia - Secret Valley
    'aphrodite_hills': '929', // Kouklia - Aphrodite Hills
    'choletria': '792',
    'nata': '855',

    // --- West / Peyia Area ---
    'peyia': '865', // Peyia
    'coral_bay': '907', // Peyia - Coral Bay
    'sea_caves': '927', // Peyia - Sea Caves
    'st_george_peyia': '775', // Agios Georgios
    'akoursos': '779',
    'kathikas': '817',
    'arodes_pano': '788', // Arodes (Mapping generic to Pano)
    'ineia': '813',
    'drouseia': '796',

    // --- Polis / Latchi Area ---
    'polis': '868', // Poli Crysochous
    'prodromi': '931',
    'latchi': '835',
    'neo_chorio': '857',
    'argaka': '785',
    'gialia': '810',
    'agia_marina_chrysochous': '770',
    'nea_dimmata': '856',
    'pomos': '869',
    'androlikou': '783',
    'steni': '880',
    'peristerona': '864',
    'lysos': '840',
    'skoulli': '876',

    // --- Villages (Mid-Paphos / Wine Villages) ---
    'polemi': '867',
    'stroumbi': '881',
    'yiolou': '811', // Giolou
    'goudi': '812',
    'kallepia': '814', // Kallepeia
    'letymvou': '838', // Letymbou
    'simou': '875',
    'fyti': '808',
    'amargeti': '780',
    'panagia': '859',
    'statos_agios_fotios': '878',

    // --- Remaining Villages ---
    'agia_marina_kelokedaron': '771',
    'agia_marinouda': '772',
    'agios_dimitrianos': '774',
    'agios_ioannis': '776',
    'agios_isidoros': '777',
    'agios_nikolaos': '778',
    'akourdaleia_kato': '818',
    'akourdaleia_pano': '860',
    'anadiou': '781',
    'archimandrita': '784',
    'arminou': '786',
    'asprogia': '789',
    'axylou': '790',
    'choli': '793',
    'choulou': '794',
    'chrysochou_village': '795', // Chrysochou
    'drymou': '797',
    'eledio': '798',
    'evretou': '801',
    'falia': '802', // Faleia
    'fasli': '803',
    'fasoula': '804',
    'filousa_chrysochou': '805', // Filousa Chrysochous
    'filousa_kelokedaron': '806',
    'foinikas': '807',
    'galataria': '809',
    'kannaviou': '815',
    'karamoullides': '816',
    'kedares': '819',
    'kelokedara': '820',
    'kidasi': '821',
    'kios': '822',
    'koilineia': '825',
    'koloni': '826',
    'kourdaka': '829',
    'kritou_marottou': '830',
    'kritou_tera': '831',
    'kynousa': '832',
    'lapithiou': '833',
    'lasa': '834',
    'lemona': '836',
    'loukrounou': '839',
    'makounta': '841',
    'mamonia': '842',
    'mamountali': '843',
    'maronas': '846',
    'meladeia': '847',
    'melandra': '848',
    'mesana': '850',
    'milia': '852',
    'milikouri': '894',
    'miliou': '853',
    'mousere': '854',
    'pelathousa': '862',
    'pentalia': '863',
    'pitargou': '866',
    'praitori': '870',
    'prastio': '871',
    'psathi': '872',
    'salamiou': '873',
    'sarama': '874',
    'souskiou': '877',
    'stavrokonnou': '879',
    // 'tera': '883', // Tera is already covered by Kritou Tera? No, different. Adding:
    'tera': '883',
    'theletra': '884',
    'thrinia': '885',
    'trachypedoula': '887',
    'trimithousa': '889',
    'vrestia': '891',
    'zacharia': '893'
};

// Condition mapping: CRM numeric value -> DB string value
// Old CRM values: 0=n/a, 1=Off-Plan, 2=Under Development, 3=New - Ready, 4=Resale
export const CONDITION_MAP: Record<string, string> = {
    '0': '',              // n/a - no condition
    '1': 'off-plan',      // Off-Plan
    '2': 'under-construction', // Under Development
    '3': 'new',           // New - Ready
    '4': 'resale',        // Resale
};

// Tabs
const TAB_GENERAL = 'a[href="#tab_general"]';
const TAB_FEATURES = 'a[href="#tab_features"]';
const TAB_OWNER = 'a[href="#tab_owner"]';
const TAB_NOTES = 'a[href="#tab_notes"]';
const TAB_PUBLISH = 'a[href="#tab_publish"]';
// Images video docs are handled separately in code logic usually, or we add mapping

export const CRM_FIELD_MAPPING: CrmFieldMapping[] = [
    // --- TAB: GENERAL ---
    {
        dbField: 'title',
        selector: 'input[name="en[name]"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'reference',
        selector: 'input[name="reference"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'description',
        selector: 'textarea[name="en[description]"]',
        type: 'textarea', // Special handling for TinyMCE
        tab: TAB_GENERAL
    },
    {
        dbField: 'status',
        selector: 'select[name="status"]',
        type: 'select',
        tab: TAB_GENERAL,
        transform: (val: any, property?: Property) => {
            if (val === 'SOLD') return '4';
            if (val === 'RENTED') return '2';
            if (property?.goal === 'RENT') return '1';
            return '3'; // Default to Sale
        }
    },
    {
        dbField: 'type',
        selector: 'select[name="type_id"]',
        type: 'select',
        tab: TAB_GENERAL,
        transform: (val: string) => {
            if (!val) return '32';
            const key = val.toLowerCase().replace(/ /g, '-');
            return TYPE_MAP[key] || '32';
        }
    },
    {
        dbField: 'price',
        selector: 'input[name="price"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'rentalPeriod',
        selector: 'select[name="price_type"]',
        type: 'select',
        tab: TAB_GENERAL,
        transform: (val: string) => {
            if (!val) return '4';
            if (val.includes('month')) return '2';
            if (val.includes('week')) return '0';
            if (val.includes('day')) return '1';
            if (val.includes('year')) return '3';
            return '4';
        }
    },
    {
        dbField: 'communalFees',
        selector: 'input[name="communal_fees"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'propertyArea', // Changed from propertyLocation to get specific area/village
        selector: 'select[name="location_id"]',
        type: 'select',
        tab: TAB_GENERAL,
        transform: (val: string, property?: any) => {
            // Priority 1: Exact Area Match
            if (val) {
                // Try exact match
                if (LOCATION_MAP[val]) return LOCATION_MAP[val];
                // Try normalizing (replace hyphens/spaces with underscores to match snake_case standard)
                const key = val.toLowerCase().replace(/-/g, '_').replace(/ /g, '_');
                if (LOCATION_MAP[key]) return LOCATION_MAP[key];
            }

            // Fallback: Return multiple candidates (Area ||| District)
            // The pusher will try them in order until one matches
            const candidates: string[] = [];
            if (val) candidates.push(val); // e.g. "Mouttagiaka"
            if (property?.propertyLocation && property.propertyLocation !== val) {
                candidates.push(property.propertyLocation); // e.g. "Limassol"
            }

            return candidates.length > 0 ? candidates.join('|||') : null;
        }
    },
    {
        dbField: 'addressLine1',
        selector: 'input[name="address"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'latitude',
        selector: 'input[name="map_latitude"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'longitude',
        selector: 'input[name="map_longitude"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'bedrooms',
        selector: 'input[name="bedrooms"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'bathrooms',
        selector: 'input[name="bathrooms"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'floor',
        selector: 'input[name="levels"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'areaSqm',
        selector: 'input[name="area_covered"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'plotAreaSqm',
        selector: 'input[name="area_plot"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'coveredAreaSqm',
        selector: 'input[name="area_building_covered"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'coveredVerandaSqm',
        selector: 'input[name="area_veranda_covered"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'uncoveredVerandaSqm',
        selector: 'input[name="area_veranda_uncovered"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'basementSqm',
        selector: 'input[name="area_basement"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'buildYear',
        selector: 'input[name="build_date"]',
        type: 'text',
        tab: TAB_GENERAL
    },
    {
        dbField: 'condition',
        selector: 'select[name="condition"]',
        type: 'select',
        tab: TAB_GENERAL,
        transform: (val: string) => {
            if (!val) return '0';
            // Reverse lookup: DB value (e.g., 'resale') -> CRM ID (e.g., '4')
            const entry = Object.entries(CONDITION_MAP).find(([crmId, dbVal]) => dbVal === val.toLowerCase());
            return entry ? entry[0] : '0';
        }
    },
    {
        dbField: 'featured',
        selector: 'select[name="promote"]',
        type: 'select',
        tab: TAB_GENERAL,
        transform: (val: boolean) => val ? '1' : '0'
    },

    // --- TAB: FEATURES ---
    {
        dbField: 'features',
        selector: 'input[name="features[]"]',
        type: 'checkbox-group',
        tab: TAB_FEATURES
    },

    // --- TAB: PUBLISH ---
    {
        dbField: 'publicationStatus', // Use any field name, transform ignores it
        selector: 'select[name="active"]',
        type: 'select',
        tab: TAB_PUBLISH,
        transform: () => '2' // Always force to Pending (2)
    },
    {
        dbField: 'sortOrder',
        selector: 'input[name="sort"]',
        type: 'text',
        tab: TAB_PUBLISH
    },

    {
        dbField: 'slug',
        selector: 'input[name="slug"]',
        type: 'text',
        tab: TAB_PUBLISH
    },
    {
        dbField: 'metaTitle',
        selector: 'input[name="metatags[title]"]',
        type: 'text',
        tab: TAB_PUBLISH
    },
    {
        dbField: 'metaKeywords',
        selector: 'textarea[name="metatags[keywords]"]',
        type: 'textarea',
        tab: TAB_PUBLISH
    },
    {
        dbField: 'metaDescription',
        selector: 'textarea[name="metatags[description]"]',
        type: 'textarea',
        tab: TAB_PUBLISH
    },

    // --- TAB: OWNER ---
    {
        dbField: 'ownerName',
        selector: 'input[name="owner[name]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerPhone',
        selector: 'input[name="owner[tel]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerCompany',
        selector: 'input[name="owner[company]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerMobile',
        selector: 'input[name="owner[mob]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerFax',
        selector: 'input[name="owner[fax]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerBirthday',
        selector: 'input[name="owner[birthday]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerWebsite',
        selector: 'input[name="owner[website]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerAddress',
        selector: 'input[name="owner[address]"]',
        type: 'text',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerNotes',
        selector: 'textarea[name="owner[notes]"]',
        type: 'textarea',
        tab: TAB_OWNER
    },
    {
        dbField: 'ownerViewingNotification',
        selector: 'select[name="owner[notify_on_property_viewings]"]',
        type: 'select',
        tab: TAB_OWNER,
        valueMap: {
            '0': 'No',
            '1': 'Yes',
            '2': 'Unsubscribed'
        }
    },
    {
        dbField: 'ownerEmail',
        selector: 'input[name="owner[email]"]',
        type: 'text',
        tab: TAB_OWNER
    },

    // --- TAB: NOTES ---
    {
        dbField: 'agentRef',
        selector: 'input[name="agent_reference"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'agentUrl',
        selector: 'input[name="agent_url"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'projectName',
        selector: 'input[name="extra_fields[project_name]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'unitNumber',
        selector: 'input[name="extra_fields[flat_no]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'developerName',
        selector: 'input[name="extra_fields[developer_name]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'managementCompany',
        selector: 'input[name="extra_fields[management_company]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'keyHolder',
        selector: 'input[name="extra_fields[key_holder]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'occupancyStatus',
        selector: 'input[name="extra_fields[property_occupied]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'viewingContact',
        selector: 'input[name="extra_fields[viewings_contact]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'viewingNotes',
        selector: 'input[name="extra_fields[viewings_notes]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'viewingDirections',
        selector: 'textarea[name="extra_fields[viewings_directions]"]',
        type: 'textarea',
        tab: TAB_NOTES
    },
    {
        dbField: 'lawyer',
        selector: 'input[name="extra_fields[property_lawyer]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'loanDetails',
        selector: 'input[name="extra_fields[property_loan]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'purchasePrice',
        selector: 'input[name="extra_fields[purchase_price]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'lowestOffer',
        selector: 'input[name="extra_fields[lowest_offer]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'landSurveyValue',
        selector: 'input[name="extra_fields[land_survey_value]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'estimatedValue',
        selector: 'input[name="extra_fields[property_estimated_value]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'agencyAgreement',
        selector: 'input[name="extra_fields[agency_agreement]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'commission',
        selector: 'input[name="extra_fields[agreed_commission]"]',
        type: 'text',
        tab: TAB_NOTES
    },
    {
        dbField: 'agreementDate',
        selector: 'input[name="extra_fields[agreement_date]"]',
        type: 'text',
        tab: TAB_NOTES,
        transform: (val: Date) => val ? val.toISOString().split('T')[0] : ""
    },
    {
        dbField: 'internalNotes',
        selector: 'textarea[name="owner_notes"]',
        type: 'textarea',
        tab: TAB_NOTES
    },
    {
        dbField: 'agreementNotes',
        selector: 'textarea[name="extra_fields[agreement_notes]"]',
        type: 'textarea',
        tab: TAB_NOTES
    },

    // --- IMPORT METADATA (Read Only) ---
    {
        dbField: 'originalCreatorName',
        selector: 'input[name="created_by"]',
        type: 'text',
        tab: TAB_GENERAL // This usually appears in top block, checking if general tab covers it or if its global
    },
    {
        dbField: 'originalCreatedAt',
        selector: 'input[name="created_at"]',
        type: 'text',
        tab: TAB_GENERAL,
        transform: (val: string) => {
            // "22/10/2025 16:22" -> ISO Date
            if (!val) return null;
            const [datePart, timePart] = val.split(' ');
            if (!datePart) return null;
            const [day, month, year] = datePart.split('/');
            // Create ISO string: YYYY-MM-DDTHH:mm:00
            const iso = `${year}-${month}-${day}T${timePart || '00:00'}:00`;
            return new Date(iso).toISOString();
        }
    },
    {
        dbField: 'originalUpdatedAt',
        selector: 'input[name="updated_at"]',
        type: 'text',
        tab: TAB_GENERAL,
        transform: (val: string) => {
            if (!val) return null;
            const [datePart, timePart] = val.split(' ');
            if (!datePart) return null;
            const [day, month, year] = datePart.split('/');
            const iso = `${year}-${month}-${day}T${timePart || '00:00'}:00`;
            return new Date(iso).toISOString();
        }
    }
];
