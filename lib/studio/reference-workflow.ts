/** Advisory guidance only. The existing command services remain the authority. */
export function scriptNextAction(record: { archived: boolean; payload: Record<string, unknown> },
  links: readonly { hasScriptEvidence: boolean }[]) {
  if (record.archived) return { kind: "archived" as const, message: "This piece is archived. Restore it before developing a script." };
  const script = typeof record.payload.script === "string" ? record.payload.script.trim() : "";
  if (script) return { kind: "handoff" as const, message: "Script saved. Review claims and the intended structure, then add filming instructions to Production notes and choose Record when ready. Saving a script does not approve it." };
  if (record.payload.stage !== "idea") return { kind: "manual" as const, message: "Write the script below, or choose Idea stage and save to request a source-backed script brief." };
  if (links.length > 3) return { kind: "links" as const, message: "Script briefs support at most three outgoing linked records. Choose the research for this brief in Manage linked records; unlinking preserves the saved records." };
  if (!links.some(link => link.hasScriptEvidence)) return { kind: "links" as const, message: "Link supporting research with a saved transcript, research notes or summary before generating a brief. URLs, descriptions and AI summaries alone are not used by this script service." };
  return { kind: "generate" as const, message: "Linked research text is available for a script brief. The service uses partial excerpts from up to three outgoing links; verify all claims before filming." };
}
