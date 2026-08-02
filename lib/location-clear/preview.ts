export type LocationClearGroup = {
  key: string;
  label: string;
  models: readonly string[];
};

export const LOCATION_CLEAR_GROUPS: readonly LocationClearGroup[] = [
  {
    key: 'usage',
    label: 'Dashboard analytics and user-attributed AI usage',
    models: ['AiUsage', 'AnalyticsVisitor', 'AnalyticsSession', 'AnalyticsEvent', 'AnalyticsDailyRollup'],
  },
  {
    key: 'contacts',
    label: 'Contacts and dependent operational history',
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
    label: 'Prospects and scraped prospect listings',
    models: ['ProspectLead', 'ScrapedListing'],
  },
  {
    key: 'companies',
    label: 'Companies and company relationships',
    models: ['Company', 'ContactCompanyRole', 'CompanyPropertyRole'],
  },
  {
    key: 'projects',
    label: 'Projects',
    models: ['Project'],
  },
  {
    key: 'properties',
    label: 'Properties, media, feeds, and property activity',
    models: [
      'Property', 'PropertyPrintDraft', 'PropertyTranslation', 'PropertyMedia',
      'PropertyImagePromptProfile', 'ContactPropertyRole', 'SwipeSession',
      'PropertySwipe', 'PropertyFeed',
    ],
  },
] as const;

export const LOCATION_CLEAR_MODELS = LOCATION_CLEAR_GROUPS.flatMap((group) => group.models);

export const LOCATION_CLEAR_RETAINED = [
  'The Location record, name, and identity',
  'Users, memberships, roles, Clerk identities, and sessions',
  'Domains, site configuration, secrets, and provider credentials',
  'Public pages, blog posts, lead-source configuration, AI prompts, and knowledge',
  'OAuth and inbox sync state, notifications, audits, and runtime configuration',
] as const;

export const LOCATION_CLEAR_EXTERNAL = [
  'Supabase Storage, Cloudflare Images, R2, and other binary objects referenced by URLs',
  'Copies held by GoHighLevel, Google, Microsoft, WhatsApp, or other providers',
  'Active feeds, scraping, sync jobs, and provider webhooks can recreate cleared records',
] as const;

export function buildLocationClearPreview(rowCounts: Record<string, number>) {
  const groups = LOCATION_CLEAR_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    count: group.models.reduce((sum, model) => sum + (rowCounts[model] || 0), 0),
    models: group.models.map((model) => ({ model, count: rowCounts[model] || 0 })),
  }));
  return {
    totalRows: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
    retained: [...LOCATION_CLEAR_RETAINED],
    external: [...LOCATION_CLEAR_EXTERNAL],
  };
}

export function locationClearClassificationIsComplete(): boolean {
  const classified = LOCATION_CLEAR_GROUPS.flatMap((group) => group.models);
  return classified.length === new Set(classified).size
    && ['Contact', 'ProspectLead', 'Company', 'Project', 'Property', 'AiUsage', 'AnalyticsEvent']
      .every((model) => classified.includes(model));
}
