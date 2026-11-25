import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { StudioCommandError } from "@/lib/studio/command-error";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { advanceAgentTurn, applyAgentProposal, getAgentEvidenceChoices, readAgentTurn, sendAgentMessage } from "@/lib/studio/agent";
import { readAgentApplyCommand, readAgentSendCommand } from "@/lib/studio/agent-policy";

export const dynamic = "force-dynamic";
type Command = { action: "send"; command: ReturnType<typeof readAgentSendCommand> } | { action: "apply"; command: ReturnType<typeof readAgentApplyCommand> } | { action: "advance"; turnId: string };
function parse(body: unknown): Command {
  const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  if (action === "send") return { action, command: readAgentSendCommand(body) };
  if (action === "apply") return { action, command: readAgentApplyCommand(body) };
  if (action === "advance") {
    const turnId = (body as { turnId?: unknown }).turnId;
    if (typeof turnId !== "string" || !recordLinkId(turnId)) throw new StudioCommandError("Message unavailable.", 404);
    return { action, turnId: turnId.toLowerCase() };
  }
  throw new StudioCommandError("Choose a supported assistant action.");
}
export const POST = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse, maxBytes: 40_000,
    execute: async item => {
      if (item.action === "send") return sendAgentMessage(locationId, item.command);
      if (item.action === "apply") return applyAgentProposal(locationId, item.command);
      const advanced = await advanceAgentTurn(locationId, item.turnId);
      if (!advanced) throw new StudioCommandError("Message unavailable.", 404);
      return advanced;
    } });
});
/** Read-only status. Advancing a turn (tool read, next model call) is the origin-checked POST `advance` action. */
export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  const query = new URL(request.url).searchParams;
  const id = query.get("turnId") ?? "";
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    if (query.has("evidenceRecord") || query.has("evidenceSource")) {
      const record = query.get("evidenceRecord"), source = query.get("evidenceSource");
      const linkedSource = query.get("evidenceLinkedSource");
      if (Boolean(record) === Boolean(source) || !recordLinkId(record ?? source ?? "") || (linkedSource !== null && (!record || !recordLinkId(linkedSource)))) return reply({ error: "Draft or source unavailable." }, 404);
      return reply({ choices: await getAgentEvidenceChoices(locationId, record, source, linkedSource) }, 200);
    }
    if (!recordLinkId(id)) return reply({ error: "Message unavailable." }, 404);
    const turn = await readAgentTurn(locationId, id);
    return turn ? reply({ turn }, 200) : reply({ error: "Message unavailable." }, 404);
  } catch (error) {
    if (error instanceof StudioCommandError) return reply({ error: error.message }, error.status);
    return reply({ error: "The status is temporarily unavailable. Your message is kept." }, 503);
  }
});
