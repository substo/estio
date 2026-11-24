export const workspaceModes = ["script", "edit", "details"] as const;
export type WorkspaceMode = typeof workspaceModes[number];
export const modeLabels: Record<WorkspaceMode, string> = { script: "Script", edit: "Edit", details: "Details" };
export const parseMode = (value: unknown): WorkspaceMode | null => typeof value === "string" && (workspaceModes as readonly string[]).includes(value) ? value as WorkspaceMode : null;
/** No script, or a script without a video yet: Script. Once a video exists: Edit. */
export const defaultMode = (state: { hasScript: boolean; hasVideo: boolean }): WorkspaceMode => state.hasVideo ? "edit" : "script";
