import { z } from "zod";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { StudioCommandError } from "@/lib/studio/command-error";
import { answer, confirm, confirmTopic, edit, getOnboardingView, OnboardingError, setStatus, skip, startResearch } from "@/lib/onboarding/service";
import { onboardingActor as actorFor } from "@/lib/onboarding/actor";

/**
 * Business onboarding for the active Location (both apps). Members may read; changes need an admin acting as
 * themselves. Same-origin JSON commands with the X-Studio-Tenant header, like other Location commands.
 */
const id = z.string().regex(/^[a-zA-Z]{1,40}$/);
const value = z.union([z.string().max(4000), z.array(z.union([z.string().max(300), z.record(z.union([z.string().max(2048), z.boolean()]))])).max(20), z.null()]);
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), name: z.string().max(200).optional(), website: z.string().max(2048).optional() }).strict(),
  z.object({ action: z.literal("confirm"), topic: id, field: id }).strict(),
  z.object({ action: z.literal("confirm-topic"), topic: id }).strict(),
  z.object({ action: z.literal("edit"), topic: id, field: id, value }).strict(),
  z.object({ action: z.literal("skip"), topic: id }).strict(),
  z.object({ action: z.literal("say"), text: z.string().min(1).max(2000), topic: id.optional() }).strict(),
  z.object({ action: z.literal("finish") }).strict(),
  z.object({ action: z.literal("reopen") }).strict(),
]);
export const dynamic = "force-dynamic";

export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  const actor = await actorFor(locationId);
  if (!actor) return Response.json({ error: "Access denied" }, { status: 403 });
  return Response.json({ view: await getOnboardingView(actor) }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, {
    profile: getPlatformProfile,
    parse(raw) { const parsed = commandSchema.safeParse(raw); if (!parsed.success) throw new StudioCommandError("Check the details and try again."); return parsed.data; },
    async execute(command) {
      const actor = await actorFor(locationId);
      if (!actor) throw new StudioCommandError("Location access is required.", 403);
      try {
        switch (command.action) {
          case "start": return { view: await startResearch(actor, command) };
          case "confirm": return { view: await confirm(actor, command.topic, command.field) };
          case "confirm-topic": return { view: await confirmTopic(actor, command.topic) };
          case "edit": return { view: await edit(actor, command.topic, command.field, command.value as never) };
          case "skip": return { view: await skip(actor, command.topic) };
          case "say": return { view: await answer(actor, command.text, command.topic) };
          case "finish": case "reopen": return { view: await setStatus(actor, command.action) };
        }
      } catch (error) {
        if (error instanceof OnboardingError) throw new StudioCommandError(error.message, 400);
        throw error;
      }
    },
  });
});
