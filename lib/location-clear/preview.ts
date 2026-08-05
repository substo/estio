export type LocationClearGroup = {
  key: string;
  label: string;
  details: readonly string[];
  models: readonly string[];
};

export const LOCATION_CLEAR_GROUPS: readonly LocationClearGroup[] = [
  {
    key: 'usage',
    label: 'Reports and AI usage',
    details: ['Website and admin activity reports', 'AI usage history'],
    models: ['AiUsage', 'AnalyticsVisitor', 'AnalyticsSession', 'AnalyticsEvent', 'AnalyticsDailyRollup'],
  },
  {
    key: 'contacts',
    label: 'Contacts and customer work',
    details: [
      'Contacts',
      'Conversations and messages',
      'Deals, tasks, offers, documents, and viewing history',
    ],
    models: [
      'Contact', 'ContactLanguage', 'ContactHistory', 'Conversation',
      'ConversationParticipant', 'Message', 'MessageAttachment', 'MessageTranscript',
      'MessageTranscriptExtraction', 'MessageTranslationCache', 'DealContext',
      'DealConversationLink', 'Offer', 'DealDocument', 'ContactTask', 'Viewing',
      'ViewingSession', 'ViewingSessionMessage', 'ViewingSessionInsight',
      'ViewingSessionSummary', 'ViewingSessionEvent', 'ViewingSessionUsage', 'Insight',
      'ContactPropertyMatchProfile', 'ContactPropertyInteraction',
      'PropertyMatchCampaign', 'PropertyMatchCandidate',
    ],
  },
  {
    key: 'prospects',
    label: 'Prospecting',
    details: ['Prospects and discovered property listings'],
    models: ['ProspectLead', 'ScrapedListing'],
  },
  {
    key: 'companies',
    label: 'Companies',
    details: ['Companies and their contact/property relationships'],
    models: ['Company', 'ContactCompanyRole', 'CompanyPropertyRole'],
  },
  {
    key: 'projects',
    label: 'Projects',
    details: ['Property developments and projects'],
    models: ['Project'],
  },
  {
    key: 'properties',
    label: 'Properties and listing activity',
    details: [
      'Properties and listing details',
      'Media references',
      'Property feeds, translations, print drafts, and saved activity',
    ],
    models: [
      'Property', 'PropertyPrintDraft', 'PropertyTranslation', 'PropertyMedia',
      'PropertyImagePromptProfile', 'ContactPropertyRole', 'SwipeSession',
      'PropertySwipe', 'PropertyFeed',
    ],
  },
] as const;

export const LOCATION_CLEAR_MODELS = LOCATION_CLEAR_GROUPS.flatMap((group) => group.models);

export const LOCATION_CLEAR_RETAINED = [
  'Location name and account identity',
  'Team members, permissions, and sign-in access',
  'Website domains, pages, branding, and navigation',
  'Connected-service settings and credentials',
  'AI settings and prompts',
  'Notifications and administrative history',
] as const;

export function buildLocationClearPreview(rowCounts: Record<string, number>) {
  const groups = LOCATION_CLEAR_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    details: [...group.details],
    count: group.models.reduce((sum, model) => sum + (rowCounts[model] || 0), 0),
    models: group.models.map((model) => ({ model, count: rowCounts[model] || 0 })),
  }));
  return {
    totalRows: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
    retained: [...LOCATION_CLEAR_RETAINED],
  };
}

export function locationClearClassificationIsComplete(): boolean {
  const classified = LOCATION_CLEAR_GROUPS.flatMap((group) => group.models);
  return classified.length === new Set(classified).size
    && ['Contact', 'ProspectLead', 'Company', 'Project', 'Property', 'AiUsage', 'AnalyticsEvent']
      .every((model) => classified.includes(model));
}
