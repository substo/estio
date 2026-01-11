
import { TYPE_MAP } from '../lib/crm/field-mapping';
import { getCategoryForSubtype, PROPERTY_TYPES } from '../lib/properties/constants';


// Mock PULL Logic including Publication Status
function mapCrmIdToTypeAndSubtype(crmId: string, statusVal?: string) {
    let type = 'other';
    let category = null;
    let publicationStatus = 'PENDING';

    // Type Mapping
    const matches = Object.entries(TYPE_MAP).filter(([k, v]) => v === crmId);
    let bestMatchKey = matches.length > 0 ? matches[0][0] : null;

    if (matches.length > 1) {
        for (const [key] of matches) {
            const normalized = key.replace(/-/g, '_');
            const cat = getCategoryForSubtype(normalized);
            if (cat) {
                bestMatchKey = key;
                break;
            }
        }
    }

    if (bestMatchKey) {
        const subtypeKey = bestMatchKey.replace(/-/g, '_');
        type = subtypeKey;

        const cat = getCategoryForSubtype(subtypeKey);
        if (cat) {
            category = cat;
        }
    }

    // Publication Status Mapping
    // User rules: 'yes' -> PUBLISHED, 'no' -> UNLISTED, 'pending' -> PENDING
    if (statusVal) {
        const s = statusVal.toLowerCase();
        if (s === 'yes' || s === '1' || s === 'active') publicationStatus = 'PUBLISHED';
        else if (s === 'no' || s === '0' || s === 'inactive') publicationStatus = 'UNLISTED';
        else if (s === 'pending' || s === '2') publicationStatus = 'PENDING';
    }

    return { type, category, publicationStatus };
}


// Test Cases
const testIds = [
    { id: '14', status: 'yes', expectedType: 'detached_villa', expectedCategory: 'house', expectedStatus: 'PUBLISHED' },
    { id: '17', status: 'no', expectedType: 'town_house', expectedCategory: 'house', expectedStatus: 'UNLISTED' },
    { id: '10', status: 'pending', expectedType: 'apartment', expectedCategory: 'apartment', expectedStatus: 'PENDING' },
];

console.log("Running Mapping Tests...");
let passed = 0;
for (const t of testIds) {
    const result = mapCrmIdToTypeAndSubtype(t.id, t.status);

    // Check Type/Category
    const typePass = result.type === t.expectedType && result.category === t.expectedCategory;
    // Check Status
    const statusPass = result.publicationStatus === t.expectedStatus;

    if (typePass && statusPass) passed++;
    console.log(`ID ${t.id} [${t.status}]: Type/Cat [${typePass ? 'OK' : 'FAIL'}] Status Exp=${t.expectedStatus} Got=${result.publicationStatus} [${statusPass ? 'OK' : 'FAIL'}]`);
}

console.log(`\nPassed ${passed}/${testIds.length}`);
