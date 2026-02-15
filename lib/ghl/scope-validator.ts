/**
 * GHL OAuth Scope Validator
 * 
 * Compares required scopes for a feature against granted scopes
 * to detect when reauthorization is needed.
 */

/**
 * Required scopes per feature area.
 * When a 401 occurs for a feature, we can check if the granted scopes
 * include these required scopes and prompt for reauthorization if not.
 */
export const REQUIRED_SCOPES = {
    conversations: [
        'conversations.readonly',
        'conversations/message.readonly'
    ],
    contacts: [
        'contacts.readonly'
    ],
    opportunities: [
        'opportunities.readonly'
    ],
    calendars: [
        'calendars.readonly',
        'calendars/events.readonly'
    ],
    customObjects: [
        'objects/schema.readonly',
        'objects/record.readonly'
    ],
    media: [
        'medias.readonly'
    ],
    proposals: [
        'documents_contracts_template/list.readonly',
        'documents_contracts_template/sendLink.write'
    ]
} as const;

export type FeatureArea = keyof typeof REQUIRED_SCOPES;

/**
 * Check if granted scopes include all required scopes for a feature.
 * 
 * @param grantedScopes - Space-separated string of granted scopes (from DB)
 * @param feature - The feature area to check
 * @returns Array of missing scopes (empty if all scopes are present)
 */
export function getMissingScopes(
    grantedScopes: string | null | undefined,
    feature: FeatureArea
): string[] {
    if (!grantedScopes) {
        // No scopes stored = needs reauthorization
        return [...REQUIRED_SCOPES[feature]];
    }

    const granted = new Set(grantedScopes.split(' '));
    return REQUIRED_SCOPES[feature].filter(scope => !granted.has(scope));
}

/**
 * Check if all required scopes for a feature are present.
 */
export function hasScopesForFeature(
    grantedScopes: string | null | undefined,
    feature: FeatureArea
): boolean {
    return getMissingScopes(grantedScopes, feature).length === 0;
}

/**
 * Get a human-readable description of missing scopes.
 */
export function describeMissingScopes(missingScopes: string[]): string {
    if (missingScopes.length === 0) return '';

    const scopeDescriptions: Record<string, string> = {
        'conversations.readonly': 'read conversations',
        'conversations/message.readonly': 'read messages',
        'contacts.readonly': 'read contacts',
        'opportunities.readonly': 'read opportunities',
        'calendars.readonly': 'read calendars',
        'calendars/events.readonly': 'read calendar events',
        'objects/schema.readonly': 'read custom objects',
        'objects/record.readonly': 'read custom records',
        'medias.readonly': 'read media',
        'documents_contracts_template/list.readonly': 'list templates',
        'documents_contracts_template/sendLink.write': 'send templates',
        'documents_contracts/list.readonly': 'list documents',
        'documents_contracts/sendLink.write': 'send documents',
    };

    const descriptions = missingScopes.map(
        scope => scopeDescriptions[scope] || scope
    );

    return `Missing permissions: ${descriptions.join(', ')}`;
}
