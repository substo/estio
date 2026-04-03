import { resolveViewingSessionPipelinePolicy } from "@/lib/viewings/sessions/pipeline-policy";

export const VIEWING_LIVE_READ_ONLY_TOOLS = [
    "resolve_viewing_property_context",
    "search_related_properties",
    "fetch_company_playbook",
] as const;

const READ_ONLY_TOOL_SET = new Set<string>(VIEWING_LIVE_READ_ONLY_TOOLS);

export function isViewingLiveToolAllowed(toolName: string | null | undefined): boolean {
    const normalized = String(toolName || "").trim();
    if (!normalized) return true;
    return READ_ONLY_TOOL_SET.has(normalized);
}

export function isViewingLiveToolAllowedForSession(input: {
    toolName: string | null | undefined;
    sessionKind?: unknown;
}): boolean {
    const policy = resolveViewingSessionPipelinePolicy({ sessionKind: input.sessionKind });
    if (!policy.allowTools) return false;
    return isViewingLiveToolAllowed(input.toolName);
}
