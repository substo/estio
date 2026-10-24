/** Reviewed Server Actions for the generic CRM. Unknown modules/exports fail closed.
 * Providers, property workflows, GHL, public sites and legacy team writes stay Estio-only. */
const ALLOWED: Record<string, readonly string[]> = {
  "companies/actions.ts": [
    "createCompany",
    "updateCompany",
    "deleteCompany"
  ],
  "notifications/actions.ts": [
    "getNotificationSnapshot",
    "markNotificationReadAction",
    "markAllNotificationsReadAction",
    "getTaskReminderPreferenceAction",
    "updateTaskReminderPreferenceAction"
  ],
  "profile-actions.ts": [
    "completeUserProfile",
    "getUserProfileStatus"
  ],
  "tasks/actions.ts": [
    "listContactTasks",
    "listLocationTasks",
    "listTaskAssignableUsers",
    "getTaskDetail",
    "createContactTask",
    "updateContactTask",
    "setContactTaskCompletion",
    "deleteContactTask"
  ],
  "_actions/ai-usage.ts": [
    "getLocationAiUsageSummary",
    "getCurrentUserAiUsageSummary"
  ],
  "contacts/fetch-helpers.ts": [
    "getPropertiesForSelect",
    "getCompaniesForSelect",
    "getContactsForSelect",
    "getUsersForSelect",
    "getContactHistory"
  ],
  "content/actions.ts": [
    "upsertPage",
    "deletePage",
    "upsertPost",
    "deletePost",
  ],
  "content/ai-actions.ts": [
    "generateContentFromUrl",
    "regeneratePageDesign",
    "generateBrandVoiceFromSite",
    "refineBlockContent",
    "generateSiteTheme",
    "generateSectionFromPrompt"
  ],
  "contacts/actions.ts": [
    "openOrStartConversationForContact",
    "createContact",
    "updateContactAction",
    "updateContactIdentityAction",
    "updateContactTypeAction",
    "updateContact",
    "deleteContactRole",
    "createCompany",
    "deleteContact",
    "addContactHistoryEntry",
    "updateManualActivityEntry",
    "deleteManualActivityEntry",
    "getContactDetails",
    "searchContactsAction",
    "previewMergeContacts",
    "mergeContacts",
    "updateContactStage",
    "saveSharedContact",
    "checkSharedContactsSavedState"
  ],
  "contacts/ai-actions.ts": [
    "analyzeContactAction"
  ],
  "projects/fetch-helpers.ts": [
    "getProjectsForSelect"
  ],
  "projects/actions.ts": [
    "upsertProjectAction"
  ],
  "deals/actions.ts": [
    "getDealContexts",
    "getDealContext",
    "findExistingDeal",
    "createPersistentDeal",
    "getDealWorkspaceCore",
    "getDealWorkspaceSidebar",
    "updateDealStatus",
    "removeConversationFromDeal",
    "fetchDealTimeline"
  ],
  "conversations/actions.ts": [
    "fetchConversations",
    "fetchMessages",
    "getConversationWorkspaceCore",
    "getConversationWorkspaceSidebar",
    "getConversationWorkspace",
    "getConversationListDelta",
    "refreshConversationOnDemand",
    "searchConversationTranscriptMatches",
    "getAudioTranscriptMonthlyReport",
    "generateAIDraft",
    "generateComposerAIDraft",
    "setConversationReplyLanguageOverride",
    "previewTranslatedReply",
    "translateSelectedText",
    "translateConversationMessage",
    "translateConversationThread",
    "createDealContext",
    "generateMultiContextDraftAction",
    "getContactContext",
    "listContactVerificationProposals",
    "updateContactClientContextAction",
    "scanContactVerificationAction",
    "applyContactVerificationAction",
    "rejectContactVerificationAction",
    "markContactVerifiedAction",
    "getEmailSyncProvidersStatus",
    "getAvailableAiModelsAction",
    "getAiDraftModelPickerStateAction",
    "getAiModelPickerDefaultsAction",
    "getConversationChannelCapabilities",
    "getSmsChannelEligibility",
    "getAgentPlan",
    "getAgentExecutionHistoryPage",
    "getAgentExecutions",
    "getAgentExecutionDetail",
    "getContactInsightsAction",
    "getAggregateAIUsage",
    "getConversationTranscriptUsage",
    "refreshConversation",
    "markConversationAsRead",
    "deleteConversations",
    "restoreConversations",
    "permanentlyDeleteConversations",
    "archiveConversations",
    "unarchiveConversations",
    "emptyTrash",
    "getConversationParticipants",
    "prepareGroupParticipantSave",
    "saveGroupParticipantContact",
    "openConversationForGroupParticipant",
    "improveInternalNoteText",
    "summarizeSelectionToCrmLog",
    "suggestTasksFromSelection",
    "applySuggestedTasksFromSelection",
    "getTaskSuggestionFunnelMetrics",
    "runCustomSelectionPrompt",
    "saveCustomSelectionToCrmLog",
    "parseLeadFromText",
    "searchConversations",
    "fetchConversationActivityLog",
    "addConversationActivityEntry",
    "updateConversationActivityEntry",
    "deleteConversationActivityEntry",
    "listSuggestedResponses",
    "acceptSuggestedResponse",
    "rejectSuggestedResponse",
    "listSkillPolicies",
    "listAiDecisions",
    "listAiRuntimeJobs",
    "listAgentLearningProposalsAction",
    "listLocationAiPromptVersionsAction",
  ]
};

export function isSubstoCrmAction(module: string, action: string): boolean {
  return ALLOWED[module]?.includes(action) ?? false;
}
