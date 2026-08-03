import type { CodexConnectionScope } from "./codex-device-auth";

export function canManageLocationAiIntegrations(input: {
    isActiveLocationMember: boolean;
    isActiveLocationAdmin: boolean;
}): boolean {
    return input.isActiveLocationMember && input.isActiveLocationAdmin;
}

export function canManageChatGptConnection(input: {
    scope: CodexConnectionScope;
    isActiveLocationMember: boolean;
    isActiveLocationAdmin: boolean;
    isCurrentUserScope: boolean;
}): boolean {
    if (!input.isActiveLocationMember) return false;
    return input.scope === "LOCATION"
        ? input.isActiveLocationAdmin
        : input.isCurrentUserScope;
}
