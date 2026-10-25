/** Default-deny application firewall. Add routes only after auditing tenant authority. */
export const SUBSTO_CRM_PAGE_PATTERNS = [
  /^\/admin$/,
  /^\/admin\/contacts(?:\/[^/]+\/(?:view|edit))?$/,
  /^\/admin\/companies(?:\/[^/]+\/view)?$/,
  /^\/admin\/projects$/,
  /^\/admin\/conversations$/,
  /^\/admin\/content\/(?:pages|posts)(?:\/[^/]+)?$/,
  /^\/admin\/content\/website$/,
  /^\/admin\/content\/pages\/[^/]+\/preview$/,
  /^\/admin\/settings(?:\/notifications)?$/,
  /^\/admin\/team$/,
  /^\/admin\/user-profile(?:\/.*)?$/,
] as const;

export const SUBSTO_CRM_API_PATTERNS = [
  /^\/api\/active-location$/,
  /^\/api\/admin\/location-session-activity$/,
  /^\/api\/admin\/conversations\/[^/]+\/message-window$/,
  /^\/api\/admin\/conversations\/translate-(?:message|thread)$/,
  /^\/api\/conversations\/(?:events|draft-stream|summarize-stream|preview-reply-translation)$/,
  /^\/api\/notifications\/(?:events|subscriptions)$/,
  /^\/api\/media\/attachments\/[^/]+$/,
  /^\/api\/images\/direct-upload$/,
] as const;

export function isSubstoCrmPage(path: string): boolean {
  return SUBSTO_CRM_PAGE_PATTERNS.some((pattern) => pattern.test(path));
}
export function isSubstoCrmApi(path: string): boolean {
  return SUBSTO_CRM_API_PATTERNS.some((pattern) => pattern.test(path));
}

/** Property workflows embedded in contact CRUD are subject to the same boundary. */
export function hasPropertyContactInput(input: Record<string, unknown>): boolean {
  if (input.roleType === "property") return true;
  return Object.entries(input).some(([key, value]) =>
    /^(properties(?:Interested|Inspected|Emailed|Matched)|matching|propertyWon)/.test(key)
    && value !== null && value !== undefined && value !== "" && value !== false
    && value !== "[]" && !(Array.isArray(value) && value.length === 0),
  );
}
