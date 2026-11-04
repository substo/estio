import { businessProfileSchema, type BusinessProfile } from './schema';

/** Minimum useful content brief. Not a publication gate. See documentation/business-data.md. */
export const BUSINESS_ESSENTIALS = {
    identity: ['identity.summary'],
    contact: ['contact.email'],
    onlinePresence: ['onlinePresence.website'],
    offer: ['offer.description'],
    audienceMarket: ['audienceMarket.audience', 'audienceMarket.serviceAreas'],
    brandVoice: ['brandVoice.tone'],
    realEstate: ['realEstate.businessTypes', 'realEstate.services', 'realEstate.propertyCategories', 'realEstate.transactionFocus'],
} as const;
export type CompletenessIssue = { path: string; reason: 'missing' | 'unconfirmed' };
type Fact = { status: string; value?: unknown; confirmedAt: string | null };
function inspect(value: unknown, path: string): CompletenessIssue[] {
    if (value === undefined || value === null) return [{ path, reason: 'missing' }];
    if (Array.isArray(value)) return value.length ? value.flatMap((entry, i) => inspect(entry, `${path}.${i}`)) : [{ path, reason: 'missing' }];
    if (typeof value !== 'object') return [];
    if ('status' in value) {
        const fact = value as Fact;
        if (fact.status === 'unknown') return [{ path, reason: 'missing' }];
        const issues: CompletenessIssue[] = fact.confirmedAt ? [] : [{ path, reason: 'unconfirmed' }];
        return fact.status === 'known' ? [...issues, ...inspect(fact.value, path)] : issues;
    }
    const entries = Object.entries(value);
    return entries.length ? entries.flatMap(([key, item]) => inspect(item, `${path}.${key}`)) : [{ path, reason: 'missing' }];
}
function inspectPath(profile: BusinessProfile, path: string): CompletenessIssue[] {
    let value: unknown = profile;
    let prefix = '';
    for (const key of path.split('.')) {
        if (value && typeof value === 'object' && 'status' in value) {
            const fact = value as Fact;
            if (fact.status !== 'known') return inspect(fact, prefix);
            const wrapperIssues = fact.confirmedAt ? [] : [{ path: prefix, reason: 'unconfirmed' as const }];
            value = fact.value;
            if (wrapperIssues.length) return [...wrapperIssues, ...inspect((value as Record<string, unknown>)?.[key], path)];
        }
        value = (value as Record<string, unknown> | undefined)?.[key];
        prefix = prefix ? `${prefix}.${key}` : key;
    }
    return inspect(value, path);
}
export function getBusinessProfileCompleteness(input: BusinessProfile, app: 'estio' | 'substo') {
    const profile = businessProfileSchema.parse(input);
    const sections: Record<string, CompletenessIssue[]> = {};
    for (const [section, paths] of Object.entries(BUSINESS_ESSENTIALS)) {
        if (section === 'realEstate' && app === 'substo') continue;
        const issues = paths.flatMap(path => inspectPath(profile, path));
        sections[section] = issues.filter((issue, i) => issues.findIndex(other => other.path === issue.path && other.reason === issue.reason) === i);
    }
    return { complete: Object.values(sections).every(issues => !issues.length), sections };
}
